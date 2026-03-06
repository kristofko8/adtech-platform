import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@Controller('organizations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrganizationsController {
  constructor(private readonly orgsService: OrganizationsService) {}

  @Post()
  @Roles(UserRole.SUPER_ADMIN)
  create(@Body() body: { name: string; slug: string }) {
    return this.orgsService.create(body);
  }

  @Get()
  @Roles(UserRole.SUPER_ADMIN)
  findAll() {
    return this.orgsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    // Používateľ môže vidieť len svoju organizáciu (ak nie je SUPER_ADMIN)
    return this.orgsService.findById(user.role === 'SUPER_ADMIN' ? id : user.organizationId);
  }
}
