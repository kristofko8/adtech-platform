import { MetaHttpClient } from './meta-http.client.js';
import { MetaAdCreativeSchema, type MetaAdCreative } from '@adtech/shared-types';
import { perceptualHasher, compareDHashes } from './perceptual-hash.js';
import * as crypto from 'crypto';

const CREATIVE_FIELDS = [
  'id', 'name', 'title', 'body',
  'image_hash', 'image_url', 'thumbnail_url',
  'video_id', 'call_to_action_type',
  'object_story_spec', 'effective_object_story_id',
  'created_time',
].join(',');

export interface CreativeWithHash extends MetaAdCreative {
  globalAssetId: string;
  assetType: 'IMAGE' | 'VIDEO' | 'CAROUSEL';
  /**
   * dHash pre vizuálnu podobnosť.
   * Null ak nemáme URL obrázka (videá, carousely bez náhľadu).
   */
  dHash: string | null;
}

export class CreativesService {
  constructor(private readonly client: MetaHttpClient) {}

  async getCreative(creativeId: string): Promise<MetaAdCreative> {
    const raw = await this.client.get<unknown>(creativeId, {
      fields: CREATIVE_FIELDS,
    });

    return MetaAdCreativeSchema.parse(raw);
  }

  async getAccountCreatives(accountId: string): Promise<MetaAdCreative[]> {
    const raw = await this.client.getAll<unknown>(
      `${accountId}/adcreatives`,
      { fields: CREATIVE_FIELDS },
    );

    return raw.map((item) => MetaAdCreativeSchema.parse(item));
  }

  /**
   * Generuje interné ID + dHash pre kreatívu.
   *
   * SHA-256 (globalAssetId) → exaktná zhoda rovnakého súboru
   * dHash → robustné porovnanie vizuálne podobných kreatív
   *   (odolný voči kompresii, miernym rezom, watermarku)
   */
  generateGlobalAssetId(creative: MetaAdCreative): Omit<CreativeWithHash, 'dHash'> {
    let assetKey: string;
    let assetType: 'IMAGE' | 'VIDEO' | 'CAROUSEL';

    if (creative.video_id) {
      assetKey = `video:${creative.video_id}`;
      assetType = 'VIDEO';
    } else if (creative.image_hash) {
      assetKey = `image:${creative.image_hash}`;
      assetType = 'IMAGE';
    } else if (creative.object_story_spec) {
      const specStr = JSON.stringify(creative.object_story_spec);
      assetKey = `carousel:${crypto.createHash('md5').update(specStr).digest('hex')}`;
      assetType = 'CAROUSEL';
    } else {
      assetKey = `unknown:${creative.id}`;
      assetType = 'IMAGE';
    }

    const globalAssetId = crypto
      .createHash('sha256')
      .update(assetKey)
      .digest('hex')
      .substring(0, 32);

    return { ...creative, globalAssetId, assetType };
  }

  /**
   * Generuje globalAssetId + dHash (perceptuálny).
   * Stiahne thumbnail_url pre výpočet dHash.
   *
   * Pre videá: použijeme thumbnail_url ako proxy pre vizuálny obsah.
   * Pre obrázky: image_url (plná rozlíšenie) alebo thumbnail_url ako fallback.
   */
  async generateWithPerceptualHash(creative: MetaAdCreative): Promise<CreativeWithHash> {
    const base = this.generateGlobalAssetId(creative);

    const hashUrl = creative.image_url ?? creative.thumbnail_url;
    let dHash: string | null = null;

    if (hashUrl) {
      try {
        const result = await perceptualHasher.hashFromUrl(hashUrl);
        dHash = result.dhash;
      } catch (err: any) {
        // Nekritická chyba — dHash bude null, SHA-256 stačí
        console.warn(`[CreativesService] dHash failed for creative ${creative.id}: ${err.message}`);
      }
    }

    return { ...base, dHash };
  }

  /**
   * Nájde vizuálne podobné kreatívy z dát existujúcich AssetMap záznamov.
   *
   * @param targetDHash dHash nového assetu
   * @param existingAssets Pole {id, dhash} zo Prisma AssetMap
   * @param threshold Maximálna Hamming vzdialenosť (default: 10)
   *
   * Príklad použitia v CreativeSyncProcessor:
   * ```ts
   * const similar = service.findVisuallySimilar(
   *   newCreative.dHash,
   *   existingAssets.map(a => ({ id: a.globalAssetId, dhash: a.pHash ?? '' })),
   * );
   * if (similar.length > 0) {
   *   console.log(`Kreatíva ${newCreative.id} je podobná: ${similar[0].id} (${similar[0].hammingDistance} bitov rozdiel)`);
   * }
   * ```
   */
  findVisuallySimilar(
    targetDHash: string,
    existingAssets: { id: string; dhash: string }[],
    threshold = 10,
  ): Array<{ id: string; dhash: string; hammingDistance: number; similarityPct: number; verdict: string }> {
    return existingAssets
      .filter((a) => a.dhash && a.dhash.length === 16)
      .map((a) => ({
        ...a,
        ...compareDHashes(targetDHash, a.dhash),
      }))
      .filter((r) => r.hammingDistance <= threshold)
      .sort((a, b) => a.hammingDistance - b.hammingDistance);
  }

  // Získanie čerstvej CDN URL pre kreatívu (pre Media Proxy)
  async getFreshCreativeUrl(creativeId: string): Promise<{
    imageUrl?: string;
    thumbnailUrl?: string;
    videoId?: string;
  }> {
    const creative = await this.getCreative(creativeId);

    return {
      imageUrl: creative.image_url,
      thumbnailUrl: creative.thumbnail_url,
      videoId: creative.video_id,
    };
  }
}
