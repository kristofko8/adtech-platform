import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

// ============================================================
// PiiNormalizerService
//
// Centralizovaná vrstva na normalizáciu a SHA-256 hashovanie
// osobných údajov (PII) pred odoslaním do Meta Conversions API.
//
// Ochrana:
//  1. Detekcia dvojitého hashovania (64-char hex → skip)
//  2. Validácia formátu emailu
//  3. E.164 normalizácia telefónneho čísla
//  4. Lowercase + trim pre všetky textové PII polia
//  5. Hashovanie city/state/zip/country (Meta CAPI Extended)
//  6. Logovanie varovní pri nevalidných vstupoch
// ============================================================

export interface RawUserData {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  city?: string;
  state?: string;        // 2-char ISO kód (napr. "SK", "CZ")
  zip?: string;
  country?: string;      // 2-char ISO kód (napr. "sk", "cz")
  externalId?: string;
  clientIpAddress?: string;
  clientUserAgent?: string;
  fbp?: string;
  fbc?: string;
}

export interface HashedUserData {
  em?: string;
  ph?: string;
  fn?: string;
  ln?: string;
  ct?: string;
  st?: string;
  zp?: string;
  country?: string;
  external_id?: string;
  // Tieto polia sa NEHASHUJÚ — Meta ich očakáva v plaintext
  client_ip_address?: string;
  client_user_agent?: string;
  fbp?: string;
  fbc?: string;
}

export interface NormalizationResult {
  hashed: HashedUserData;
  warnings: string[];
  hashedFieldCount: number;
}

// SHA-256 hex výstup je vždy 64 znakov
const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/i;

// Základná validácia emailu (RFC 5322 uprosená)
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Minimálna dĺžka telefónneho čísla po stripovaní (bez "+" a medzier)
const PHONE_MIN_DIGITS = 7;
const PHONE_MAX_DIGITS = 15;

// Zoznam hodnôt, ktoré vyzerajú ako hash ale sú testové vstupy
const KNOWN_TEST_HASHES = new Set([
  // sha256("test")
  '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  // sha256("email@test.com")
  'f660ab912ec121d1b1e928a0bb4bc61b15f5ad44d5efdc4e1c92a25e99b8e44a',
]);

@Injectable()
export class PiiNormalizerService {
  private readonly logger = new Logger(PiiNormalizerService.name);

  // ── Hlavná metóda ─────────────────────────────────────────────────────────

  normalize(raw: RawUserData): NormalizationResult {
    const warnings: string[] = [];
    const hashed: HashedUserData = {};
    let hashedFieldCount = 0;

    // email → em
    if (raw.email) {
      const result = this.processEmail(raw.email);
      if (result.hash) {
        hashed.em = result.hash;
        hashedFieldCount++;
      }
      warnings.push(...result.warnings);
    }

    // phone → ph
    if (raw.phone) {
      const result = this.processPhone(raw.phone);
      if (result.hash) {
        hashed.ph = result.hash;
        hashedFieldCount++;
      }
      warnings.push(...result.warnings);
    }

    // firstName → fn
    if (raw.firstName) {
      const result = this.processTextField(raw.firstName, 'firstName');
      if (result.hash) {
        hashed.fn = result.hash;
        hashedFieldCount++;
      }
      warnings.push(...result.warnings);
    }

    // lastName → ln
    if (raw.lastName) {
      const result = this.processTextField(raw.lastName, 'lastName');
      if (result.hash) {
        hashed.ln = result.hash;
        hashedFieldCount++;
      }
      warnings.push(...result.warnings);
    }

    // city → ct
    if (raw.city) {
      const result = this.processTextField(raw.city, 'city');
      if (result.hash) {
        hashed.ct = result.hash;
        hashedFieldCount++;
      }
      warnings.push(...result.warnings);
    }

    // state → st (2-char ISO)
    if (raw.state) {
      const normalized = raw.state.toLowerCase().trim().replace(/\s+/g, '');
      if (!/^[a-z]{2,3}$/.test(normalized)) {
        warnings.push(`[PII] state "${raw.state}" nie je platný ISO kód — bude hashovaný tak ako je`);
      }
      const result = this.processTextField(raw.state, 'state');
      if (result.hash) {
        hashed.st = result.hash;
        hashedFieldCount++;
      }
      warnings.push(...result.warnings);
    }

    // zip → zp
    if (raw.zip) {
      const result = this.processTextField(raw.zip, 'zip', false);
      if (result.hash) {
        hashed.zp = result.hash;
        hashedFieldCount++;
      }
      warnings.push(...result.warnings);
    }

    // country → country (2-char ISO lowercase)
    if (raw.country) {
      const normalized = raw.country.toLowerCase().trim();
      if (!/^[a-z]{2}$/.test(normalized)) {
        warnings.push(`[PII] country "${raw.country}" nie je platný 2-char ISO kód`);
      }
      const result = this.processTextField(raw.country, 'country');
      if (result.hash) {
        hashed.country = result.hash;
        hashedFieldCount++;
      }
      warnings.push(...result.warnings);
    }

    // externalId → external_id (lowercase, trimmed)
    if (raw.externalId) {
      const result = this.processTextField(raw.externalId, 'externalId');
      if (result.hash) {
        hashed.external_id = result.hash;
        hashedFieldCount++;
      }
      warnings.push(...result.warnings);
    }

    // Polia bez hashovania — prenesú sa priamo
    if (raw.clientIpAddress) hashed.client_ip_address = raw.clientIpAddress;
    if (raw.clientUserAgent) hashed.client_user_agent = raw.clientUserAgent;
    if (raw.fbp) hashed.fbp = raw.fbp;
    if (raw.fbc) hashed.fbc = raw.fbc;

    // Logovanie varovní
    if (warnings.length > 0) {
      this.logger.warn(
        `[PiiNormalizer] ${warnings.length} varovanie(í) pri normalizácii PII:\n` +
        warnings.join('\n'),
      );
    }

    // Varovanie ak máme nulové PII polia — EMQ bude nízke
    if (hashedFieldCount === 0 && !raw.fbp && !raw.fbc && !raw.externalId) {
      this.logger.warn(
        '[PiiNormalizer] Udalosť nemá žiadne PII polia! Meta EMQ skóre bude minimálne. ' +
        'Odporúčame pridať aspoň: email, phone, externalId alebo fbp/fbc.',
      );
    }

    return { hashed, warnings, hashedFieldCount };
  }

  // ── Interne metódy ────────────────────────────────────────────────────────

  private processEmail(
    email: string,
  ): { hash: string | null; warnings: string[] } {
    const warnings: string[] = [];
    const normalized = email.toLowerCase().trim();

    // Detekcia dvojitého hashovania
    if (this.isAlreadyHashed(normalized)) {
      warnings.push(
        `[PII] email vyzerá ako SHA-256 hash (${normalized.slice(0, 8)}...) — preskakujem hashovanie. ` +
        'Pošlite plaintext email.',
      );
      return { hash: normalized, warnings };
    }

    // Testové hash hodnoty
    if (KNOWN_TEST_HASHES.has(normalized)) {
      warnings.push('[PII] email je testovací hash — v produkcii posielajte reálne dáta');
    }

    // Validácia formátu
    if (!EMAIL_REGEX.test(normalized)) {
      warnings.push(`[PII] email "${normalized}" nie je platný formát (chýba @ alebo doména)`);
      // Stále hashujeme — Meta môže akceptovať, len EMQ bude nižšie
    }

    return { hash: this.sha256(normalized), warnings };
  }

  private processPhone(
    phone: string,
  ): { hash: string | null; warnings: string[] } {
    const warnings: string[] = [];

    // Detekcia dvojitého hashovania
    if (this.isAlreadyHashed(phone)) {
      warnings.push(
        `[PII] phone vyzerá ako SHA-256 hash — preskakujem hashovanie. Pošlite plaintext.`,
      );
      return { hash: phone, warnings };
    }

    // E.164 normalizácia: zachovaj "+" prefix, strip ostatné non-digits
    const hasPlus = phone.trim().startsWith('+');
    const digits = phone.replace(/\D/g, '');

    if (digits.length < PHONE_MIN_DIGITS) {
      warnings.push(`[PII] phone "${phone}" je príliš krátky (${digits.length} číslic, min ${PHONE_MIN_DIGITS})`);
      return { hash: null, warnings };
    }

    if (digits.length > PHONE_MAX_DIGITS) {
      warnings.push(
        `[PII] phone "${phone}" je príliš dlhý (${digits.length} číslic, max ${PHONE_MAX_DIGITS}) — orezávam na ${PHONE_MAX_DIGITS}`,
      );
    }

    // Meta odporúča E.164: +[country_code][number] (s plusom, bez medzier)
    const normalized = (hasPlus ? '+' : '') + digits.slice(0, PHONE_MAX_DIGITS);
    return { hash: this.sha256(normalized), warnings };
  }

  private processTextField(
    value: string,
    fieldName: string,
    lowercase = true,
  ): { hash: string | null; warnings: string[] } {
    const warnings: string[] = [];

    const normalized = lowercase ? value.toLowerCase().trim() : value.trim();

    // Detekcia dvojitého hashovania
    if (this.isAlreadyHashed(normalized)) {
      warnings.push(
        `[PII] ${fieldName} vyzerá ako SHA-256 hash — preskakujem hashovanie. Pošlite plaintext.`,
      );
      return { hash: normalized, warnings };
    }

    if (!normalized) {
      warnings.push(`[PII] ${fieldName} je prázdny reťazec — preskakujem`);
      return { hash: null, warnings };
    }

    return { hash: this.sha256(normalized), warnings };
  }

  // SHA-256 hash → 64-char hex string
  sha256(value: string): string {
    return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
  }

  // Detekcia či je vstup SHA-256 hash (64 znakov hexadecimálnych)
  private isAlreadyHashed(value: string): boolean {
    return SHA256_HEX_REGEX.test(value);
  }
}
