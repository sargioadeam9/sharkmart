/**
 * Rate limiting — security.md §3.
 *
 * Public catalog reads use the fixed-window counter (`INCR` + `EXPIRE`): one
 * round trip, no sorted-set growth, and boundary precision does not matter for
 * a read endpoint. Auth and write endpoints use the sliding window, which lands
 * in Phase 8 with the routes that need it.
 *
 * Identity is the client IP for anonymous requests. `X-Forwarded-For` is only
 * trusted when `TRUST_PROXY` is set, because a spoofable header makes every
 * limit below decorative (security.md §3, "Resolve the client IP from the
 * trusted proxy header only").
 *
 * Fail-open: if the store is unavailable the request is allowed. A rate limiter
 * that takes the API down when Redis blips has caused the outage it exists to
 * prevent.
 */

import type { NextFunction, Request, Response } from 'express';
import { getStore } from '../config/redis.js';
import { fail } from '../types/api.js';

export interface LimitRule {
  /** Requests allowed per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
  /** Bucket name — `search`, `api`, `login`, … */
  scope: string;
}

/** The limits from security.md §3 that apply to Phase 6. */
export const LIMITS = {
  /** General public API surface. */
  api: { scope: 'api', limit: 100, windowSeconds: 60 },
  /** Search is heavier than a listing read, so it gets its own bucket. */
  search: { scope: 'search', limit: 30, windowSeconds: 60 },
} as const satisfies Record<string, LimitRule>;

/**
 * Client identity for the limit bucket.
 *
 * `req.ip` already honours Express's `trust proxy` setting, which `app.ts` sets
 * only in production behind one hop. Reading `X-Forwarded-For` by hand here
 * would bypass that guard.
 */
function identity(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

/**
 * Builds a fixed-window limiter middleware.
 *
 * Sends the three `X-RateLimit-*` headers on success too, so a well-behaved
 * client can back off before it is blocked (security.md §3).
 */
export function rateLimit(rule: LimitRule) {
  return async function limiter(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const windowStart = Math.floor(Date.now() / 1000 / rule.windowSeconds);
    const key = `rl:${rule.scope}:ip:${identity(req)}:${windowStart}`;
    const resetAt = (windowStart + 1) * rule.windowSeconds;

    let count: number;
    try {
      const store = await getStore();
      count = await store.incr(key, rule.windowSeconds);
    } catch {
      // Fail open — see the file header.
      next();
      return;
    }

    const remaining = Math.max(0, rule.limit - count);

    res.setHeader('X-RateLimit-Limit', String(rule.limit));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(resetAt));

    if (count > rule.limit) {
      res.setHeader('Retry-After', String(Math.max(1, resetAt - Math.floor(Date.now() / 1000))));
      res.status(429).json(fail('RATE_LIMITED', 'Too many requests. Try again shortly.'));
      return;
    }

    next();
  };
}
