/**
 * Leveled logger that respects build mode.
 *
 * In production builds, trace/debug/info are no-ops.
 * In development, all levels print with category prefix.
 *
 * Usage:
 *   import { logger } from '@/utils/logger';
 *   const log = logger('MyService');
 *   log.debug('loading file', { path });
 *   log.warn('unexpected state');
 */

const IS_DEV = import.meta.env?.DEV ?? (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production');

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
};

/** Minimum level that actually emits output */
const MIN_LEVEL: LogLevel = IS_DEV ? 'trace' : 'warn';

export interface Logger {
  trace(msg: string, data?: unknown): void;
  debug(msg: string, data?: unknown): void;
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = () => {};

function makeLogFn(level: LogLevel, category: string): (msg: string, data?: unknown) => void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[MIN_LEVEL]) return noop;

  const prefix = `[${category}]`;
  switch (level) {
    case 'trace':
    case 'debug':
      return (msg, data) => data !== undefined ? console.debug(prefix, msg, data) : console.debug(prefix, msg);
    case 'info':
      return (msg, data) => data !== undefined ? console.info(prefix, msg, data) : console.info(prefix, msg);
    case 'warn':
      return (msg, data) => data !== undefined ? console.warn(prefix, msg, data) : console.warn(prefix, msg);
    case 'error':
      return (msg, data) => data !== undefined ? console.error(prefix, msg, data) : console.error(prefix, msg);
  }
}

/** Create a category-scoped logger */
export function logger(category: string): Logger {
  return {
    trace: makeLogFn('trace', category),
    debug: makeLogFn('debug', category),
    info: makeLogFn('info', category),
    warn: makeLogFn('warn', category),
    error: makeLogFn('error', category),
  };
}
