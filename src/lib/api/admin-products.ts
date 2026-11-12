/**
 * Admin products API client — the browser half.
 *
 * Mirrors the server DTOs in `server/src/services/admin/product.admin.service.ts`.
 * Types are duplicated rather than imported because the two packages do not
 * share a tsconfig path, and a `import type from '../../server/...'` would drag
 * the server's Prisma types into the browser bundle. The duplication is the
 * contract; if the server DTO changes, this file changes with it.
 *
 * Every call goes through `adminFetch`, which is the admin surface's single
 * fetch wrapper (credentials + CSRF). No component calls `fetch` directly.
 */

import { adminFetch } from './admin-client';

export type AdminStockStatus = 'in_stock' | 'low_stock' | 'out_of_stock';
export type AdminProductStatus = 'published' | 'draft' | 'archived';

export interface AdminProductListItem {
  id: string;
  slug: string;
  sku: string;
  barcode: string | null;
  nameEn: string;
  nameBn: string;
  categoryId: string;
  categoryNameEn: string;
  categoryNameBn: string;
  brandId: string | null;
  brandNameEn: string | null;
  brandNameBn: string | null;
  basePricePoisha: number;
  discountPercent: number;
  discountPricePoisha: number | null;
  originalPricePoisha: number;
  payablePoisha: number;
  stock: number;
  stockStatus: AdminStockStatus;
  isPublished: boolean;
  isDraft: boolean;
  isFeatured: boolean;
  isFlashSale: boolean;
  archivedAt: string | null;
  status: AdminProductStatus;
  imageUrl: string | null;
  imageCount: number;
  variantCount: number;
  updatedAt: string;
  createdAt: string;
}

export interface AdminProductImage {
  id: string;
  url: string;
  altEn: string | null;
  altBn: string | null;
  sortOrder: number;
  isMain: boolean;
}

export interface AdminProductVariant {
  id: string;
  sku: string;
  barcode: string | null;
  nameEn: string;
  nameBn: string;
  pricePoisha: number;
  stock: number;
  reservedStock: number;
  sortOrder: number;
  isActive: boolean;
  options: Array<{
    id: string;
    attributeId: string;
    attributeNameEn: string;
    attributeNameBn: string;
    valueEn: string;
    valueBn: string;
  }>;
}

export interface AdminProductDetail extends AdminProductListItem {
  descriptionEn: string | null;
  descriptionBn: string | null;
  flashSalePricePoisha: number | null;
  flashSaleStart: string | null;
  flashSaleEnd: string | null;
  flashSaleStock: number | null;
  flashSaleSold: number;
  metaTitleEn: string | null;
  metaTitleBn: string | null;
  metaDescEn: string | null;
  metaDescBn: string | null;
  ratingAvg: number;
  reviewCount: number;
  images: AdminProductImage[];
  variants: AdminProductVariant[];
  specifications: Array<{
    id: string;
    labelEn: string;
    labelBn: string;
    valueEn: string;
    valueBn: string;
    sortOrder: number;
  }>;
  details: Array<{
    id: string;
    section: string;
    contentEn: string | null;
    contentBn: string | null;
    sortOrder: number;
  }>;
}

export interface AdminProductListResponse {
  items: AdminProductListItem[];
  total: number;
  page: number;
  limit: number;
}

export interface ProductFormOptions {
  categories: Array<{
    id: string;
    slug: string;
    nameEn: string;
    nameBn: string;
    parentId: string | null;
    isActive: boolean;
  }>;
  brands: Array<{ id: string; slug: string; nameEn: string; nameBn: string; isActive: boolean }>;
}

export interface ProductListParams {
  q?: string;
  categoryId?: string;
  brandId?: string;
  status?: 'all' | 'published' | 'draft' | 'archived';
  stock?: 'all' | 'in' | 'low' | 'out';
  sort?: 'newest' | 'oldest' | 'name_asc' | 'name_desc' | 'price_asc' | 'price_desc' | 'updated';
  page?: number;
  limit?: number;
}

/** Builds the query string, dropping empty values so the URL stays readable. */
function toQuery(params: ProductListParams): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }

  const query = search.toString();
  return query.length > 0 ? `?${query}` : '';
}

export async function listProducts(params: ProductListParams): Promise<AdminProductListResponse> {
  const response = await adminFetch<AdminProductListResponse>(
    `/admin/products${toQuery(params)}`,
  );
  return response.data;
}

export async function getProduct(id: string): Promise<AdminProductDetail> {
  const response = await adminFetch<AdminProductDetail>(`/admin/products/${id}`);
  return response.data;
}

export async function getFormOptions(): Promise<ProductFormOptions> {
  const response = await adminFetch<ProductFormOptions>('/admin/products/form-options');
  return response.data;
}

/** The create/update payload. Money is integer poisha throughout. */
export interface ProductWritePayload {
  nameEn?: string;
  nameBn?: string;
  slug?: string;
  sku?: string;
  barcode?: string | null;
  categoryId?: string;
  brandId?: string | null;
  descriptionEn?: string | null;
  descriptionBn?: string | null;
  basePricePoisha?: number;
  discountPercent?: number;
  discountPricePoisha?: number | null;
  originalPricePoisha?: number;
  flashSalePricePoisha?: number | null;
  isFeatured?: boolean;
  isFlashSale?: boolean;
  flashSaleStart?: string | null;
  flashSaleEnd?: string | null;
  flashSaleStock?: number | null;
  metaTitleEn?: string | null;
  metaTitleBn?: string | null;
  metaDescEn?: string | null;
  metaDescBn?: string | null;
}

export async function createProduct(payload: ProductWritePayload): Promise<AdminProductDetail> {
  const response = await adminFetch<AdminProductDetail>('/admin/products', {
    method: 'POST',
    body: payload,
  });
  return response.data;
}

export async function updateProduct(
  id: string,
  payload: ProductWritePayload,
): Promise<AdminProductDetail> {
  const response = await adminFetch<AdminProductDetail>(`/admin/products/${id}`, {
    method: 'PATCH',
    body: payload,
  });
  return response.data;
}

export async function setPublished(id: string, publish: boolean): Promise<AdminProductDetail> {
  const response = await adminFetch<AdminProductDetail>(`/admin/products/${id}/publish`, {
    method: 'POST',
    body: { publish },
  });
  return response.data;
}

export async function archiveProduct(id: string): Promise<AdminProductDetail> {
  const response = await adminFetch<AdminProductDetail>(`/admin/products/${id}/archive`, {
    method: 'POST',
  });
  return response.data;
}

export async function deleteProduct(id: string): Promise<void> {
  await adminFetch<{ deleted: boolean }>(`/admin/products/${id}`, { method: 'DELETE' });
}

export async function addImage(
  productId: string,
  payload: { url: string; altEn?: string; altBn?: string; isMain?: boolean },
): Promise<AdminProductDetail> {
  const response = await adminFetch<AdminProductDetail>(`/admin/products/${productId}/images`, {
    method: 'POST',
    body: payload,
  });
  return response.data;
}

export async function reorderImages(
  productId: string,
  imageIds: string[],
): Promise<AdminProductDetail> {
  const response = await adminFetch<AdminProductDetail>(
    `/admin/products/${productId}/images/reorder`,
    { method: 'PATCH', body: { imageIds } },
  );
  return response.data;
}

export async function updateImage(
  productId: string,
  imageId: string,
  payload: { altEn?: string | null; altBn?: string | null; isMain?: boolean },
): Promise<AdminProductDetail> {
  const response = await adminFetch<AdminProductDetail>(
    `/admin/products/${productId}/images/${imageId}`,
    { method: 'PATCH', body: payload },
  );
  return response.data;
}

export async function deleteImage(
  productId: string,
  imageId: string,
): Promise<AdminProductDetail> {
  const response = await adminFetch<AdminProductDetail>(
    `/admin/products/${productId}/images/${imageId}`,
    { method: 'DELETE' },
  );
  return response.data;
}

export async function createVariant(
  productId: string,
  payload: {
    sku: string;
    barcode?: string;
    nameEn: string;
    nameBn: string;
    pricePoisha: number;
    stock?: number;
    isActive?: boolean;
  },
): Promise<AdminProductDetail> {
  const response = await adminFetch<AdminProductDetail>(`/admin/products/${productId}/variants`, {
    method: 'POST',
    body: payload,
  });
  return response.data;
}

export async function updateVariant(
  productId: string,
  variantId: string,
  payload: {
    sku?: string;
    barcode?: string | null;
    nameEn?: string;
    nameBn?: string;
    pricePoisha?: number;
    stock?: number;
    isActive?: boolean;
  },
): Promise<AdminProductDetail> {
  const response = await adminFetch<AdminProductDetail>(
    `/admin/products/${productId}/variants/${variantId}`,
    { method: 'PATCH', body: payload },
  );
  return response.data;
}

export async function deleteVariant(
  productId: string,
  variantId: string,
): Promise<AdminProductDetail> {
  const response = await adminFetch<AdminProductDetail>(
    `/admin/products/${productId}/variants/${variantId}`,
    { method: 'DELETE' },
  );
  return response.data;
}
