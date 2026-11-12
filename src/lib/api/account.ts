/**
 * Account API — auth, profile, addresses, cart, checkout, orders.
 *
 * Every call here is per-user, so it goes through `sessionFetch` (cookies +
 * CSRF), never `apiFetch`. Nothing in this file is cacheable.
 *
 * The functions are thin on purpose: they exist so a component never types a
 * URL or a response shape. All error handling is the caller's, via the single
 * `SessionClientError` the client throws.
 */

import { sessionApi } from './session-client';
import type {
  AddressDto,
  AddressInput,
  CheckoutInput,
  LoginInput,
  OrderDto,
  OrderStatus,
  PublicUser,
  RegisterInput,
  ServerCart,
  TrackedOrder,
} from '@/types/account';

// ─── Auth ────────────────────────────────────────────────────────────────

export async function register(input: RegisterInput): Promise<PublicUser> {
  const res = await sessionApi.post<{ user: PublicUser }>('/auth/register', input);
  return res.data.user;
}

export async function login(input: LoginInput): Promise<PublicUser> {
  const res = await sessionApi.post<{ user: PublicUser }>('/auth/login', input);
  return res.data.user;
}

export async function logout(): Promise<void> {
  await sessionApi.post<{ loggedOut: boolean }>('/auth/logout');
}

/**
 * Rotates the refresh token.
 *
 * Called by the session provider when a 401 arrives, then the original request
 * is retried once. Returns true when a new access token was issued.
 */
export async function refreshSession(): Promise<boolean> {
  try {
    await sessionApi.post<{ refreshed: boolean }>('/auth/refresh');
    return true;
  } catch {
    return false;
  }
}

export async function requestPasswordReset(identifier: string): Promise<string | null> {
  const res = await sessionApi.post<{ devResetToken?: string }>('/auth/forgot-password', {
    identifier,
  });
  // Only present outside production — the server withholds it in prod.
  return res.data.devResetToken ?? null;
}

export async function resetPassword(token: string, password: string): Promise<void> {
  await sessionApi.post('/auth/reset-password', { token, password });
}

// ─── Profile ─────────────────────────────────────────────────────────────

/** The current user, or null when not signed in. Never throws on 401. */
export async function getMe(): Promise<PublicUser | null> {
  try {
    const res = await sessionApi.get<{ user: PublicUser }>('/me');
    return res.data.user;
  } catch (error) {
    if (isUnauthenticated(error)) return null;
    throw error;
  }
}

export async function updateProfile(input: {
  name?: string;
  phone?: string;
}): Promise<PublicUser> {
  const res = await sessionApi.put<{ user: PublicUser }>('/me', input);
  return res.data.user;
}

// ─── Addresses ───────────────────────────────────────────────────────────

export async function listAddresses(): Promise<AddressDto[]> {
  const res = await sessionApi.get<AddressDto[]>('/me/addresses');
  return res.data;
}

export async function createAddress(input: AddressInput): Promise<AddressDto> {
  const res = await sessionApi.post<AddressDto>('/me/addresses', input);
  return res.data;
}

export async function updateAddress(id: string, input: AddressInput): Promise<AddressDto> {
  const res = await sessionApi.put<AddressDto>(`/me/addresses/${id}`, input);
  return res.data;
}

export async function deleteAddress(id: string): Promise<void> {
  await sessionApi.del(`/me/addresses/${id}`);
}

// ─── Cart ────────────────────────────────────────────────────────────────

export async function getCart(): Promise<ServerCart> {
  const res = await sessionApi.get<ServerCart>('/cart');
  return res.data;
}

/**
 * Pushes a guest's local cart to the server.
 *
 * The server merges by (product, variant) and takes the larger quantity rather
 * than summing, so a merge cannot double an item a shopper already had. The
 * local list is only cleared by the caller after this resolves.
 *
 * The response is NOT a bare cart: it is `{ cart, merged, skipped }`. Typing it
 * as `ServerCart` made `res.data.lines` undefined and hid the fact that a merge
 * can legitimately store nothing — `skipped` is the count the caller needs
 * before it decides to clear the local cart.
 */
export async function syncCart(
  items: Array<{ productId: string; variantId: string | null; quantity: number }>,
): Promise<{ cart: ServerCart; merged: number; skipped: number }> {
  const res = await sessionApi.post<{ cart: ServerCart; merged: number; skipped: number }>(
    '/cart/sync',
    { items },
  );
  return res.data;
}

export async function addCartItem(input: {
  productId: string;
  variantId: string | null;
  quantity: number;
}): Promise<ServerCart> {
  const res = await sessionApi.post<ServerCart>('/cart/items', input);
  return res.data;
}

export async function updateCartItem(lineId: string, quantity: number): Promise<ServerCart> {
  const res = await sessionApi.put<ServerCart>(`/cart/items/${lineId}`, { quantity });
  return res.data;
}

export async function removeCartItem(lineId: string): Promise<ServerCart> {
  const res = await sessionApi.del<ServerCart>(`/cart/items/${lineId}`);
  return res.data;
}

// ─── Checkout ────────────────────────────────────────────────────────────

/**
 * Places an order.
 *
 * `idempotencyKey` is required by the caller, not generated here: it must stay
 * stable across retries of the *same* submission, so it belongs to the form
 * state, not to this function. A key generated per call would make every retry
 * a new order — the exact bug the header exists to prevent.
 */
export async function placeOrder(
  input: CheckoutInput,
  idempotencyKey: string,
): Promise<OrderDto> {
  const res = await sessionApi.post<OrderDto>('/checkout', input, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  return res.data;
}

// ─── Orders ──────────────────────────────────────────────────────────────

export async function listOrders(params: {
  page?: number;
  limit?: number;
  status?: OrderStatus;
} = {}): Promise<{ orders: OrderDto[]; total: number; totalPages: number }> {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));
  if (params.status) query.set('status', params.status);

  const suffix = query.toString() ? `?${query.toString()}` : '';
  const res = await sessionApi.get<OrderDto[]>(`/me/orders${suffix}`);

  return {
    orders: res.data,
    total: res.meta?.total ?? res.data.length,
    totalPages: res.meta?.totalPages ?? 1,
  };
}

export async function getOrder(id: string): Promise<OrderDto> {
  const res = await sessionApi.get<OrderDto>(`/me/orders/${id}`);
  return res.data;
}

export async function cancelOrder(id: string, reason?: string): Promise<OrderDto> {
  const res = await sessionApi.post<OrderDto>(`/me/orders/${id}/cancel`, { reason });
  return res.data;
}

export async function requestReturn(
  id: string,
  reason: string,
  itemIds?: string[],
): Promise<OrderDto> {
  const res = await sessionApi.post<OrderDto>(`/me/orders/${id}/return`, {
    reason,
    ...(itemIds ? { itemIds } : {}),
  });
  return res.data;
}

/** Public tracking. Requires BOTH the order number and the phone. */
export async function trackOrder(orderNumber: string, phone: string): Promise<TrackedOrder> {
  const query = new URLSearchParams({ phone });
  const res = await sessionApi.get<TrackedOrder>(
    `/track/${encodeURIComponent(orderNumber)}?${query.toString()}`,
  );
  return res.data;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/** True for the one error a caller routinely treats as "not signed in". */
export function isUnauthenticated(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as { status: unknown }).status === 401
  );
}
