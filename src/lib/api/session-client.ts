/**
 * The browser-side API client.
 *
 * `client.ts` is the *server* client: it sends no cookies and carries the
 * internal token. This one is the opposite, and the difference is the whole
 * point of the file:
 *
 *   - `credentials: 'include'` — the session lives in HttpOnly cookies
 *     (`sm_access`, `sm_refresh`), so a fetch without this arrives anonymous.
 *   - `X-CSRF-Token` — every state-changing request echoes the readable
 *     `csrf_token` cookie. `client.ts` never needs this; a server-to-server
 *     call has no cookie to be forged.
 *   - No `next: { revalidate }` — these are per-user reads. A cached `/me`
 *     would show one customer another customer's profile.
 *   - No internal token — it must never reach a browser bundle, and a
 *     logged-in user's own requests are not the build's mass prerender.
 *
 * Error handling matches `client.ts`: one `ApiClientError` for everything, so
 * a caller has a single thing to catch and a `code` to branch on.
 */

import type { ApiResponse, ApiFailure, ApiSuccess } from '@/types/api';
import { API_BASE_URL, API_PREFIX } from './config';

/** The readable cookie the server sets alongside the session. */
const CSRF_COOKIE = 'csrf_token';
const CSRF_HEADER = 'X-CSRF-Token';

export class SessionClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(failure: ApiFailure['error'], status: number) {
    super(failure.message);
    this.name = 'SessionClientError';
    this.code = failure.code;
    this.status = status;
    this.details = failure.details;
  }

  /** 401 means "not signed in" — the one case callers branch on. */
  get isUnauthenticated(): boolean {
    return this.status === 401;
  }
}

/** Reads the CSRF cookie. Returns '' when absent (a guest). */
export function readCsrfToken(): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${CSRF_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(CSRF_COOKIE.length + 1)) : '';
}

interface SessionRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Extra headers — `Idempotency-Key` for checkout. */
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/**
 * Calls the API as the signed-in (or guest) browser.
 *
 * Returns the unwrapped envelope on success and throws `SessionClientError`
 * otherwise, including on a transport failure — a caller that only handles
 * `!response.ok` would miss "the API is down", which is the failure a shopper
 * actually hits.
 */
export async function sessionFetch<T>(
  path: string,
  options: SessionRequestOptions = {},
): Promise<ApiSuccess<T>> {
  const { method = 'GET', body, headers = {}, signal } = options;
  const url = `${API_BASE_URL}${API_PREFIX}${path}`;

  const isStateChanging = method !== 'GET';
  const csrf = isStateChanging ? readCsrfToken() : '';

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      // The session cookie is HttpOnly; without this the request is anonymous.
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(csrf ? { [CSRF_HEADER]: csrf } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
      // Per-user data must never be served from a shared cache.
      cache: 'no-store',
    });
  } catch (error) {
    // An aborted request is the caller's own doing, not a transport failure.
    if (error instanceof DOMException && error.name === 'AbortError') throw error;

    throw new SessionClientError(
      {
        code: 'INTERNAL_ERROR',
        message: `Cannot reach the API at ${API_BASE_URL}. Is the server running?`,
      },
      0,
    );
  }

  let payload: ApiResponse<T>;
  try {
    payload = (await response.json()) as ApiResponse<T>;
  } catch {
    throw new SessionClientError(
      {
        code: 'INTERNAL_ERROR',
        message: `API returned non-JSON (HTTP ${response.status})`,
      },
      response.status,
    );
  }

  if (!payload.success) {
    throw new SessionClientError(payload.error, response.status);
  }

  return payload;
}

/** Convenience wrappers — the call sites read better than `{ method: 'POST' }`. */
export const sessionApi = {
  get: <T>(path: string, options?: Omit<SessionRequestOptions, 'method' | 'body'>) =>
    sessionFetch<T>(path, { ...options, method: 'GET' }),

  post: <T>(path: string, body?: unknown, options?: Omit<SessionRequestOptions, 'method' | 'body'>) =>
    sessionFetch<T>(path, { ...options, method: 'POST', body }),

  put: <T>(path: string, body?: unknown, options?: Omit<SessionRequestOptions, 'method' | 'body'>) =>
    sessionFetch<T>(path, { ...options, method: 'PUT', body }),

  del: <T>(path: string, options?: Omit<SessionRequestOptions, 'method' | 'body'>) =>
    sessionFetch<T>(path, { ...options, method: 'DELETE' }),
};
