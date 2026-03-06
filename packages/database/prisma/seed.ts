import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Vytvorenie základnej organizácie
  const org = await prisma.organization.upsert({
    where: { slug: 'demo-agency' },
    update: {},
    create: {
      name: 'Demo Agency',
      slug: 'demo-agency',
    },
  });

  // Super Admin používateľ
  const adminPassword = await bcrypt.hash('Admin@123456', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@demo-agency.com' },
    update: {},
    create: {
      email: 'admin@demo-agency.com',
      name: 'Admin User',
      passwordHash: adminPassword,
      role: UserRole.SUPER_ADMIN,
      organizationId: org.id,
    },
  });

  // Media Buyer používateľ
  const buyerPassword = await bcrypt.hash('Buyer@123456', 12);
  await prisma.user.upsert({
    where: { email: 'buyer@demo-agency.com' },
    update: {},
    create: {
      email: 'buyer@demo-agency.com',
      name: 'Media Buyer',
      passwordHash: buyerPassword,
      role: UserRole.MEDIA_BUYER,
      organizationId: org.id,
    },
  });

  // Analyst používateľ
  const analystPassword = await bcrypt.hash('Analyst@123456', 12);
  await prisma.user.upsert({
    where: { email: 'analyst@demo-agency.com' },
    update: {},
    create: {
      email: 'analyst@demo-agency.com',
      name: 'Data Analyst',
      passwordHash: analystPassword,
      role: UserRole.ANALYST,
      organizationId: org.id,
    },
  });

  console.log('Seed completed:');
  console.log(`  Organization: ${org.name} (${org.slug})`);
  console.log(`  Admin: admin@demo-agency.com / Admin@123456`);
  console.log(`  Buyer: buyer@demo-agency.com / Buyer@123456`);
  console.log(`  Analyst: analyst@demo-agency.com / Analyst@123456`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
