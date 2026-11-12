/**
 * Base fetch wrapper.
 *
 * Every API call goes through here so error handling, the envelope unwrap and
 * the mock switch live in exactly one place. Components never call `fetch`.
 */

import type { ApiResponse, ApiFailure, ApiSuccess } from '@/types/api';
import { API_BASE_URL, API_PREFIX, USE_MOCK } from './config';

/**
 * The internal service token, read only where it is safe to read it.
 *
 * `INTERNAL_API_TOKEN` is deliberately NOT a `NEXT_PUBLIC_` variable: Next
 * inlines every `NEXT_PUBLIC_` value into the client bundle, which would hand
 * the bypass to anyone who opens devtools. This is only ever evaluated on the
 * server, and the guard below means a browser bundle gets `undefined` even if
 * the build inlined the name.
 */
function internalToken(): string | undefined {
  if (typeof window !== 'undefined') return undefined;
  const token = process.env.INTERNAL_API_TOKEN;
  return token && token.length > 0 ? token : undefined;
}

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(failure: ApiFailure['error'], status: number) {
    super(failure.message);
    this.name = 'ApiClientError';
    this.code = failure.code;
    this.status = status;
    this.details = failure.details;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Next.js cache directive. Defaults to revalidating every 60s. */
  revalidate?: number | false;
  signal?: AbortSignal;
}

/**
 * Calls the real API and unwraps the envelope.
 *
 * Throws ApiClientError on a contract-shaped failure or a transport error, so
 * callers have one thing to catch.
 */
export async function apiFetch<T>(
  path: string,
  options: RequestOptions = {},
): Promise<ApiSuccess<T>> {
  const { method = 'GET', body, revalidate = 60, signal } = options;
  const url = `${API_BASE_URL}${API_PREFIX}${path}`;

  /**
   * Server-side calls carry the internal token so `next build` prerendering is
   * not throttled by the public rate limit. A browser call never does: the
   * token is absent from the client bundle by construction.
   */
  const token = internalToken();

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { 'X-Internal-Token': token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal,
      next: revalidate === false ? { revalidate: 0 } : { revalidate },
    });
  } catch {
    throw new ApiClientError(
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
    throw new ApiClientError(
      { code: 'INTERNAL_ERROR', message: `API returned non-JSON (HTTP ${response.status})` },
      response.status,
    );
  }

  if (!payload.success) {
    throw new ApiClientError(payload.error, response.status);
  }

  return payload;
}

/**
 * Resolve a call against either the mock layer or the real API.
 *
 * This is the only function that branches on USE_MOCK. Each domain module
 * (products.ts, categories.ts, ...) passes its mock implementation in.
 */
export async function resolve<T>(
  path: string,
  mock: () => ApiSuccess<T>,
  options?: RequestOptions,
): Promise<ApiSuccess<T>> {
  if (USE_MOCK) return mock();
  return apiFetch<T>(path, options);
}
