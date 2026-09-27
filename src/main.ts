import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import { AppModule } from './app.module.js';
import { AppLogger, log, error, LogKey } from './logger/index.js';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { tenantContextMiddleware } from './prisma/tenant-context.middleware.js';

// Process-level safety nets. Without these a stray rejection (e.g. a
// fire-and-forget email) or a truly uncaught error would terminate the process
// with no structured log. Registered before bootstrap so they also cover startup.
process.on('unhandledRejection', (reason) => {
  error(LogKey.APP_UNHANDLED_REJECTION, 'Unhandled promise rejection', {
    reason: String(reason),
  });
});
process.on('uncaughtException', (err) => {
  error(LogKey.APP_UNCAUGHT_EXCEPTION, 'Uncaught exception — exiting', {
    err: String(err),
    ...(err instanceof Error && err.stack ? { stack: err.stack } : {}),
  });
  // State is undefined after an uncaught exception; exit so Railway restarts clean.
  process.exit(1);
});

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    logger: new AppLogger(),
  });

  // Railway terminates TLS at a proxy and forwards X-Forwarded-For. Trust the
  // first hop so `req.ip` is the real client address — the rate limiter keys on
  // it, so without this every request would appear to come from the proxy.
  app.set('trust proxy', 1);

  // Cap request bodies. Generous enough for the largest legitimate payloads (the
  // 1000-item batch-punch endpoint) but bounded so a client can't stream an
  // oversized body. rawBody capture for the Stripe webhook is preserved because
  // rawBody:true was passed to NestFactory.create above.
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { limit: '1mb', extended: true });

  // First middleware: opens the per-request tenant-context store (RLS user id)
  // so it wraps guards, controllers, services, and every Prisma call.
  app.use(tenantContextMiddleware);

  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      // Instantiate DTO classes and run nested @Type/@ValidateNested transforms so
      // whitelisting reliably strips unknown props inside nested array items too.
      transform: true,
    }),
  );

  const allowedOrigins = (process.env.FRONTEND_URL ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  // In production only the explicit FRONTEND_URL allowlist is honoured. In dev we
  // also accept any localhost or private-LAN origin, so the terminal and app dev
  // servers work no matter which port Vite/Expo binds, and a phone on the same
  // Wi-Fi can reach them by LAN IP (needed to scan the pairing QR).
  //
  // Fail-safe: treat anything that isn't explicitly `development` as production,
  // so a deployed instance where NODE_ENV is unset does NOT fall into the
  // credentialed dev-CORS bypass. Local dev sets NODE_ENV=development (see the
  // start:dev/start:debug npm scripts).
  const isProd = process.env.NODE_ENV !== 'development';
  // `([a-z0-9-]+\.)*localhost` also trusts per-surface dev subdomains such as
  // `admin.localhost` / `app.localhost`, which the BFF proxy setup uses to give
  // each surface its own origin (and therefore its own session cookie) locally.
  const devOrigin =
    /^https?:\/\/(([a-z0-9-]+\.)*localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/;

  // Every kiosk terminal serves its SPA from this fixed localhost origin (the OS
  // repo's on-device kiosk_server on :8080), in all environments. NODE_ENV is
  // 'production' on any deployed (Railway) backend — test included — so the
  // dev-only bypass above never runs there; trust the kiosk origin explicitly so
  // real devices can reach test/prod without enumerating each one in FRONTEND_URL.
  const KIOSK_ORIGIN = 'http://localhost:8080';

  app.enableCors({
    origin: (origin, cb) => {
      // Non-browser clients (curl, server-to-server) send no Origin header.
      if (!origin) return cb(null, true);
      if (origin === KIOSK_ORIGIN) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      if (!isProd && devOrigin.test(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
  });
  app.setGlobalPrefix('api/v1');

  if (process.env.DOCS_ENABLED === 'true') {
    const config = new DocumentBuilder()
      .setTitle('Taplino API')
      .setDescription('Multi-tenant NFC card platform API for Taplino')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);

    app.use('/docs/openapi.json', (_req, res) => res.json(document));
    app.use(
      '/docs',
      apiReference({ spec: { url: '/docs/openapi.json' } }),
    );
  }

  // Drain in-flight work and run onModuleDestroy (PrismaService.$disconnect) on
  // SIGTERM — Railway sends it on every redeploy.
  app.enableShutdownHooks();

  const port = process.env.PORT ?? 3311;
  await app.listen(port, '0.0.0.0');
  log(LogKey.APP_BOOTSTRAP, 'Server listening', { port });
}
bootstrap();