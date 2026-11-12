/**
 * Admin API client — the server half, plus re-exports of the browser half.
 *
 * `adminFetchServer` runs in a server component (the layout, the products list,
 * the editor pages) and forwards the incoming cookies by hand. The browser half
 * lives in `admin-client.ts` because this file imports `next/headers`, which
 * cannot be bundled into a Client Component.
 *
 * Why the server half cannot reuse `sessionFetch`: that function is written for
 * the browser and reads `document.cookie`, which does not exist on the server.
 * Why it cannot reuse `client.ts`: that one deliberately sends no cookies and
 * carries the internal token — correct for public catalog reads, useless for a
 * per-user admin call, and it would leak the internal token into an admin
 * request that does not need it.
 *
 * **Import rule:** a client component imports `admin-client.ts`, never this
 * file. A server component may import either.
 */

import { cookies } from 'next/headers';
import type { ApiResponse, ApiSuccess } from '@/types/api';
import { API_BASE_URL, API_PREFIX } from './config';
import { AdminApiError } from './admin-client';

// The browser half, re-exported so a server component has one import.
export { AdminApiError, adminFetch } from './admin-client';
export type { AdminRequestOptions } from './admin-client';

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
