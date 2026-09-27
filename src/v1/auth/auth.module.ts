import { Global, Module } from '@nestjs/common';
import { BetterAuthService } from './better-auth.service.js';
import { BetterAuthGuard } from './auth.guard.js';
import { AuthController } from './auth.controller.js';

@Global()
@Module({
  providers: [BetterAuthService, BetterAuthGuard],
  controllers: [AuthController],
  exports: [BetterAuthService, BetterAuthGuard],
})
export class AuthModule {}
