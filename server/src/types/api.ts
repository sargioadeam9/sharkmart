/**
 * The API envelope — the server half of the frozen contract.
 *
 * Every route returns one of these. No route ever returns a bare object, an
 * array, or a differently-shaped error. See prompts/masterbuild.md.
 */

export const API_ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'OUT_OF_STOCK',
  'PRICE_CHANGED',
  'PAYMENT_FAILED',
  'INTERNAL_ERROR',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiMeta {
  page: number;
  limit: number;
  total: number;
  totalPages?: number;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: ApiMeta;
}

export interface ApiFailure {
  success: false;
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export function ok<T>(data: T, meta?: ApiMeta): ApiSuccess<T> {
  return meta ? { success: true, data, meta } : { success: true, data };
}

export function fail(
  code: ApiErrorCode,
  message: string,
  details?: unknown,
): ApiFailure {
  return { success: false, error: details ? { code, message, details } : { code, message } };
}

/** Build the standard pagination meta. */
export function paginationMeta(page: number, limit: number, total: number): ApiMeta {
  return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}
