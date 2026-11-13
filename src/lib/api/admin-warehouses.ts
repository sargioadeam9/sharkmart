/**
 * Admin warehouses API client. Mirrors `server/src/routes/admin/warehouse.service.ts`.
 */

import { adminFetch } from './admin-client';

export interface WarehouseItem {
  id: string;
  name: string;
  address: string | null;
  isDefault: boolean;
  isActive: boolean;
  productCount: number;
  totalUnits: number;
}

export interface WarehouseStockRow {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  variantId: string | null;
  variantName: string | null;
  quantity: number;
  binLocation: string | null;
}

export interface StockResponse {
  items: WarehouseStockRow[];
  total: number;
  page: number;
  limit: number;
}

export interface TransferItem {
  id: string;
  fromName: string;
  toName: string;
  productName: string;
  variantName: string | null;
  quantity: number;
  status: string;
  createdAt: string;
}

export async function listWarehouses(): Promise<WarehouseItem[]> {
  const res = await adminFetch<{ warehouses: WarehouseItem[] }>('/admin/warehouses');
  return res.data.warehouses;
}

export async function createWarehouse(body: {
  name: string;
  address?: string | null;
  isDefault?: boolean;
}): Promise<WarehouseItem> {
  const res = await adminFetch<WarehouseItem>('/admin/warehouses', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.data;
}

export async function updateWarehouse(
  id: string,
  body: { name?: string; address?: string | null; isActive?: boolean },
): Promise<WarehouseItem> {
  const res = await adminFetch<WarehouseItem>(`/admin/warehouses/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  return res.data;
}

export async function setDefaultWarehouse(id: string): Promise<WarehouseItem[]> {
  const res = await adminFetch<{ warehouses: WarehouseItem[] }>(`/admin/warehouses/${id}/default`, {
    method: 'POST',
  });
  return res.data.warehouses;
}

export async function getWarehouseStock(id: string, page = 1, limit = 20): Promise<StockResponse> {
  const res = await adminFetch<StockResponse>(
    `/admin/warehouses/${id}/stock?page=${page}&limit=${limit}`,
  );
  return res.data;
}

export async function listTransfers(page = 1, limit = 20): Promise<{ items: TransferItem[]; total: number }> {
  const res = await adminFetch<{ items: TransferItem[]; total: number }>(
    `/admin/warehouses/transfers?page=${page}&limit=${limit}`,
  );
  return res.data;
}

export async function createTransfer(body: {
  fromWarehouseId: string;
  toWarehouseId: string;
  productId: string;
  variantId?: string | null;
  quantity: number;
}): Promise<TransferItem> {
  const res = await adminFetch<TransferItem>('/admin/warehouses/transfers', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.data;
}
