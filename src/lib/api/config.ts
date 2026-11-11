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
