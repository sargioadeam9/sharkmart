/**
 * Admin coupons API client — the browser half of Phase 10 pass A.
 *
 * Mirrors the DTOs in `server/src/routes/admin/coupon.service.ts`. The types are
 * duplicated rather than imported: the two packages do not share a tsconfig path,
 * and reaching into `../../server/...` would pull Prisma types into the browser
 * bundle. This duplication is the contract — when the server DTO changes, this
 * file changes with it.
 *
 * Every call goes through `adminFetch`, the admin surface's single fetch wrapper
 * (credentials + CSRF). No component calls `fetch` directly.
 */

import { adminFetch } from './admin-client';

export type CouponType = 'FIXED' | 'PERCENTAGE' | 'FREE_DELIVERY';
export type CouponState = 'live' | 'scheduled' | 'expired' | 'exhausted' | 'inactive';
export type CouponStateFilter = CouponState | 'all';
export type CouponSort = 'newest' | 'oldest' | 'used' | 'ending';

export interface CouponListItem {
  id: string;
  code: string;
  type: CouponType;
  value: number;
  minOrderValuePoisha: number | null;
  maxDiscountPoisha: number | null;
  usageLimit: number | null;
  usedCount: number;
  perUserLimit: number;
  startDate: string;
  endDate: string;
  applicableCategories: string[] | null;
  applicableBrands: string[] | null;
  applicableProducts: string[] | null;
  isActive: boolean;
  state: CouponState;
  redemptionTotalPoisha: number;
  createdAt: string;
}

export interface CouponListResponse {
  items: CouponListItem[];
  total: number;
  page: number;
  limit: number;
}

export interface CouponCounts {
  all: number;
  live: number;
  scheduled: number;
  expired: number;
  exhausted: number;
  inactive: number;
}

export interface CouponRedemption {
  id: string;
  orderId: string | null;
  orderNumber: string | null;
  userId: string;
  userName: string;
  amountPoisha: number;
  createdAt: string;
}

export interface CouponRedemptionResponse {
  items: CouponRedemption[];
  total: number;
  page: number;
  limit: number;
}

export interface CouponWriteBody {
  code?: string;
  type?: CouponType;
  value?: number;
  minOrderValuePoisha?: number | null;
  maxDiscountPoisha?: number | null;
  usageLimit?: number | null;
  perUserLimit?: number;
  startDate?: string;
  endDate?: string;
  applicableCategories?: string[] | null;
  applicableBrands?: string[] | null;
  applicableProducts?: string[] | null;
  isActive?: boolean;
}

export async function listCoupons(query: string): Promise<CouponListResponse> {
  const res = await adminFetch<CouponListResponse>(`/admin/coupons?${query}`);
  return res.data;
}

export async function getCouponCounts(): Promise<CouponCounts> {
  const res = await adminFetch<CouponCounts>('/admin/coupons/counts');
  return res.data;
}

export async function createCoupon(body: CouponWriteBody): Promise<CouponListItem> {
  const res = await adminFetch<CouponListItem>('/admin/coupons', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.data;
}

export async function updateCoupon(id: string, body: CouponWriteBody): Promise<CouponListItem> {
  const res = await adminFetch<CouponListItem>(`/admin/coupons/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  return res.data;
}

export async function setCouponActive(id: string, isActive: boolean): Promise<CouponListItem> {
  const res = await adminFetch<CouponListItem>(`/admin/coupons/${id}/active`, {
    method: 'POST',
    body: JSON.stringify({ isActive }),
  });
  return res.data;
}

export async function deleteCoupon(id: string): Promise<void> {
  await adminFetch<{ deleted: boolean }>(`/admin/coupons/${id}`, { method: 'DELETE' });
}

export async function listRedemptions(
  id: string,
  page = 1,
  limit = 20,
): Promise<CouponRedemptionResponse> {
  const res = await adminFetch<CouponRedemptionResponse>(
    `/admin/coupons/${id}/redemptions?page=${page}&limit=${limit}`,
  );
  return res.data;
}
