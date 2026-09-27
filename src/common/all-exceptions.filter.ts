import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Prisma } from '../../generated/prisma/client.js';
import { error, warn, LogKey } from '../logger/index.js';

/**
 * Prisma error codes that mean "the database is unreachable / dropped the
 * connection", as opposed to a bad query. These are transient — the client
 * should back off and retry, so we answer 503 + Retry-After rather than a
 * generic 500 that reads as "this request is broken, don't bother retrying".
 * P1001 can't reach server · P1002 server timed out · P1008 op timed out ·
 * P1017 server closed the connection.
 */
const DB_UNAVAILABLE_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017']);

/**
 * Fallback codes from the underlying `pg` driver, for cases where the pg adapter
 * throws a raw error (or a PrismaClientInitializationError wrapping one) instead
 * of a tidy Prisma P100x. Two families:
 *  - Node socket errors (`err.code`): connection refused/reset/timed out, DNS.
 *  - Postgres SQLSTATE (`err.code` on a pg error): class 08 (connection
 *    exception) and 57P0x (admin/crash shutdown, cannot-connect-now) — exactly
 *    what a restart for a migration or security patch produces.
 */
const PG_UNAVAILABLE_CODES = new Set([
  // Node socket / DNS
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EPIPE',
  'EHOSTUNREACH',
  // Postgres SQLSTATE — class 08 connection_exception
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  // Postgres SQLSTATE — 57P0x operator intervention / shutdown
  '57P01',
  '57P02',
  '57P03',
]);
const RETRY_AFTER_SECONDS = 5;

/** Walk an error and its `.cause` chain for a pg/Node connectivity `code`. */
function hasPgUnavailableCode(err: unknown, depth = 0): boolean {
  if (depth > 5 || err === null || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' && PG_UNAVAILABLE_CODES.has(code)) return true;
  return hasPgUnavailableCode((err as { cause?: unknown }).cause, depth + 1);
}

/** True when the error signals DB connectivity loss rather than a query fault. */
export function isDbUnavailable(exception: unknown): boolean {
  if (exception instanceof Prisma.PrismaClientInitializationError) return true;
  if (
    exception instanceof Prisma.PrismaClientKnownRequestError &&
    DB_UNAVAILABLE_CODES.has(exception.code)
  ) {
    return true;
  }
  return hasPgUnavailableCode(exception);
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    // Database unreachable → 503 + Retry-After so clients back off and retry
    // instead of treating it as a permanent failure.
    if (isDbUnavailable(exception)) {
      warn(LogKey.DB_UNAVAILABLE, `${req.method} ${req.url} → 503 (database unreachable)`, {
        err: String(exception),
      });
      if (!res.headersSent) {
        res.setHeader('Retry-After', String(RETRY_AFTER_SECONDS));
        res.status(HttpStatus.SERVICE_UNAVAILABLE).json({
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          message: 'Service temporarily unavailable, please retry',
        });
      }
      return;
    }

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : String(exception);

    const stack = exception instanceof Error ? exception.stack : undefined;

    error('app.error', `${req.method} ${req.url} → ${status}`, {
      status,
      message: typeof message === 'object' ? JSON.stringify(message) : String(message),
      ...(stack && status >= 500 ? { stack } : {}),
    });

    if (res.headersSent) return;

    if (exception instanceof HttpException) {
      res.status(status).json(exception.getResponse());
    } else {
      res.status(status).json({ statusCode: status, message: 'Internal server error' });
    }
  }
}
