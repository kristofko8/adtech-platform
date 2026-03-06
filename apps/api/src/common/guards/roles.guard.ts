import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) return false;

    const roleHierarchy: Record<UserRole, number> = {
      SUPER_ADMIN: 4,
      MEDIA_BUYER: 3,
      ANALYST: 2,
      CLIENT: 1,
    };

    const userLevel = roleHierarchy[user.role as UserRole] || 0;
    const minRequired = Math.min(...requiredRoles.map(r => roleHierarchy[r]));

    if (userLevel < minRequired) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
