/**
 * Inventory API client — the browser half.
 *
 * Shapes mirror `server/src/routes/admin/inventory.service.ts` exactly. The
 * screen never derives a stock number: `stockOfRecord`, `stockStatus` and the
 * KPI counts all arrive from the server, because the rule that decides them
 * spans two tables and must not exist twice.
 */

import { adminFetch } from './admin-client';

export type InventoryStockStatus = 'in_stock' | 'low_stock' | 'out_of_stock';
export type InventoryStockFilter = 'all' | 'in' | 'low' | 'out';
export type InventorySort = 'stock_asc' | 'stock_desc' | 'name_asc' | 'name_desc' | 'updated';
export type MovementType = 'IN' | 'OUT' | 'ADJUSTMENT' | 'TRANSFER' | 'RETURN';

export interface InventoryListItem {
  productId: string;
  slug: string;
  nameEn: string;
  nameBn: string;
  sku: string;
  categoryNameEn: string;
  categoryNameBn: string;
  imageUrl: string | null;
  variantCount: number;
  warehouseQty: number;
  variantStock: number;
  stockOfRecord: number;
  stockSource: 'variant' | 'warehouse';
  stockStatus: InventoryStockStatus;
  updatedAt: string;
}

export interface InventoryListResponse {
  items: InventoryListItem[];
  total: number;
  page: number;
  limit: number;
}

export interface InventoryAlerts {
  out: number;
  low: number;
  in: number;
  total: number;
  units: number;
  skus: number;
}

export interface MovementRow {
  id: string;
  productId: string;
  productNameEn: string | null;
  productSku: string | null;
  variantId: string | null;
  warehouseId: string | null;
  type: MovementType;
  quantity: number;
  reason: string | null;
  referenceType: string | null;
  referenceId: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface MovementListResponse {
  items: MovementRow[];
  total: number;
  page: number;
  limit: number;
}

export interface InventoryDetail {
  product: {
    productId: string;
    slug: string;
    nameEn: string;
    nameBn: string;
    sku: string;
    categoryNameEn: string;
    categoryNameBn: string;
  };
  stockOfRecord: number;
  stockSource: 'variant' | 'warehouse';
  stockStatus: InventoryStockStatus;
  warehouses: Array<{
    warehouseId: string;
    warehouseName: string;
    isDefault: boolean;
    quantity: number;
  }>;
  variants: Array<{
    id: string;
    sku: string;
    nameEn: string;
    nameBn: string;
    stock: number;
    reservedStock: number;
    isActive: boolean;
    stockStatus: InventoryStockStatus;
  }>;
  movements: MovementRow[];
}

export interface AdjustResult {
  productId: string;
  variantId: string | null;
  warehouseId: string | null;
  stockSource: 'variant' | 'warehouse';
  previousQuantity: number;
  newQuantity: number;
  delta: number;
  stockOfRecord: number;
  stockStatus: InventoryStockStatus;
  changed: boolean;
  movementId: string | null;
}

export interface InventoryListParams {
  q?: string;
  categoryId?: string;
  stock?: InventoryStockFilter;
  sort?: InventorySort;
  page?: number;
  limit?: number;
}

function toQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query.length > 0 ? `?${query}` : '';
}

export async function listInventory(params: InventoryListParams): Promise<InventoryListResponse> {
  const response = await adminFetch<InventoryListResponse>(
    `/admin/inventory${toQuery(params as Record<string, string | number | undefined>)}`,
  );
  return response.data;
}

export async function getInventoryAlerts(): Promise<InventoryAlerts> {
  const response = await adminFetch<InventoryAlerts>('/admin/inventory/alerts');
  return response.data;
}

export async function getInventoryDetail(productId: string): Promise<InventoryDetail> {
  const response = await adminFetch<InventoryDetail>(`/admin/inventory/${productId}`);
  return response.data;
}

export async function listMovements(params: {
  productId?: string;
  type?: MovementType | 'all';
  page?: number;
  limit?: number;
}): Promise<MovementListResponse> {
  const response = await adminFetch<MovementListResponse>(
    `/admin/inventory/movements${toQuery(params as Record<string, string | number | undefined>)}`,
  );
  return response.data;
}

/**
 * Adjusts the stock of record.
 *
 * `reason` is required by the API and by this signature — an adjustment with no
 * reason is untraceable, so the type system refuses to send one.
 */
export async function adjustStock(
  productId: string,
  input: {
    quantity: number;
    mode: 'delta' | 'set';
    reason: string;
    variantId?: string;
    warehouseId?: string;
  },
): Promise<AdjustResult> {
  const response = await adminFetch<AdjustResult>(`/admin/inventory/${productId}/adjust`, {
    method: 'POST',
    body: input,
  });
  return response.data;
}
