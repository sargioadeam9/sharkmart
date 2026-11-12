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

  // ── Phase 8 — auth, cart, checkout (security.md §3) ────────────────────
  /** Login attempts per IP. Account lockout is separate and keyed on account. */
  login: { scope: 'login', limit: 5, windowSeconds: 60 },
  /** Registrations per IP — stops scripted account creation. */
  register: { scope: 'register', limit: 3, windowSeconds: 60 },
  /** Password reset requests per IP. */
  reset: { scope: 'reset', limit: 3, windowSeconds: 900 },
  /** Cart writes per user. */
  cart: { scope: 'cart', limit: 60, windowSeconds: 60 },
  /** Checkout attempts per user. */
  checkout: { scope: 'checkout', limit: 10, windowSeconds: 300 },
  /** Refresh rotation — generous, because a tab reload can legitimately burst. */
  refresh: { scope: 'refresh', limit: 30, windowSeconds: 60 },
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

/**
 * Sliding-window limiter — security.md §3.
 *
 * Why auth uses this and the catalog does not: a fixed window resets the
 * counter at a wall-clock boundary, so an attacker gets `2 × limit` attempts
 * across the boundary — exactly where a brute force lives. A sliding window
 * counts the last N seconds at every request, so there is no boundary to
 * exploit.
 *
 * Implementation: one key per `rlsw:{scope}:{identity}` holding a JSON array of
 * request timestamps in milliseconds. Each call trims entries older than the
 * window, counts what remains, and appends itself. One get plus one set, and
 * the array is bounded by `limit` (we stop appending once over), so it cannot
 * grow without bound.
 *
 * Read-modify-write is not atomic. For a rate limiter that is acceptable and
 * documented: two simultaneous requests can both read the same count and both
 * be admitted, which under-counts by at most the number of in-flight requests.
 * The alternative — a Lua script or a sorted set — needs a store method this
 * interface does not expose, and the failure mode here is "slightly generous
 * under a burst", not "no limit at all". The account lockout, which is the real
 * brute-force control, is not affected.
 *
 * `identity` is the caller's choice: IP for anonymous routes, `user:{id}` for
 * authenticated ones. Never mix the two in one bucket (security.md §3).
 */
export function slidingWindowLimit(rule: LimitRule, identityOf?: (req: Request) => string) {
  return async function limiter(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    if (hasInternalToken(req)) {
      next();
      return;
    }

    const bucketId: string = identityOf ? identityOf(req) : `ip:${identity(req)}`;
    const key = `rlsw:${rule.scope}:${bucketId}`;
    const now = Date.now();
    const windowStart = now - rule.windowSeconds * 1000;

    try {
      const store = await getStore();

      let stamps: number[] = [];
      const raw = await store.get(key);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (Array.isArray(parsed)) {
            stamps = parsed.filter((v): v is number => typeof v === 'number' && v > windowStart);
          }
        } catch {
          // A corrupt bucket reads as empty. Failing closed here would lock the
          // user out over a bad cache value.
          stamps = [];
        }
      }

      const remaining = Math.max(0, rule.limit - stamps.length);
      res.setHeader('X-RateLimit-Limit', String(rule.limit));
      res.setHeader('X-RateLimit-Remaining', String(remaining));
      res.setHeader('X-RateLimit-Reset', String(Math.ceil((now + rule.windowSeconds * 1000) / 1000)));

      if (stamps.length >= rule.limit) {
        res.setHeader('Retry-After', String(rule.windowSeconds));
        res.status(429).json(fail('RATE_LIMITED', 'Too many requests. Try again shortly.'));
        return;
      }

      stamps.push(now);
      // TTL is the window itself: once every entry has aged out the key is
      // worthless, so let it expire rather than leak.
      await store.set(key, JSON.stringify(stamps), rule.windowSeconds + 1);
      next();
    } catch {
      // Fail open — a limiter that takes auth down when Redis blips has caused
      // the outage it exists to prevent.
      next();
    }
  };
}

/**
 * Progressive account lockout — security.md §3.
 *
 * Keyed on the **account**, never the IP: an attacker rotating IPs must not
 * reset the counter. Thresholds are the documented ones:
 *
 *   | failures | consequence                    |
 *   | 5        | 1 minute lock                  |
 *   | 10       | 15 minute lock                 |
 *   | 20       | 24 hours (manual unlock)       |
 *
 * The lock state is never revealed. A locked account returns the same generic
 * "invalid credentials" message as a wrong password, so the lock cannot be used
 * as an oracle to confirm an account exists.
 */
const LOCKOUT_TTL = 24 * 60 * 60;

interface LockoutState {
  failures: number;
  lockedUntil: number;
}

function lockoutKey(account: string): string {
  return `lockout:${account}`;
}

/** Normalises an email or phone into one account key. */
export function accountKey(identifier: string): string {
  const trimmed = identifier.trim().toLowerCase();
  // Strip formatting from a phone so +880 1712-345678 and 01712345678 collide.
  return /^[+\d][\d\s-]*$/.test(trimmed)
    ? trimmed.replace(/[^\d]/g, '')
    : trimmed;
}

export async function readLockout(account: string): Promise<LockoutState> {
  try {
    const store = await getStore();
    const raw = await store.get(lockoutKey(account));
    if (!raw) return { failures: 0, lockedUntil: 0 };
    return JSON.parse(raw) as LockoutState;
  } catch {
    return { failures: 0, lockedUntil: 0 };
  }
}

/** True when the account is currently locked. */
export async function isLockedOut(account: string): Promise<boolean> {
  const state = await readLockout(account);
  return state.lockedUntil > Date.now();
}

/**
 * Records a failed attempt and applies the next lock threshold.
 *
 * Returns the state so the caller can log the event — security.md §12 requires
 * lockouts in the log.
 */
export async function recordFailedLogin(account: string): Promise<LockoutState> {
  const current = await readLockout(account);
  const failures = current.failures + 1;

  let lockMs = 0;
  if (failures >= 20) lockMs = LOCKOUT_TTL * 1000;
  else if (failures >= 10) lockMs = 15 * 60 * 1000;
  else if (failures >= 5) lockMs = 60 * 1000;

  const next: LockoutState = {
    failures,
    lockedUntil: lockMs > 0 ? Date.now() + lockMs : current.lockedUntil,
  };

  try {
    const store = await getStore();
    await store.set(lockoutKey(account), JSON.stringify(next), LOCKOUT_TTL);
  } catch {
    // Fail open on the store, as everywhere else.
  }

  return next;
}

/** Clears the counter — a successful login. */
export async function clearLockout(account: string): Promise<void> {
  try {
    const store = await getStore();
    await store.del(lockoutKey(account));
  } catch {
    // Nothing to do.
  }
}
