import { PrismaClient } from '@prisma/client';

// Singleton pattern pre Prisma klienta
// Zabraňuje vytvoreniu viacerých inštancií v development móde (hot reload)
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env['NODE_ENV'] === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
  });

if (process.env['NODE_ENV'] !== 'production') {
  globalForPrisma.prisma = prismaClient;
}
