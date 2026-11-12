/**
 * The browser half of the admin API client.
 *
 * ── Why this file exists separately ────────────────────────────────────────
 *
 * `admin.ts` imports `next/headers` at module scope, because `adminFetchServer`
 * needs `cookies()`. That import is server-only, and Next refuses to bundle a
 * module that reaches it into a Client Component — which is exactly what
 * happened the first time the products editor (a client component) imported the
 * products API module that imported `admin.ts`.
 *
 * Pass A never hit this because only server components imported `admin.ts`. The
 * products screen is the first surface with a client island that talks to the
 * admin API, so the split had to happen here.
 *
 * The rule that follows: **a client component may import this file, never
 * `admin.ts`.** `admin.ts` re-exports everything below so a server component can
 * still import one module and get both halves.
 *
 * `AdminApiError` lives here rather than in `admin.ts` for the same reason — it
 * is thrown by both halves, and the server half imports it from here.
 */

import type { ApiResponse, ApiSuccess } from '@/types/api';
import { API_BASE_URL, API_PREFIX } from './config';

/** Mirrors `SessionClientError` so callers branch on `status` the same way. */
export class AdminApiError extends Error {
  readonly code: string;
  readonly status: number;
  /** Field-level detail from a 409/422, when the API sent any. */
  readonly details: unknown;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'AdminApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  /** No session at all — the layout redirects to login. */
  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  /** Signed in, but not staff — the layout renders the 403 page. */
  get isForbidden(): boolean {
    return this.status === 403;
  }
}

/** Reads the CSRF cookie in the browser. Mirrors `session-client.ts`. */
function readCsrfToken(): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('csrf_token='));
  return match ? decodeURIComponent(match.slice('csrf_token='.length)) : '';
}

export interface AdminRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * Browser-side admin call.
 *
 * Same contract as `sessionFetch`, kept separate so the admin surface has one
 * import and cannot accidentally pick up the storefront's caching behaviour.
 */
export async function adminFetch<T>(
  path: string,
  options: AdminRequestOptions = {},
): Promise<ApiSuccess<T>> {
  const { method = 'GET', body, signal } = options;
  const url = `${API_BASE_URL}${API_PREFIX}${path}`;

  const csrf = method !== 'GET' ? readCsrfToken() : '';

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
      cache: 'no-store',
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new AdminApiError(
      'INTERNAL_ERROR',
      `Cannot reach the API at ${API_BASE_URL}. Is the server running?`,
      0,
    );
  }

  let payload: ApiResponse<T>;
  try {
    payload = (await response.json()) as ApiResponse<T>;
  } catch {
    throw new AdminApiError(
      'INTERNAL_ERROR',
      'The API returned an unreadable response.',
      response.status,
    );
  }

  if (!payload.success) {
    throw new AdminApiError(
      payload.error.code,
      payload.error.message,
      response.status,
      payload.error.details,
    );
  }

  return payload;
}
