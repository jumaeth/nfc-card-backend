import { Controller, Get, HttpCode, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../prisma/prisma.service.js';
import { warn, LogKey } from '../../logger/index.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Liveness: is the process up and serving? Deliberately does NOT touch the DB.
   * This is the Railway healthcheck target — a transient DB blip (a Postgres
   * restart for a security patch, a brief migration lock) must not make the
   * platform kill an otherwise-healthy container and trigger a restart storm.
   */
  @Get()
  check() {
    return { status: 'ok' };
  }

  /**
   * Readiness: can the app actually serve requests that need the DB? Pings the
   * connection and returns 503 when it's unreachable, so load balancers and
   * uptime monitors can route traffic away / alert during a DB outage.
   */
  @Get('ready')
  @HttpCode(200)
  async ready() {
    const dbUp = await this.prisma.ping();
    if (!dbUp) {
      warn(LogKey.DB_HEALTH_DOWN, 'Readiness check failed: database unreachable');
      throw new ServiceUnavailableException({
        status: 'unavailable',
        checks: { database: 'down' },
      });
    }
    return { status: 'ok', checks: { database: 'up' } };
  }
}
