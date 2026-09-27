import type { LoggerService } from '@nestjs/common';
import type { LogKeyValue } from './keys.js';

type Level = 'info' | 'warn' | 'error' | 'debug';
type Meta = Record<string, unknown>;

// ─── ANSI helpers ─────────────────────────────────────────────────────────────

const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  white:  '\x1b[37m',
  gray:   '\x1b[90m',
  // domain colours
  email:   '\x1b[35m', // magenta
  billing: '\x1b[32m', // green
  report:  '\x1b[34m', // blue
  auth:    '\x1b[36m', // cyan
  msp:     '\x1b[33m', // yellow
  db:      '\x1b[31m', // red
  nest:    '\x1b[90m', // gray
  app:     '\x1b[37m', // white
};

const LEVEL_COLOR: Record<Level, string> = {
  info:  c.cyan,
  warn:  c.yellow,
  error: c.red,
  debug: c.gray,
};

const LEVEL_LABEL: Record<Level, string> = {
  info:  'INFO ',
  warn:  'WARN ',
  error: 'ERROR',
  debug: 'DEBUG',
};

function domainColor(key: string): string {
  const domain = key.split('.')[0];
  return (c as Record<string, string>)[domain] ?? c.white;
}

function formatTty(level: Level, key: string, msg: string, meta?: Meta): string {
  const time = new Date().toTimeString().slice(0, 8);
  const lc = LEVEL_COLOR[level];
  const dc = domainColor(key);

  let line = `${c.gray}${time}${c.reset} ${lc}${c.bold}${LEVEL_LABEL[level]}${c.reset} ${dc}${key}${c.reset}  ${c.white}${msg}${c.reset}`;

  if (meta && Object.keys(meta).length > 0) {
    const pairs = Object.entries(meta)
      .map(([k, v]) => `${c.gray}${k}${c.reset}=${c.dim}${String(v)}${c.reset}`)
      .join('  ');
    line += `  ${pairs}`;
  }

  return line;
}

// ─── Core write ───────────────────────────────────────────────────────────────

const isTty = process.stdout.isTTY === true;

function write(level: Level, key: LogKeyValue | string, msg: string, meta?: Meta): void {
  if (isTty) {
    const line = formatTty(level, key, msg, meta);
    level === 'error' ? console.error(line) : console.log(line);
  } else {
    const entry = { ts: new Date().toISOString(), level, key, msg, ...meta };
    const line = JSON.stringify(entry);
    level === 'error' ? console.error(line) : console.log(line);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const log   = (key: LogKeyValue | string, msg: string, meta?: Meta) => write('info',  key, msg, meta);
export const warn  = (key: LogKeyValue | string, msg: string, meta?: Meta) => write('warn',  key, msg, meta);
export const error = (key: LogKeyValue | string, msg: string, meta?: Meta) => write('error', key, msg, meta);
export const debug = (key: LogKeyValue | string, msg: string, meta?: Meta) => write('debug', key, msg, meta);

/** NestJS LoggerService adapter — pass to NestFactory.create() */
export class AppLogger implements LoggerService {
  log(message: unknown, context?: string) {
    write('info',  `nest.${(context ?? 'app').toLowerCase()}`, String(message));
  }
  warn(message: unknown, context?: string) {
    write('warn',  `nest.${(context ?? 'app').toLowerCase()}`, String(message));
  }
  error(message: unknown, trace?: string, context?: string) {
    write('error', `nest.${(context ?? 'app').toLowerCase()}`, String(message), trace ? { trace } : undefined);
  }
  debug(message: unknown, context?: string) {
    write('debug', `nest.${(context ?? 'app').toLowerCase()}`, String(message));
  }
  verbose(message: unknown, context?: string) {
    write('debug', `nest.${(context ?? 'app').toLowerCase()}`, String(message));
  }
  fatal(message: unknown, context?: string) {
    write('error', `nest.${(context ?? 'app').toLowerCase()}`, String(message));
  }
}

export { LogKey } from './keys.js';
