/**
 * Admin reviews API client — the browser half.
 *
 * Mirrors the server DTOs in `server/src/routes/admin/review.service.ts`. Types
 * are duplicated rather than imported because the two packages do not share a
 * tsconfig path, and importing from `../../server/...` would drag the server's
 * Prisma types into the browser bundle. The duplication is the contract; if the
 * server DTO changes, this file changes with it.
 *
 * Every call goes through `adminFetch`, which is the admin surface's single fetch
 * wrapper (credentials + CSRF). No component calls `fetch` directly.
 */

import { adminFetch } from './admin-client';

/** The five tabs, plus `all`. Mirrors `REVIEW_STATE` in the server validator. */
export type ReviewState = 'pending' | 'approved' | 'rejected' | 'flagged' | 'all';

/** The state of one row. `all` is a filter, never a row's state. */
export type ReviewRowState = Exclude<ReviewState, 'all'>;

export type ReviewSort = 'newest' | 'oldest' | 'rating_desc' | 'rating_asc';

export interface ReviewListItem {
  id: string;
  rating: number;
  titleEn: string | null;
  titleBn: string | null;
  excerpt: string;
  product: { id: string; nameEn: string; nameBn: string };
  reviewer: { id: string; name: string };
  isVerifiedPurchase: boolean;
  isFlagged: boolean;
  state: ReviewRowState;
  createdAt: string;
  moderatedAt: string | null;
  mediaCount: number;
}

export interface ReviewListResponse {
  items: ReviewListItem[];
  total: number;
  page: number;
  limit: number;
}

export interface ReviewMediaItem {
  id: string;
  type: 'IMAGE' | 'VIDEO';
  url: string;
}

export interface ReviewDetail {
  id: string;
  rating: number;
  titleEn: string | null;
  titleBn: string | null;
  contentEn: string | null;
  contentBn: string | null;
  helpfulCount: number;
  reviewer: { id: string; name: string };
  isVerifiedPurchase: boolean;
  isFlagged: boolean;
  state: ReviewRowState;
  createdAt: string;
  moderatedAt: string | null;
  moderatedBy: string | null;
  moderatedByName: string | null;
  media: ReviewMediaItem[];
  mediaCount: number;
  /**
   * The product's stored aggregate as it stands now.
   *
   * `ratingAvg` and `reviewCount` are the stored columns. Under the shipped
   * decision they are NOT derived from reviews, so `approvedReviewCount` (the
   * real number of approved rows) will not match `reviewCount`. The drawer shows
   * both and says why rather than letting the moderator think they agree.
   */
  product: {
    id: string;
    nameEn: string;
    nameBn: string;
    ratingAvg: number;
    reviewCount: number;
    approvedReviewCount: number;
  };
}

export interface ReviewCounts {
  pending: number;
  approved: number;
  rejected: number;
  flagged: number;
  all: number;
}

export interface ReviewBulkResult {
  updated: string[];
  skipped: Array<{ id: string; reason: string }>;
}

export async function listReviews(query: string): Promise<ReviewListResponse> {
  const res = await adminFetch<ReviewListResponse>(`/admin/reviews?${query}`);
  return res.data;
}

export async function getReview(id: string): Promise<ReviewDetail> {
  const res = await adminFetch<ReviewDetail>(`/admin/reviews/${id}`);
  return res.data;
}

export async function getReviewCounts(): Promise<ReviewCounts> {
  const res = await adminFetch<ReviewCounts>('/admin/reviews/counts');
  return res.data;
}

export async function approveReview(id: string): Promise<ReviewDetail> {
  const res = await adminFetch<ReviewDetail>(`/admin/reviews/${id}/approve`, { method: 'POST' });
  return res.data;
}

export async function rejectReview(id: string): Promise<ReviewDetail> {
  const res = await adminFetch<ReviewDetail>(`/admin/reviews/${id}/reject`, { method: 'POST' });
  return res.data;
}

export async function toggleReviewFlag(id: string): Promise<ReviewDetail> {
  const res = await adminFetch<ReviewDetail>(`/admin/reviews/${id}/flag`, { method: 'POST' });
  return res.data;
}

export async function deleteReview(id: string): Promise<{ id: string }> {
  const res = await adminFetch<{ id: string }>(`/admin/reviews/${id}`, { method: 'DELETE' });
  return res.data;
}

export async function bulkModerate(
  ids: string[],
  action: 'approve' | 'reject' | 'flag',
): Promise<ReviewBulkResult> {
  const res = await adminFetch<ReviewBulkResult>('/admin/reviews/bulk', {
    method: 'POST',
    body: { ids, action },
  });
  return res.data;
}
