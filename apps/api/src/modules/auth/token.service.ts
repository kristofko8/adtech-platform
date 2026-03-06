import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class TokenService {
  constructor(private readonly prisma: PrismaService) {}

  async createRefreshToken(userId: string) {
    // Revoke staré refresh tokeny pre tohto používateľa (max 5 aktívnych)
    const activeTokens = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'asc' },
    });

    if (activeTokens.length >= 5) {
      // Revoke najstarší token
      await this.prisma.refreshToken.update({
        where: { id: activeTokens[0].id },
        data: { revokedAt: new Date() },
      });
    }

    const token = uuidv4();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 dní platnosť

    return this.prisma.refreshToken.create({
      data: {
        token,
        userId,
        expiresAt,
      },
    });
  }

  async revokeAllUserTokens(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
