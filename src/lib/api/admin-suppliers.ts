/**
 * Admin suppliers API client.
 *
 * Mirrors `server/src/routes/admin/supplier.service.ts`. Money is integer poisha.
 */

import { adminFetch } from './admin-client';

export type PoStatus = 'DRAFT' | 'ORDERED' | 'PARTIAL' | 'RECEIVED' | 'CANCELLED';
export type SupplierSort = 'newest' | 'name' | 'orders';

export interface SupplierItem {
  id: string;
  name: string;
  contactPerson: string | null;
  phone: string;
  email: string | null;
  address: string | null;
  isActive: boolean;
  productCount: number;
  orderCount: number;
  createdAt: string;
}

export interface SupplierProduct {
  productId: string;
  nameEn: string;
  sku: string;
  costPricePoisha: number;
  leadDays: number | null;
}

export interface SupplierOrderRef {
  id: string;
  status: PoStatus;
  totalAmountPoisha: number;
  createdAt: string;
}

export interface SupplierDetail extends SupplierItem {
  products: SupplierProduct[];
  orders: SupplierOrderRef[];
}

export interface SupplierListResponse {
  items: SupplierItem[];
  total: number;
  page: number;
  limit: number;
}

export interface PurchaseOrderItem {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  receivedQuantity: number;
  costPricePoisha: number;
}

export interface PurchaseOrder {
  id: string;
  supplierId: string;
  supplierName: string;
  status: PoStatus;
  totalAmountPoisha: number;
  notes: string | null;
  itemCount: number;
  receivedItemCount: number;
  createdAt: string;
  receivedAt: string | null;
  items: PurchaseOrderItem[];
}

export async function listSuppliers(query: string): Promise<SupplierListResponse> {
  const res = await adminFetch<SupplierListResponse>(`/admin/suppliers?${query}`);
  return res.data;
}

export async function getSupplier(id: string): Promise<SupplierDetail> {
  const res = await adminFetch<SupplierDetail>(`/admin/suppliers/${id}`);
  return res.data;
}

export async function createSupplier(body: {
  name: string;
  contactPerson?: string | null;
  phone: string;
  email?: string | null;
  address?: string | null;
}): Promise<SupplierItem> {
  const res = await adminFetch<SupplierItem>('/admin/suppliers', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.data;
}

export async function updateSupplier(id: string, body: Record<string, unknown>): Promise<SupplierItem> {
  const res = await adminFetch<SupplierItem>(`/admin/suppliers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  return res.data;
}

export async function setSupplierActive(id: string, isActive: boolean): Promise<SupplierItem> {
  const res = await adminFetch<SupplierItem>(`/admin/suppliers/${id}/active`, {
    method: 'POST',
    body: JSON.stringify({ isActive }),
  });
  return res.data;
}

export async function addSupplierProduct(
  id: string,
  body: { productId: string; costPricePoisha: number; leadDays?: number | null },
): Promise<SupplierDetail> {
  const res = await adminFetch<SupplierDetail>(`/admin/suppliers/${id}/products`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.data;
}

export async function removeSupplierProduct(id: string, productId: string): Promise<void> {
  await adminFetch<{ removed: boolean }>(`/admin/suppliers/${id}/products/${productId}`, {
    method: 'DELETE',
  });
}

// ─── Purchase orders ───────────────────────────────────────────────────────

export async function getPurchaseOrder(id: string): Promise<PurchaseOrder> {
  const res = await adminFetch<PurchaseOrder>(`/admin/purchase-orders/${id}`);
  return res.data;
}

export async function createPurchaseOrder(body: {
  supplierId: string;
  notes?: string | null;
  items: Array<{ productId: string; quantity: number; costPricePoisha: number }>;
}): Promise<PurchaseOrder> {
  const res = await adminFetch<PurchaseOrder>('/admin/purchase-orders', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.data;
}

export async function markOrderOrdered(id: string): Promise<PurchaseOrder> {
  const res = await adminFetch<PurchaseOrder>(`/admin/purchase-orders/${id}/order`, {
    method: 'POST',
  });
  return res.data;
}

export async function receivePurchaseOrder(
  id: string,
  lines: Array<{ itemId: string; receivedQuantity: number }>,
  note?: string,
): Promise<PurchaseOrder> {
  const res = await adminFetch<PurchaseOrder>(`/admin/purchase-orders/${id}/receive`, {
    method: 'POST',
    body: JSON.stringify({ lines, note }),
  });
  return res.data;
}

export async function cancelPurchaseOrder(id: string, reason: string): Promise<PurchaseOrder> {
  const res = await adminFetch<PurchaseOrder>(`/admin/purchase-orders/${id}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
  return res.data;
}
