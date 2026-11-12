/**
 * Admin API client — the two halves the panel needs.
 *
 * `adminFetchServer` runs in a server component (the layout) and forwards the
 * incoming cookies by hand. `adminFetch` runs in the browser and relies on
 * `credentials: 'include'` plus the CSRF double-submit.
 *
 * Why the server half cannot reuse `sessionFetch`: that function is written for
 * the browser and reads `document.cookie`, which does not exist on the server.
 * Why it cannot reuse `client.ts`: that one deliberately sends no cookies and
 * carries the internal token — correct for public catalog reads, useless for a
 * per-user admin call, and it would leak the internal token into an admin
 * request that does not need it.
 *
 * So this file is the third case, and it is small on purpose.
 */

import { cookies } from 'next/headers';
import type { ApiResponse, ApiSuccess } from '@/types/api';
import { API_BASE_URL, API_PREFIX } from './config';

/** Mirrors `SessionClientError` so callers branch on `status` the same way. */
export class AdminApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'AdminApiError';
    this.code = code;
    this.status = status;
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

/**
 * Server-side admin call, forwarding the caller's cookies.
 *
 * `cache: 'no-store'` is mandatory: every admin response is per-user and
 * role-dependent. A cached `/admin/me` would show one operator another's
 * permissions.
 */
export async function adminFetchServer<T>(path: string): Promise<ApiSuccess<T>> {
  const store = await cookies();
  const cookieHeader = store
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');

  const url = `${API_BASE_URL}${API_PREFIX}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      cache: 'no-store',
    });
  } catch {
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
    throw new AdminApiError('INTERNAL_ERROR', 'The API returned an unreadable response.', response.status);
  }

  if (!payload.success) {
    throw new AdminApiError(payload.error.code, payload.error.message, response.status);
  }

  return payload;
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

interface AdminRequestOptions {
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
    throw new AdminApiError('INTERNAL_ERROR', 'The API returned an unreadable response.', response.status);
  }

  if (!payload.success) {
    throw new AdminApiError(payload.error.code, payload.error.message, response.status);
  }

  return payload;
}
