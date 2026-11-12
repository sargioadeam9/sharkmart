/**
 * Admin orders API client — the browser half.
 *
 * Mirrors the server DTOs in `server/src/services/admin/order.admin.service.ts`.
 * Types are duplicated rather than imported because the two packages do not share
 * a tsconfig path, and importing from `../../server/...` would drag the server's
 * Prisma types into the browser bundle. The duplication is the contract; if the
 * server DTO changes, this file changes with it.
 *
 * Every call goes through `adminFetch`, which is the admin surface's single fetch
 * wrapper (credentials + CSRF). No component calls `fetch` directly.
 */

import { adminFetch } from './admin-client';

export type AdminOrderStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'PROCESSING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'RETURNED'
  | 'REFUND_PENDING'
  | 'REFUNDED';

export type AdminPaymentStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'REFUNDED';

export interface AdminOrderListItem {
  id: string;
  orderNumber: string;
  status: AdminOrderStatus;
  paymentStatus: AdminPaymentStatus;
  paymentMethod: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  isGuest: boolean;
  recipientName: string;
  district: string;
  division: string;
  itemCount: number;
  lineCount: number;
  subtotalPoisha: number;
  discountAmountPoisha: number;
  deliveryChargePoisha: number;
  totalAmountPoisha: number;
  paidAmountPoisha: number;
  courierName: string | null;
  consignmentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminOrderLine {
  id: string;
  productId: string;
  variantId: string | null;
  nameEn: string;
  nameBn: string;
  sku: string;
  quantity: number;
  unitPricePoisha: number;
  discountPercent: number;
  lineTotalPoisha: number;
  returnStatus: string | null;
  imageUrl: string | null;
}

export interface AdminOrderHistoryEntry {
  id: string;
  status: AdminOrderStatus;
  note: string | null;
  changedBy: string | null;
  changedByName: string | null;
  createdAt: string;
}

export interface AdminOrderDetail extends AdminOrderListItem {
  notes: string | null;
  couponCode: string | null;
  paymentGateway: string | null;
  paymentTxnId: string | null;
  trackingUrl: string | null;
  items: AdminOrderLine[];
  shippingAddress: {
    recipientName: string;
    phone: string;
    division: string;
    district: string;
    area: string;
    address: string;
    postalCode: string | null;
  } | null;
  statusHistory: AdminOrderHistoryEntry[];
  allowedTransitions: AdminOrderStatus[];
}

export interface AdminOrderListResponse {
  items: AdminOrderListItem[];
  total: number;
  page: number;
  limit: number;
}

export interface AdminOrderCounts {
  all: number;
  byStatus: Record<string, number>;
}

export interface OrderListParams {
  q?: string;
  status?: AdminOrderStatus | 'all';
  paymentStatus?: AdminPaymentStatus | 'all';
  customerType?: 'all' | 'guest' | 'registered';
  from?: string;
  to?: string;
  sort?: 'newest' | 'oldest' | 'total_desc' | 'total_asc';
  page?: number;
  limit?: number;
}

/** Builds the query string, dropping empty values so the URL stays readable. */
function toQuery(params: OrderListParams): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }

  const query = search.toString();
  return query.length > 0 ? `?${query}` : '';
}

export async function listOrders(params: OrderListParams): Promise<AdminOrderListResponse> {
  const response = await adminFetch<AdminOrderListResponse>(`/admin/orders${toQuery(params)}`);
  return response.data;
}

export async function getOrderCounts(): Promise<AdminOrderCounts> {
  const response = await adminFetch<AdminOrderCounts>('/admin/orders/counts');
  return response.data;
}

export async function getOrder(id: string): Promise<AdminOrderDetail> {
  const response = await adminFetch<AdminOrderDetail>(`/admin/orders/${id}`);
  return response.data;
}

export async function lookupOrder(orderNumber: string): Promise<AdminOrderDetail> {
  const response = await adminFetch<AdminOrderDetail>(
    `/admin/orders/lookup?orderNumber=${encodeURIComponent(orderNumber)}`,
  );
  return response.data;
}

export async function changeOrderStatus(
  id: string,
  status: AdminOrderStatus,
  note: string,
): Promise<AdminOrderDetail> {
  const response = await adminFetch<AdminOrderDetail>(`/admin/orders/${id}/status`, {
    method: 'POST',
    body: { status, note },
  });
  return response.data;
}

export interface BulkStatusResult {
  updated: string[];
  skipped: Array<{ id: string; reason: string }>;
}

export async function bulkChangeOrderStatus(
  ids: string[],
  status: AdminOrderStatus,
  note: string,
): Promise<BulkStatusResult> {
  const response = await adminFetch<BulkStatusResult>('/admin/orders/bulk/status', {
    method: 'POST',
    body: { ids, status, note },
  });
  return response.data;
}

export async function recordOrderPayment(
  id: string,
  payload: { amountPoisha: number; method?: string; txnId?: string; note?: string },
): Promise<AdminOrderDetail> {
  const response = await adminFetch<AdminOrderDetail>(`/admin/orders/${id}/payment`, {
    method: 'POST',
    body: payload,
  });
  return response.data;
}

export async function setOrderCourier(
  id: string,
  payload: { courierName: string; consignmentId: string; trackingUrl?: string },
): Promise<AdminOrderDetail> {
  const response = await adminFetch<AdminOrderDetail>(`/admin/orders/${id}/courier`, {
    method: 'POST',
    body: payload,
  });
  return response.data;
}

export async function setOrderNotes(id: string, notes: string | null): Promise<AdminOrderDetail> {
  const response = await adminFetch<AdminOrderDetail>(`/admin/orders/${id}/notes`, {
    method: 'PATCH',
    body: { notes },
  });
  return response.data;
}
