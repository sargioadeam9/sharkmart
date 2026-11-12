/**
 * The mock switch. One env var decides whether the app reads fixtures or the
 * real API. Nothing else in the codebase may check `USE_MOCK` — components
 * call the functions in this folder and never know the difference.
 *
 *   .env.local:  NEXT_PUBLIC_USE_MOCK=true
 *
 * Phase 1–5 ship with this true. Phase 6 flips it to false.
 */

export const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK !== 'false';

/**
 * Base URL of the API server. Only read when USE_MOCK is false.
 *
 * In the browser the host is taken from the page itself, keeping the configured
 * port. That is not cosmetic: `localhost` and `127.0.0.1` are different sites
 * for cookie purposes, and the session cookie is `SameSite=Lax`. A page served
 * from 127.0.0.1 that calls `localhost:4000` is cross-site, so the browser
 * withholds the cookie on the login response and the session never exists —
 * which looks exactly like a broken form. Deriving the host keeps page and API
 * on one site whichever spelling the developer opened.
 *
 * On the server `window` is undefined, so this stays the configured absolute
 * URL; server-to-server calls have no cookie origin to respect.
 */
function resolveApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

  if (typeof window === 'undefined') return configured;

  try {
    const target = new URL(configured);
    const page = new URL(window.location.href);

    // Only rewrite loopback hosts. A real deployment points at its own API
    // origin and must not be second-guessed.
    const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
    if (!loopback.has(target.hostname) || !loopback.has(page.hostname)) return configured;

    target.hostname = page.hostname;
    return target.origin;
  } catch {
    return configured;
  }
}

export const API_BASE_URL = resolveApiBaseUrl();

/** Versioned prefix — backend.md requires /api/v1/. */
export const API_PREFIX = '/api/v1';

/**
 * The largest page the API will serve.
 *
 * The server's validator caps `limit` at 100 (`MAX_LIMIT` in
 * server/src/validators/catalog.schema.ts) and rejects anything above it with a
 * 422 — it does not silently clamp. Asking for 200 used to fail the whole
 * `next build` at the first product page, because the detail loader requests a
 * full category to build its rails.
 *
 * Kept here as one constant so a future change to the server's cap has exactly
 * one frontend place to update, and so no call site re-types the number.
 */
export const MAX_PAGE_LIMIT = 100;
