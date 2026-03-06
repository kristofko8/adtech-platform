import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: { name: string; slug: string }) {
    const existing = await this.prisma.organization.findUnique({
      where: { slug: data.slug },
    });
    if (existing) throw new ConflictException('Organization slug already exists');

    return this.prisma.organization.create({ data });
  }

  async findById(id: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id },
      include: {
        users: { select: { id: true, email: true, name: true, role: true } },
        adAccounts: true,
      },
    });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async findAll() {
    return this.prisma.organization.findMany({
      include: { _count: { select: { users: true, adAccounts: true } } },
    });
  }
}
