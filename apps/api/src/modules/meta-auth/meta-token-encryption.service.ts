import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class MetaTokenEncryptionService implements OnModuleInit {
  private readonly algorithm = 'aes-256-gcm';
  private readonly keyBuffer: Buffer;

  // Minimálna dĺžka tajomstva (znakov pred hashovaním)
  private static readonly MIN_SECRET_LENGTH = 32;

  constructor(private readonly config: ConfigService) {
    const secret = config.get<string>('appSecret');

    // Žiadny fallback — ak APP_SECRET chýba alebo je príliš krátky, zastavíme aplikáciu
    if (!secret || secret.trim().length === 0) {
      throw new Error(
        '[MetaTokenEncryptionService] APP_SECRET nie je nastavená. ' +
        'Táto premenná je povinná pre šifrovanie Meta access tokenov.',
      );
    }

    if (secret.length < MetaTokenEncryptionService.MIN_SECRET_LENGTH) {
      throw new Error(
        `[MetaTokenEncryptionService] APP_SECRET musí mať aspoň ` +
        `${MetaTokenEncryptionService.MIN_SECRET_LENGTH} znakov (má ${secret.length}).`,
      );
    }

    // Odvodiť 32-bajtový kľúč z APP_SECRET pomocou SHA-256
    this.keyBuffer = crypto.createHash('sha256').update(secret).digest();
  }

  onModuleInit(): void {
    // Overíme, že keyBuffer bol správne inicializovaný (32 bajtov pre AES-256)
    if (this.keyBuffer.length !== 32) {
      throw new Error('[MetaTokenEncryptionService] Interná chyba: neplatná dĺžka kľúča.');
    }
  }

  encrypt(token: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(this.algorithm, this.keyBuffer, iv);

    const encrypted = Buffer.concat([
      cipher.update(token, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    // Format: iv_hex:authTag_hex:encrypted_hex
    return [
      iv.toString('hex'),
      authTag.toString('hex'),
      encrypted.toString('hex'),
    ].join(':');
  }

  decrypt(encryptedToken: string): string {
    const [ivHex, authTagHex, encryptedHex] = encryptedToken.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');

    const decipher = crypto.createDecipheriv(this.algorithm, this.keyBuffer, iv);
    decipher.setAuthTag(authTag);

    return decipher.update(encrypted) + decipher.final('utf8');
  }
}
