/**
 * Categories — `/admin/categories`.
 *
 * A server component: it reads the query string, fetches the tree once from
 * `GET /api/v1/admin/categories`, and hands the rows to the client island. No
 * count on this page is computed in the browser — `productCount`, `childCount`
 * and `path` all arrive from the endpoint, because a second copy of "how many
 * products are in this category" in the UI would drift from the one the delete
 * guard uses, and the delete guard is the one that has to be right.
 *
 * ── Scope decision in B5, not by oversight ─────────────────────────────────
 *
 * Reorder is button-based (up/down per row) rather than drag-and-drop: both hit
 * the same `/reorder` endpoint and produce the same dense `sortOrder`, and the
 * buttons work on touch without a pointer-drag implementation. CSV export is
 * absent — 98 categories do not need one. Bulk select and the sticky bulk bar
 * are absent because the API offers no bulk operation for categories, so the bar
 * would be decoration. Create and edit forms are not in this pass.
 *
 * ── Why `view=tree` is fixed here ──────────────────────────────────────────
 *
 * The screen is a tree. `view=flat` exists on the API for pickers and for the
 * duplicate-name check; this page never asks for it. The `q` filter is applied
 * server-side and a child whose parent is filtered out is returned as a root by
 * the service, so searching still shows the match with its `path` intact.
 */

import type { Metadata } from 'next';

import { adminFetchServer, AdminApiError } from '@/lib/api/admin';
import { getLang } from '@/lib/locale';
import {
  CategoriesTree,
  type ActiveFilter,
  type CategoryListResponse,
  type CategoryTreeNode,
} from '@/components/admin/categories-tree';

export const metadata: Metadata = {
  title: 'Categories',
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function one(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

const VALID_ACTIVE: ActiveFilter[] = ['all', 'true', 'false'];

interface MeResponse {
  permissions: string[];
}

export default async function CategoriesPage({ searchParams }: PageProps) {
  const lang = await getLang();
  const params = await searchParams;

  const q = (one(params.q) ?? '').trim();
  const rawActive = one(params.active) ?? 'all';
  const active: ActiveFilter = VALID_ACTIVE.includes(rawActive as ActiveFilter)
    ? (rawActive as ActiveFilter)
    : 'all';

  const query = new URLSearchParams();
  query.set('view', 'tree');
  if (q) query.set('q', q);
  if (active !== 'all') query.set('active', active);

  let items: CategoryTreeNode[] = [];
  let total = 0;
  let rootCount = 0;
  let childCount = 0;
  let canWrite = false;
  let error: string | null = null;

  try {
    /**
     * Two calls in parallel: the tree and the caller's permissions. `/admin/me`
     * is the authoritative answer to "may I write" — the API enforces it
     * independently, and hiding the controls is UX on top of that, not the
     * control itself.
     */
    const [list, me] = await Promise.all([
      adminFetchServer<CategoryListResponse>(`/admin/categories?${query.toString()}`),
      adminFetchServer<MeResponse>('/admin/me'),
    ]);

    items = list.data.items as CategoryTreeNode[];
    total = list.data.total;
    rootCount = list.data.rootCount;
    childCount = list.data.childCount;
    canWrite = me.data.permissions.includes('catalog:write');
  } catch (caught) {
    error =
      caught instanceof AdminApiError
        ? caught.message
        : lang === 'bn'
          ? 'ক্যাটাগরি লোড করা যায়নি।'
          : 'Could not load categories.';
  }

  /** Admin surface uses lakh grouping (AGENTS.md §3). */
  const num = (value: number) => value.toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-IN');

  return (
    <>
      <div className="title-row">
        <div>
          <h1>{lang === 'bn' ? 'ক্যাটাগরি' : 'Categories'}</h1>
          <p className="sub">
            {lang === 'bn'
              ? `${num(rootCount)}টি মূল · ${num(childCount)}টি উপ-ক্যাটাগরি · ${num(total)}টি মোট`
              : `${num(rootCount)} roots · ${num(childCount)} sub-categories · ${num(total)} total`}
          </p>
        </div>
      </div>

      {error ? (
        <div className="card">
          <p style={{ color: 'var(--bad)' }}>{error}</p>
        </div>
      ) : (
        <CategoriesTree
          lang={lang}
          items={items}
          total={total}
          q={q}
          active={active}
          canWrite={canWrite}
        />
      )}
    </>
  );
}
