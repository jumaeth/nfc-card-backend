import { Global, Module } from '@nestjs/common';
import { BetterAuthService } from './better-auth.service.js';
import { BetterAuthGuard } from './auth.guard.js';
import { AuthController } from './auth.controller.js';
import { PlatformRoleGuard } from './platform-role.guard.js';

@Global()
@Module({
  providers: [BetterAuthService, BetterAuthGuard, PlatformRoleGuard],
  controllers: [AuthController],
  exports: [BetterAuthService, BetterAuthGuard, PlatformRoleGuard],
})
export class AuthModule {}
