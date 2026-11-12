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

import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { getStore } from '../config/redis.js';
import { env } from '../config/env.js';
import { fail } from '../types/api.js';

/** Header a trusted first-party service presents to skip the public limit. */
export const INTERNAL_TOKEN_HEADER = 'x-internal-token';

/**
 * True when the request presents the shared internal token.
 *
 * Why this exists: `next build` prerenders 168 product pages, 14 category pages
 * and the homepage, each calling this API from the Next server. That is one IP
 * and 500+ requests in seconds, which trips the 100/min public bucket and turns
 * a build into a 429 storm. The build is not an attacker; it is us.
 *
 * Why it is safe:
 *   - The token is compared with `timingSafeEqual`, so a wrong token cannot be
 *     discovered a byte at a time.
 *   - A missing token, a missing env var, or a length mismatch all fall through
 *     to the normal limit. There is no "empty token matches" path.
 *   - The token is never logged, never echoed, and never sent to a browser —
 *     `client.ts` only attaches it when `typeof window === 'undefined'`.
 *   - The public limit is untouched. An attacker without the token is limited
 *     exactly as before.
 */
function hasInternalToken(req: Request): boolean {
  const expected = env.INTERNAL_API_TOKEN;
  if (!expected) return false;

  const raw = req.headers[INTERNAL_TOKEN_HEADER];
  const presented = Array.isArray(raw) ? raw[0] : raw;
  if (!presented) return false;

  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  // timingSafeEqual throws on a length mismatch, so check it first. The length
  // of the secret is not itself secret.
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

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
  /**
   * Search is heavier than a listing read, so it gets its own bucket.
   *
   * 90/min, not 30: this bucket also serves the header's type-ahead, and a
   * 12-character query is ~12 requests on its own. At 30 a normal shopper hit a
   * 429 mid-word, which is the limiter failing the user it exists to protect.
   * 90 still bounds a `contains` scan at 1.5 req/s per IP, which is the actual
   * protection; the number is a rate, not a quota.
   */
  search: { scope: 'search', limit: 90, windowSeconds: 60 },
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
    // A trusted first-party caller (the Next server during a build) is not
    // subject to the public limit. See `hasInternalToken`.
    if (hasInternalToken(req)) {
      next();
      return;
    }

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
