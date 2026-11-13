/**
 * Environment validation.
 *
 * Fails fast and loudly at boot rather than throwing a confusing Prisma error
 * on the first request. Every variable is declared here AND in .env.example —
 * AGENTS.md §7.11: a new variable ships in both in the same commit.
 */

import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required — see .env.example'),

  /**
   * Comma-separated list. Kept as a string here, split by the CORS setup.
   *
   * Both loopback spellings are listed by default. Next.js happily serves on
   * either, and a browser opened at 127.0.0.1 sends that origin — a default
   * covering only `localhost` rejects the login POST at the origin check, the
   * form never gets a session, and it reads like a broken frontend.
   */
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000,http://127.0.0.1:3000'),

  /**
   * Optional parent domain for the CSRF cookie, e.g. `.example.com`.
   *
   * Only needed when the storefront and the API are **different subdomains**
   * (`shop.example.com` + `api.example.com`, which is how shared hosting lays
   * them out). The CSRF cookie is host-only by default, so JavaScript on the
   * storefront cannot read a cookie the API set on its own subdomain — the
   * header goes out empty and every mutation 401s.
   *
   * Leave it unset for a single-origin deployment (both apps behind one host,
   * or the API proxied under `/api/v1`). Never set it in development.
   */
  COOKIE_DOMAIN: z.string().optional(),

  // Phase 8 — auth. Optional at parse time so the catalog-only suites and a
  // fresh clone still boot; `requireAuthSecrets()` below is what refuses to
  // serve auth routes without them.
  JWT_ACCESS_SECRET: z.string().optional(),
  JWT_REFRESH_SECRET: z.string().optional(),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL: z.string().default('7d'),

  /**
   * Cookie flag override.
   *
   * `Secure` is mandatory in production (security.md §4). Locally the API is
   * served over plain http on localhost, and a `Secure` cookie is silently
   * dropped by the browser — which would make every login appear to succeed and
   * then immediately be anonymous. So: forced true in production, defaulted to
   * false elsewhere, and overridable only outside production.
   */
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .optional(),

  // Phase 6 — Redis for cache, rate limiting and flash-sale timers.
  REDIS_URL: z.string().optional(),

  /**
   * Shared secret a trusted first-party service (the Next server) presents in
   * `X-Internal-Token` to skip the public rate limit. Optional: when unset, no
   * request can bypass the limiter, which is the safe default.
   *
   * Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   */
  INTERNAL_API_TOKEN: z.string().min(16).optional(),

  // Phase 13 — object storage for product images.
  S3_ENDPOINT: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    console.error(`\nInvalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill it in.\n`);
    process.exit(1);
  }

  return parsed.data;
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';

export const corsOrigins = env.CORS_ORIGINS.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

/**
 * Normalises `COOKIE_DOMAIN` to the leading-dot form Express expects.
 *
 * Exported so it can be tested without booting the app. A malformed value is
 * ignored rather than thrown: a browser silently rejects a cookie whose Domain
 * is a scheme or contains a path, and the symptom — "login does nothing" — is
 * expensive to trace back to an env typo.
 */
export function normalizeCookieDomain(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;

  if (value.includes('/') || value.includes(':')) {
    console.error(
      `[env] COOKIE_DOMAIN looks wrong (${value}) — expected a domain such as ".example.com". Ignoring it.`,
    );
    return undefined;
  }

  return value.startsWith('.') ? value : `.${value}`;
}

/** `.example.com`, or undefined when cookies should stay host-only. */
export const cookieDomain = normalizeCookieDomain(env.COOKIE_DOMAIN);

/**
 * `Secure` is not negotiable in production. Outside it, `COOKIE_SECURE` may
 * turn it on for a staging box behind https, but nothing can turn it off in
 * production — a config typo must not quietly downgrade session cookies.
 */
export const cookieSecure = isProduction ? true : env.COOKIE_SECURE === 'true';

/**
 * Throws if the auth secrets are missing or too weak.
 *
 * Called by the auth router at mount time, not at import time: the catalog
 * suites import `createApp()` and must not need auth secrets to run. A weak
 * secret is a real vulnerability (a 6-character HMAC key is brute-forceable
 * offline), so the floor is 32 characters and it is enforced, not documented.
 */
export function requireAuthSecrets(): { access: string; refresh: string } {
  const access = env.JWT_ACCESS_SECRET;
  const refresh = env.JWT_REFRESH_SECRET;

  if (!access || access.length < 32) {
    throw new Error(
      'JWT_ACCESS_SECRET must be set to at least 32 characters — auth routes cannot be served without it.',
    );
  }
  if (!refresh || refresh.length < 32) {
    throw new Error(
      'JWT_REFRESH_SECRET must be set to at least 32 characters — auth routes cannot be served without it.',
    );
  }
  if (access === refresh) {
    throw new Error(
      'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ — one leaked key must not mint both token types.',
    );
  }

  return { access, refresh };
}
