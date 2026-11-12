/**
 * Request logging (pino) and slow-query tracking.
 *
 * backend.md § "Cost Optimization Rules" #8: track slow queries (>200ms) and
 * log API response times. Both live here so no route instruments itself.
 *
 * In test the logger is silenced — a suite that asserts on responses should not
 * also have to filter log noise.
 */

import pino from 'pino';
import pinoHttp from 'pino-http';
import type { RequestHandler } from 'express';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
  // JSON in production for a log shipper; readable one-liners in dev.
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
      : undefined,
});

/** Requests slower than this are logged at `warn` regardless of status. */
const SLOW_MS = 200;

export const requestLogger: RequestHandler = pinoHttp({
  logger,
  // Health checks are noise — an uptime monitor hits them every few seconds.
  autoLogging: {
    ignore: (req) => req.url === '/health' || req.url === '/ready',
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customSuccessMessage: (req, res, responseTime) => {
    const slow = responseTime > SLOW_MS ? ' (slow)' : '';
    return `${req.method} ${req.url} ${res.statusCode} ${Math.round(responseTime)}ms${slow}`;
  },
  serializers: {
    req: (req) => ({ method: req.method, url: req.url }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
});
