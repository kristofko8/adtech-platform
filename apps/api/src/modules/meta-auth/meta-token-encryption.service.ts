import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class MetaTokenEncryptionService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly keyBuffer: Buffer;

  constructor(private readonly config: ConfigService) {
    const secret = config.get<string>('appSecret') || 'dev-secret-min-32-chars-long!!!!!';
    // Odvodiť 32-bajtový kľúč z APP_SECRET pomocou SHA-256
    this.keyBuffer = crypto.createHash('sha256').update(secret).digest();
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
