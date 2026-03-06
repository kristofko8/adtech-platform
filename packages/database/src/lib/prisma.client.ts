import { PrismaClient } from '../generated/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

// Singleton pattern pre Prisma klienta (Prisma 7)
// Zabraňuje vytvoreniu viacerých inštancií v development móde (hot reload)
function createClient(): PrismaClient {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    throw new Error('[prismaClient] DATABASE_URL nie je nastavená');
  }
  const adapter = new PrismaPg({ connectionString });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new PrismaClient({ adapter } as any);
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prismaClient =
  globalForPrisma.prisma ?? createClient();

if (process.env['NODE_ENV'] !== 'production') {
  globalForPrisma.prisma = prismaClient;
}
