// Re-export generated Prisma client (Prisma 7 - prisma-client generator)
// This avoids pnpm workspace module resolution issues with @prisma/client
export { PrismaClient, Prisma } from './generated/client.js';
export * from './generated/enums.js';
export type * from './generated/models.js';
export type * from './generated/commonInputTypes.js';
export { prismaClient } from './lib/prisma.client.js';
