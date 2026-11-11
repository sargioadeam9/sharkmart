/**
 * The API envelope. Frozen in Phase 0 — every endpoint, every mock, every
 * fetch in every later phase uses exactly this shape.
 *
 * Source: prompts/masterbuild.md § "The contract that makes phases independent"
 *
 *   success : { success: true,  data: {...}, meta?: { page, limit, total } }
 *   error   : { success: false, error: { code, message, details? } }
 *
 * Rules:
 *   - Money is integer poisha over the wire (`pricePoisha: 189000`). Never floats.
 *   - Bilingual fields are pairs: `nameEn` / `nameBn`. No single-language
 *     user-facing field, ever.
 *   - Backend may add fields, never rename or remove one an earlier phase reads.
 */

export interface ApiMeta {
  page: number;
  limit: number;
  total: number;
  /** Total pages, when the server can compute it cheaply. */
  totalPages?: number;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: ApiMeta;
}

export interface ApiErrorDetail {
  /** Dotted path to the offending field, e.g. "items.0.quantity". */
  field?: string;
  message: string;
}

export interface ApiErrorBody {
  /** Stable machine code — see API_ERROR_CODES. */
  code: ApiErrorCode;
  message: string;
  details?: ApiErrorDetail[];
}

export interface ApiFailure {
  success: false;
  error: ApiErrorBody;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/**
 * Error codes are part of the contract. Clients branch on these strings, so
 * they are never renamed. Adding a code is fine; removing one is a break.
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

/** Type guard — useful at every fetch boundary. */
export function isApiSuccess<T>(res: ApiResponse<T>): res is ApiSuccess<T> {
  return res.success === true;
}
