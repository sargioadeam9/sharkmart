/**
 * Session cookies and CSRF — security.md §4 and §9.
 *
 * Cookie design, and why each flag is what it is:
 *
 *   - `HttpOnly` — JS cannot read the token, so an XSS cannot exfiltrate a
 *     session. AGENTS.md §7.5 forbids tokens in localStorage for this reason.
 *   - `Secure` — https only. Forced on in production by `cookieSecure`.
 *   - `SameSite=Lax` — **not** `Strict`. bKash, Nagad and card gateways return
 *     the buyer with a top-level cross-site GET. Under `Strict` the browser
 *     withholds the cookie on that navigation and the return handler sees an
 *     anonymous user, breaking order confirmation. `Lax` still blocks the
 *     cross-site POST that CSRF actually needs.
 *   - Refresh cookie `Path=/api/v1/auth` — it is only ever needed by the auth
 *     routes, so it is not attached to catalog requests at all. Smaller blast
 *     radius, less header weight on every read.
 *
 * CSRF: `SameSite=Lax` already blocks cross-site POST, so this is defence in
 * depth, not the only wall. The token is a double-submit: a random value in a
 * **non**-HttpOnly cookie the client can read, echoed back in `X-CSRF-Token`,
 * compared timing-safely. Plus an Origin check on every non-GET.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { cookieDomain, cookieSecure, corsOrigins, isProduction } from '../config/env.js';
import { fail } from '../types/api.js';
import { ACCESS_TTL_SECONDS, REFRESH_TTL_SECONDS } from '../services/token.service.js';

export const ACCESS_COOKIE = 'sm_access';
export const REFRESH_COOKIE = 'sm_refresh';
export const CSRF_COOKIE = 'csrf_token';
export const CSRF_HEADER = 'x-csrf-token';

/** The refresh cookie is scoped to the auth routes only. */
const REFRESH_PATH = '/api/v1/auth';

function baseCookie(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: 'lax' as const,
    maxAge: maxAgeSeconds * 1000,
  };
}

/** Writes the access + refresh cookies and refreshes the CSRF cookie. */
export function setSessionCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string },
): void {
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...baseCookie(ACCESS_TTL_SECONDS),
    path: '/',
  });

  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...baseCookie(REFRESH_TTL_SECONDS),
    path: REFRESH_PATH,
  });

  setCsrfCookie(res);
}

/**
 * The CSRF cookie is deliberately readable by JS (`httpOnly: false`) — the
 * client must echo it in a header, which it cannot do with an HttpOnly value.
 * That is safe: the value is not a credential on its own, it only proves the
 * request came from a page on our origin.
 */
export function setCsrfCookie(res: Response): string {
  const token = randomBytes(32).toString('hex');
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false,
    secure: cookieSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: REFRESH_TTL_SECONDS * 1000,
    /**
     * Only the CSRF cookie gets a parent domain, and only when the deployment
     * is split across subdomains (`COOKIE_DOMAIN=.example.com`).
     *
     * The storefront reads this value with `document.cookie` and echoes it in a
     * header. If the API sets it on `api.example.com` host-only, a page on
     * `shop.example.com` cannot see it, so every POST/PATCH/DELETE goes out with
     * an empty `X-CSRF-Token` and is rejected. Sharing the cookie across the
     * parent domain is what makes the double-submit work.
     *
     * The access and refresh cookies deliberately do NOT get a domain: they are
     * only ever sent to the API, and widening them would expose the session to
     * every other subdomain on the domain.
     */
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  });
  return token;
}

export function clearSessionCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { path: '/', secure: cookieSecure, sameSite: 'lax' });
  res.clearCookie(REFRESH_COOKIE, { path: REFRESH_PATH, secure: cookieSecure, sameSite: 'lax' });
  res.clearCookie(CSRF_COOKIE, { path: '/', secure: cookieSecure, sameSite: 'lax' });
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Origin allowlist check — security.md §9.4.
 *
 * `Origin` is checked first because it is the honest header on a cross-origin
 * request; `Referer` is the fallback for older clients. A request with neither
 * is allowed only when it is not a browser-style request (no `Origin` at all is
 * normal for server-to-server and for same-origin GETs in some clients).
 */
function originAllowed(req: Request): boolean {
  const origin = req.headers.origin;
  if (origin) return corsOrigins.includes(origin);

  const referer = req.headers.referer;
  if (referer) {
    try {
      return corsOrigins.includes(new URL(referer).origin);
    } catch {
      return false;
    }
  }

  // No Origin and no Referer. Non-browser clients (curl, the test suite, a
  // server-side fetch) land here. They cannot be CSRF'd — CSRF needs a browser
  // to attach ambient cookies — so this is allowed.
  return true;
}

/**
 * CSRF guard for state-changing routes.
 *
 * Skipped entirely for requests with no session cookies: an anonymous POST has
 * no ambient authority to abuse, and requiring a token on `POST /auth/login`
 * would mean issuing one to a visitor who has no session yet.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }

  if (!originAllowed(req)) {
    res.status(403).json(fail('FORBIDDEN', 'Request origin is not allowed.'));
    return;
  }

  const hasSession = Boolean(req.cookies?.[ACCESS_COOKIE] || req.cookies?.[REFRESH_COOKIE]);
  if (!hasSession) {
    // Anonymous request: no ambient credential, nothing to forge.
    next();
    return;
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.headers[CSRF_HEADER];

  const presented = Array.isArray(headerToken) ? headerToken[0] : headerToken;

  if (!cookieToken || !presented || !safeEqual(cookieToken, presented)) {
    res.status(403).json(fail('FORBIDDEN', 'Missing or invalid CSRF token.'));
    return;
  }

  next();
}

/**
 * In production every cookie is `Secure`, so a plain-http request that carries
 * one is a misconfiguration worth failing loudly on rather than silently
 * accepting. Outside production this is a no-op.
 */
export function requireSecureTransport(req: Request, res: Response, next: NextFunction): void {
  if (isProduction && !req.secure) {
    res.status(400).json(fail('VALIDATION_ERROR', 'HTTPS is required.'));
    return;
  }
  next();
}
