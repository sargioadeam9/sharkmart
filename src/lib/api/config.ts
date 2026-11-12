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

/** Base URL of the API server. Only read when USE_MOCK is false. */
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

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
