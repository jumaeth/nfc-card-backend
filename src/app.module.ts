import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module.js';
import { EmailModule } from './email/email.module.js';
import { V1Module } from './v1/v1.module.js';

// The tenant-context middleware is registered globally in main.ts via app.use()
// (Express 5 rejects the bare '*' route pattern used by MiddlewareConsumer).
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Baseline per-IP rate limit applied to every route (the ThrottlerGuard keys
    // each route separately, so this is a generous DoS backstop, not a shared
    // budget). Sensitive endpoints tighten this with a per-route @Throttle, and
    // better-auth applies its own stricter limits to /auth/** (see
    // BetterAuthService). `trust proxy` is set in main.ts so req.ip is the real
    // client behind Railway's proxy, not the proxy hop.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    EmailModule,
    V1Module,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
