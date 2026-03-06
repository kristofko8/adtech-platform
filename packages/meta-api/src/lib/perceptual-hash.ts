// ============================================================
// Perceptuálny hash pre Entity Resolution vizuálnych assetov
//
// Implementuje dHash (Difference Hash) algoritmus:
//   1. Zmenši obrázok na 9×8 pixelov (grayscale)
//   2. Pre každý riadok porovnaj susedné pixely (9→8 bitov/riadok)
//   3. Výsledok: 64-bitový hash (8 riadkov × 8 bitov)
//
// Výhody oproti SHA-256 (existujúci globalAssetId):
//   • SHA-256: rozlišuje aj 1px rozdiel → rôzny kreatíva = rôzny ID
//   • dHash: robustný voči kompresii, watermarku, miernym rezom
//   • Hamming vzdialenosť: meria mieru podobnosti (0 = identické)
//
// Príklad:
//   Video A (originál): dHash = "a3f2c1b4e5d6f7a8"
//   Video B (cropped):  dHash = "a3f2c1b4e5d6f7b9"  (2 bity rozdiel)
//   → Hamming(A, B) = 2 → pravdepodobne rovnaký asset
//
// Threshold pre zhodu:
//   0–5 bitov = takmer identické → sloučiť do jednej entity
//   6–10 bitov = podobné → zaznačiť pre manuálnu kontrolu
//   >10 bitov = rôzne kreatívy
// ============================================================

import * as crypto from 'crypto';
import * as https from 'https';

export interface PerceptualHashResult {
  dhash: string;        // 16-znakový hex hash (64 bitov)
  sha256: string;       // Existujúci globalAssetId pre spätnú kompatibilitu
}

export interface SimilarityResult {
  hammingDistance: number;
  similarityPct: number;     // 100 = identické, 0 = úplne odlišné
  verdict: 'identical' | 'similar' | 'different';
}

// Thresholdy pre klasifikáciu podobnosti
const IDENTICAL_THRESHOLD = 5;   // 0–5 bitov → identické
const SIMILAR_THRESHOLD = 10;    // 6–10 bitov → podobné

/**
 * Vypočíta dHash z raw pixel dát (grayscale, 9×8).
 *
 * @param pixels Uint8Array: 72 grayscale hodnôt (9 stĺpcov × 8 riadkov)
 * @returns 64-bitový hash ako BigInt
 */
export function computeDHashFromPixels(pixels: Uint8Array): bigint {
  if (pixels.length !== 72) {
    throw new Error(`dHash vyžaduje 72 pixelov (9×8), dostalo: ${pixels.length}`);
  }

  let hash = 0n;

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const idx = row * 9 + col;
      // Porovnaj aktuálny pixel s nasledujúcim v riadku
      const bit = pixels[idx] < pixels[idx + 1] ? 1n : 0n;
      hash = (hash << 1n) | bit;
    }
  }

  return hash;
}

/**
 * Konvertuje BigInt hash na hex string (16 znakov, left-padded).
 */
export function hashToHex(hash: bigint): string {
  return hash.toString(16).padStart(16, '0');
}

/**
 * Vypočíta Hamming vzdialenosť medzi dvoma 64-bitovými hashmi.
 * Hamming = počet bitov kde sa hashe líšia.
 */
export function hammingDistance(hashA: string, hashB: string): number {
  if (hashA.length !== hashB.length) {
    throw new Error('Hashe musia mať rovnakú dĺžku');
  }

  let diffBits = BigInt('0x' + hashA) ^ BigInt('0x' + hashB);
  let distance = 0;

  while (diffBits > 0n) {
    distance += Number(diffBits & 1n);
    diffBits >>= 1n;
  }

  return distance;
}

/**
 * Porovná dva dHash retazce a vráti výsledok podobnosti.
 */
export function compareDHashes(hashA: string, hashB: string): SimilarityResult {
  const dist = hammingDistance(hashA, hashB);
  const similarityPct = Math.round(((64 - dist) / 64) * 100);

  let verdict: SimilarityResult['verdict'];
  if (dist <= IDENTICAL_THRESHOLD) verdict = 'identical';
  else if (dist <= SIMILAR_THRESHOLD) verdict = 'similar';
  else verdict = 'different';

  return { hammingDistance: dist, similarityPct, verdict };
}

// ── HTTP helper pre sťahovanie obrázkov ─────────────────────────────────────

/**
 * Stiahne obrázok z URL a vráti buffer.
 * Sleduje presmerovanbia (max 3).
 */
async function fetchImageBuffer(url: string, redirects = 3): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 10_000 }, (res) => {
      // Presmerovanie
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location && redirects > 0) {
        req.destroy();
        fetchImageBuffer(res.headers.location, redirects - 1).then(resolve, reject);
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} pri sťahovaní obrázka z ${url}`));
        return;
      }

      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout pri sťahovaní obrázka z ${url}`));
    });
  });
}

// ── Pure TypeScript bilineárna interpolácia pre resize ───────────────────────

/**
 * Zmenší obrázok na 9×8 grayscale pixel grid pomocou bilineárnej interpolácie.
 *
 * Vstup: raw pixel dáta ako Buffer (RGB alebo RGBA).
 * Výstup: Uint8Array s 72 grayscale hodnotami.
 *
 * POZOR: Táto implementácia predpokladá že vstup je raw RGBA/RGB buffer
 * bez PNG/JPEG hlavičky. V produkcii použite `sharp` alebo `jimp`:
 *   const { data } = await sharp(url).resize(9, 8).greyscale().raw().toBuffer({ resolveWithObject: true });
 */
function resizeToGrid(rawPixels: Buffer, srcWidth: number, srcHeight: number, channels: 3 | 4 = 4): Uint8Array {
  const TARGET_W = 9;
  const TARGET_H = 8;
  const result = new Uint8Array(TARGET_W * TARGET_H);

  for (let ty = 0; ty < TARGET_H; ty++) {
    for (let tx = 0; tx < TARGET_W; tx++) {
      // Mapovanie cieľového pixelu na zdrojový obrázok
      const srcX = (tx / (TARGET_W - 1)) * (srcWidth - 1);
      const srcY = (ty / (TARGET_H - 1)) * (srcHeight - 1);

      const x0 = Math.floor(srcX);
      const y0 = Math.floor(srcY);
      const x1 = Math.min(x0 + 1, srcWidth - 1);
      const y1 = Math.min(y0 + 1, srcHeight - 1);
      const dx = srcX - x0;
      const dy = srcY - y0;

      // Bilineárna interpolácia
      const getGray = (x: number, y: number): number => {
        const offset = (y * srcWidth + x) * channels;
        const r = rawPixels[offset];
        const g = rawPixels[offset + 1];
        const b = rawPixels[offset + 2];
        // Luminance formula (BT.601)
        return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      };

      const c00 = getGray(x0, y0);
      const c10 = getGray(x1, y0);
      const c01 = getGray(x0, y1);
      const c11 = getGray(x1, y1);

      const gray = c00 * (1 - dx) * (1 - dy)
                 + c10 * dx * (1 - dy)
                 + c01 * (1 - dx) * dy
                 + c11 * dx * dy;

      result[ty * TARGET_W + tx] = Math.round(gray);
    }
  }

  return result;
}

// ── Hlavná trieda ────────────────────────────────────────────────────────────

export class PerceptualHasher {
  /**
   * Vypočíta dHash + SHA-256 pre asset identifikovaný URL alebo bufferom.
   *
   * Pre produkčné použitie s `sharp` (väčšia presnosť):
   * ```ts
   * import sharp from 'sharp';
   * const { data, info } = await sharp(imageBuffer).resize(9, 8).greyscale().raw()
   *   .toBuffer({ resolveWithObject: true });
   * const pixels = computeDHashFromPixels(new Uint8Array(data));
   * ```
   */
  async hashFromBuffer(
    buffer: Buffer,
    width: number,
    height: number,
    channels: 3 | 4 = 4,
  ): Promise<PerceptualHashResult> {
    const pixels = resizeToGrid(buffer, width, height, channels);
    const hash = computeDHashFromPixels(pixels);
    const dhash = hashToHex(hash);
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex').substring(0, 32);

    return { dhash, sha256 };
  }

  /**
   * Stiahne obrázok z URL a vypočíta dHash.
   * Vyžaduje externý dekodér (sharp/jimp) pre PNG/JPEG → raw pixels konverziu.
   *
   * Táto implementácia vracia simulovaný hash pre URL (bez dekodera).
   * V produkcii: nainštaluj `sharp` a použi sharp(buffer).resize(9,8).greyscale().raw()
   */
  async hashFromUrl(url: string): Promise<PerceptualHashResult> {
    const buffer = await fetchImageBuffer(url);

    // Fallback: použijeme SHA-256 pre generovanie konzistentného dHash
    // (bez JPEG/PNG dekodéra nemôžeme dekódovať raw pixely)
    // V produkcii nahradiť: import sharp from 'sharp'; sharp(buffer).resize(9,8)...
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex').substring(0, 32);

    // Deterministický dHash z SHA-256 (pre konzistentnosť bez sharp)
    const hashBytes = Buffer.from(sha256.substring(0, 16), 'hex');
    let hash = 0n;
    for (let i = 0; i < 8; i++) {
      hash = (hash << 8n) | BigInt(hashBytes[i]);
    }

    return { dhash: hashToHex(hash), sha256 };
  }

  /**
   * Nájde vizuálne podobné assety v databáze.
   *
   * @param targetHash dHash hľadaného assetu
   * @param candidates Pole { id, dhash } zo AssetMap
   * @param threshold Max Hamming vzdialenosť (default: 10)
   */
  findSimilar(
    targetHash: string,
    candidates: { id: string; dhash: string }[],
    threshold = SIMILAR_THRESHOLD,
  ): Array<{ id: string; dhash: string } & SimilarityResult> {
    return candidates
      .map((c) => ({
        ...c,
        ...compareDHashes(targetHash, c.dhash),
      }))
      .filter((r) => r.hammingDistance <= threshold)
      .sort((a, b) => a.hammingDistance - b.hammingDistance);
  }
}

// Singleton export pre jednoduché používanie
export const perceptualHasher = new PerceptualHasher();
