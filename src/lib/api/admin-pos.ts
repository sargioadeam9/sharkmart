/**
 * Browser client for `/api/v1/admin/pos`.
 *
 * Types mirror the server DTOs in `pos.service.ts`. They are duplicated rather
 * than shared because the server is a separate package with its own tsconfig;
 * the shapes are asserted by the API tests, which is the contract that matters.
 */

import { adminFetch } from './admin-client';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface PosSession {
  id: string;
  status: 'OPEN' | 'CLOSED';
  openedBy: string;
  openedByName: string;
  openedAt: string;
  closedBy: string | null;
  closedByName: string | null;
  closedAt: string | null;
  openingCashPoisha: number;
  countedCashPoisha: number | null;
  expectedCashPoisha: number;
  variancePoisha: number | null;
  saleCount: number;
  cashSalesPoisha: number;
  cardSalesPoisha: number;
  otherSalesPoisha: number;
  totalSalesPoisha: number;
  note: string | null;
  snapshot: boolean;
}

export interface PosVariant {
  id: string;
  sku: string;
  nameEn: string;
  nameBn: string;
  pricePoisha: number;
  stock: number;
  stockStatus: 'in_stock' | 'low_stock' | 'out_of_stock';
  isActive: boolean;
}

export interface PosCatalogItem {
  productId: string;
  nameEn: string;
  nameBn: string;
  sku: string;
  pricePoisha: number;
  imageUrl: string | null;
  hasVariants: boolean;
  stock: number | null;
  stockStatus: 'in_stock' | 'low_stock' | 'out_of_stock';
  variants: PosVariant[];
}

export interface PosSale {
  orderId: string;
  orderNumber: string;
  createdAt: string;
  sessionId: string | null;
  cashierName: string;
  items: Array<{
    nameEn: string;
    nameBn: string;
    sku: string;
    quantity: number;
    unitPricePoisha: number;
    lineTotalPoisha: number;
  }>;
  subtotalPoisha: number;
  discountPoisha: number;
  totalPoisha: number;
  paymentMethod: string;
  cashReceivedPoisha: number;
  changePoisha: number;
  customerName: string | null;
  customerPhone: string | null;
  shop: { name: string; phone: string; address: string };
  replayed?: boolean;
}

export interface PosSaleSummary {
  orderId: string;
  orderNumber: string;
  createdAt: string;
  totalPoisha: number;
  paymentMethod: string;
  itemCount: number;
  customerName: string | null;
}

// ─── Calls ─────────────────────────────────────────────────────────────────

export async function getCurrentSession(): Promise<PosSession | null> {
  const response = await adminFetch<{ session: PosSession | null }>('/admin/pos/session/current');
  return response.data.session;
}

export async function listSessions(limit = 10): Promise<PosSession[]> {
  const response = await adminFetch<{ items: PosSession[] }>(`/admin/pos/session?limit=${limit}`);
  return response.data.items;
}

export async function openShift(input: {
  openingCashPoisha: number;
  note?: string;
}): Promise<PosSession> {
  const response = await adminFetch<{ session: PosSession }>('/admin/pos/session/open', {
    method: 'POST',
    body: input,
  });
  return response.data.session;
}

export async function closeShift(
  id: string,
  input: { countedCashPoisha: number; note?: string },
): Promise<PosSession> {
  const response = await adminFetch<{ session: PosSession }>(`/admin/pos/session/${id}/close`, {
    method: 'POST',
    body: input,
  });
  return response.data.session;
}

export async function searchCatalog(q: string, signal?: AbortSignal): Promise<PosCatalogItem[]> {
  const query = new URLSearchParams({ limit: '24' });
  if (q.trim()) query.set('q', q.trim());

  const response = await adminFetch<{ items: PosCatalogItem[] }>(
    `/admin/pos/catalog?${query.toString()}`,
    { signal },
  );
  return response.data.items;
}

export async function createSale(input: {
  clientRef: string;
  items: Array<{ productId: string; variantId: string | null; quantity: number }>;
  paymentMethod: 'CASH' | 'CARD' | 'BKASH' | 'NAGAD';
  cashReceivedPoisha?: number;
  discountPoisha: number;
  customerName?: string;
  customerPhone?: string;
  note?: string;
}): Promise<PosSale> {
  const response = await adminFetch<PosSale>('/admin/pos/sales', {
    method: 'POST',
    body: input,
  });
  return response.data;
}

export async function listSales(sessionId: string): Promise<PosSaleSummary[]> {
  const response = await adminFetch<{ items: PosSaleSummary[] }>(
    `/admin/pos/sales?sessionId=${sessionId}&limit=100`,
  );
  return response.data.items;
}
