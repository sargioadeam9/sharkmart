'use client';

/**
 * The categories screen's client island — tree table, active toggles, up/down
 * reorder, and the delete dialog.
 *
 * ── Scope decision in B5, not by oversight ─────────────────────────────────
 *
 * Reorder is button-based (two small up/down buttons per row) instead of
 * drag-and-drop: both call the same `POST /:id/reorder` with the same complete
 * sibling list and produce the same dense `sortOrder`, the buttons work on touch
 * and with a keyboard, and drag-and-drop would cost a dependency and a pointer
 * implementation for no gain in correctness. CSV export is absent — 98
 * categories do not need one. Bulk select and the sticky bulk bar are absent
 * because the API exposes no bulk operation for categories, so the bar would be
 * decoration over a loop of single calls.
 *
 * ── Why the tree is rendered from a flat walk ──────────────────────────────
 *
 * `GET /admin/categories?view=tree` returns roots with their children inlined.
 * The table is a single `<tbody>` of rows, so a root and its children are
 * siblings in the DOM and the child rows are indented rather than nested. That
 * keeps one header row, keeps `data-label` stacking under 720px working, and
 * avoids a nested table (which cannot stack the way the admin stylesheet
 * expects).
 *
 * ── The duplicate-name rule ────────────────────────────────────────────────
 *
 * Three categories are called "Accessories" (under Fashion, Gadgets &
 * Electronics, and Automotive & Motorbike). A row therefore always renders its
 * `path` when it is a child, and a root that shares its name with another
 * visible row renders its `path` too. Without that, the operator sees three
 * identical rows and cannot tell which one the delete button belongs to.
 *
 * ── Reorder needs the whole group ──────────────────────────────────────────
 *
 * The endpoint refuses a partial list (`orderedIds.length !== siblingIds.size`
 * is a 422) so the renumber cannot collide. That means the buttons must be
 * disabled whenever a filter is active, because the visible rows are then a
 * subset of the real sibling group and sending them would be a guaranteed 422.
 * The toolbar says so rather than letting the operator discover it.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronRight, ChevronUp, FolderTree, Search, Trash2, X } from 'lucide-react';

import { adminFetch, AdminApiError } from '@/lib/api/admin-client';

type Lang = 'en' | 'bn';

export type ActiveFilter = 'all' | 'true' | 'false';

/** Mirrors `CategoryRow` in `server/src/routes/admin/category.service.ts`. */
export interface CategoryRow {
  id: string;
  slug: string;
  nameEn: string;
  nameBn: string;
  parentId: string | null;
  iconEmoji: string | null;
  bannerImage: string | null;
  accentColor: string | null;
  lightTintColor: string | null;
  sortOrder: number;
  isActive: boolean;
  metaTitleEn: string | null;
  metaTitleBn: string | null;
  metaDescEn: string | null;
  metaDescBn: string | null;
  createdAt: string;
  updatedAt: string;
  productCount: number;
  childCount: number;
  /** "Fashion / Accessories" — the disambiguator. */
  path: string;
}

export interface CategoryTreeNode extends CategoryRow {
  children: CategoryRow[];
}

export interface CategoryListResponse {
  view: 'tree' | 'flat';
  items: CategoryTreeNode[] | CategoryRow[];
  total: number;
  rootCount: number;
  childCount: number;
}

/** The `details` payload of a 409 from `DELETE /admin/categories/:id`. */
interface DeleteRefusalDetails {
  reason?: 'CATEGORY_IN_USE' | 'CATEGORY_HAS_CHILDREN' | 'CATEGORY_CYCLE';
  productCount?: number;
  products?: Array<{ id: string; nameEn: string }>;
  childCount?: number;
  children?: Array<{ id: string; nameEn: string }>;
}

function nameOf(row: CategoryRow, lang: Lang): string {
  return lang === 'bn' ? row.nameBn : row.nameEn;
}

/** Admin surface uses lakh grouping (AGENTS.md §3). */
function num(value: number, lang: Lang): string {
  return value.toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-IN');
}

// ─── Delete dialog ──────────────────────────────────────────────────────────

interface DeleteDialogProps {
  lang: Lang;
  row: CategoryRow;
  onClose: () => void;
  onDone: (message: string) => void;
}

/**
 * The dialog is driven by the API's own 409 body, not by a guess.
 *
 * `CATEGORY_IN_USE` carries `productCount` and up to three product names;
 * `CATEGORY_HAS_CHILDREN` carries `childCount` and the child names. Both are
 * rendered as the server wrote them — the message names the count and the
 * reason, and the list names the products — because rewriting that sentence in
 * the browser would be a second copy of a rule that lives on the server, and the
 * server's copy is the one that decides whether the delete happens.
 *
 * The action offered matches what the API supports: `?reparent=true` for
 * children, nothing for products (a category with products cannot be deleted at
 * all — the products have to move first, and there is no bulk move endpoint).
 */
function DeleteDialog({ lang, row, onClose, onDone }: DeleteDialogProps) {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<DeleteRefusalDetails | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const attempt = useCallback(
    async (reparent: boolean) => {
      setBusy(true);
      setError(null);
      try {
        const query = reparent ? '?reparent=true' : '';
        await adminFetch<{ deleted: true }>(`/admin/categories/${row.id}${query}`, {
          method: 'DELETE',
        });
        onDone(
          lang === 'bn'
            ? `${nameOf(row, lang)} মুছে ফেলা হয়েছে।`
            : `${nameOf(row, lang)} deleted.`,
        );
      } catch (caught) {
        if (caught instanceof AdminApiError && caught.status === 409) {
          const details = (caught.details ?? {}) as DeleteRefusalDetails;
          setRefusal(details);
          setMessage(caught.message);
        } else {
          setError(
            caught instanceof AdminApiError
              ? caught.message
              : lang === 'bn'
                ? 'মুছে ফেলা যায়নি।'
                : 'Could not delete.',
          );
        }
      } finally {
        setBusy(false);
      }
    },
    [row, lang, onDone],
  );

  const blockingProducts = refusal?.reason === 'CATEGORY_IN_USE';
  const blockingChildren = refusal?.reason === 'CATEGORY_HAS_CHILDREN';

  return (
    <div className="overlay open" role="presentation" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cat-del-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="m-head">
          <h2 id="cat-del-title">{lang === 'bn' ? 'ক্যাটাগরি মুছুন' : 'Delete category'}</h2>
          <button
            type="button"
            className="x"
            onClick={onClose}
            aria-label={lang === 'bn' ? 'বন্ধ করুন' : 'Close'}
          >
            <X size={17} />
          </button>
        </div>

        <div className="m-body">
          <div className="cat-dialog-body">
            <p className="cat-dialog-lead">
              {lang === 'bn' ? 'মুছে ফেলতে যাচ্ছেন:' : 'You are deleting:'}{' '}
              <b>{nameOf(row, lang)}</b>
            </p>

            {/* The path is always shown here, even for a root: the dialog is the
                last place a duplicate name can be caught before it is gone. */}
            <p>
              <span className="cat-path">{row.path}</span>
            </p>

            {row.childCount > 0 && !refusal && (
              <p className="cat-dialog-note">
                {lang === 'bn'
                  ? `এই ক্যাটাগরির ${num(row.childCount, lang)}টি উপ-ক্যাটাগরি আছে।`
                  : `This category has ${num(row.childCount, lang)} sub-categories.`}
              </p>
            )}

            {row.productCount > 0 && !refusal && (
              <p className="cat-dialog-note">
                {lang === 'bn'
                  ? `${num(row.productCount, lang)}টি পণ্য এই ক্যাটাগরি ব্যবহার করে।`
                  : `${num(row.productCount, lang)} products use this category.`}
              </p>
            )}

            {message && (
              <p className={`cat-dialog-msg${blockingChildren ? ' info' : ''}`}>{message}</p>
            )}

            {blockingProducts && refusal?.products?.length ? (
              <ul className="cat-dialog-list">
                {refusal.products.map((product) => (
                  <li key={product.id}>
                    <b>{product.nameEn}</b>
                  </li>
                ))}
                {(refusal.productCount ?? 0) > refusal.products.length && (
                  <li>
                    {lang === 'bn'
                      ? `আরও ${num((refusal.productCount ?? 0) - refusal.products.length, lang)}টি…`
                      : `and ${num((refusal.productCount ?? 0) - refusal.products.length, lang)} more…`}
                  </li>
                )}
              </ul>
            ) : null}

            {blockingChildren && refusal?.children?.length ? (
              <ul className="cat-dialog-list">
                {refusal.children.map((child) => (
                  <li key={child.id}>
                    <b>{child.nameEn}</b>
                  </li>
                ))}
                {(refusal.childCount ?? 0) > refusal.children.length && (
                  <li>
                    {lang === 'bn'
                      ? `আরও ${num((refusal.childCount ?? 0) - refusal.children.length, lang)}টি…`
                      : `and ${num((refusal.childCount ?? 0) - refusal.children.length, lang)} more…`}
                  </li>
                )}
              </ul>
            ) : null}

            {blockingProducts && (
              <p className="cat-dialog-note">
                {lang === 'bn'
                  ? 'পণ্যগুলো অন্য ক্যাটাগরিতে সরানোর আগে এটি মোছা যাবে না। পণ্য সরানোর কোনো বাল্ক অপশন নেই।'
                  : 'The products have to move to another category first. There is no bulk move for products, so this is a manual step.'}
              </p>
            )}

            {blockingChildren && (
              <p className="cat-dialog-note">
                {lang === 'bn'
                  ? '“রিপ্যারেন্ট” চাপলে উপ-ক্যাটাগরিগুলো মূল স্তরে চলে যাবে, তারপর এটি মোছা হবে।'
                  : 'Reparenting promotes the sub-categories to top level, then deletes this one.'}
              </p>
            )}

            {error && <p className="cat-dialog-err">{error}</p>}
          </div>
        </div>

        <div className="m-foot">
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
            {lang === 'bn' ? 'বাতিল' : 'Cancel'}
          </button>

          {blockingChildren ? (
            <button
              type="button"
              className="btn"
              onClick={() => void attempt(true)}
              disabled={busy}
            >
              {busy
                ? lang === 'bn'
                  ? 'চলছে…'
                  : 'Working…'
                : lang === 'bn'
                  ? 'রিপ্যারেন্ট করে মুছুন'
                  : 'Reparent and delete'}
            </button>
          ) : (
            <button
              type="button"
              className="btn danger"
              onClick={() => void attempt(false)}
              disabled={busy || blockingProducts}
            >
              {busy
                ? lang === 'bn'
                  ? 'চলছে…'
                  : 'Working…'
                : lang === 'bn'
                  ? 'মুছে ফেলুন'
                  : 'Delete'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Tree ───────────────────────────────────────────────────────────────────

interface TreeProps {
  lang: Lang;
  items: CategoryTreeNode[];
  total: number;
  q: string;
  active: ActiveFilter;
  canWrite: boolean;
}

/** One row of the rendered tree, flattened. */
interface FlatRow {
  row: CategoryRow;
  depth: 0 | 1;
  /** The sibling group this row belongs to, in display order. */
  siblings: CategoryRow[];
}

export function CategoriesTree({ lang, items, total, q, active, canWrite }: TreeProps) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleteFor, setDeleteFor] = useState<CategoryRow | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  /**
   * A filter means the visible rows are a subset of the real sibling group, and
   * `/reorder` refuses a partial list. Disabling the buttons is the honest
   * response; the toolbar explains why.
   */
  const filtered = q.length > 0 || active !== 'all';

  /**
   * Roots that share their name with another visible row must show their path.
   * The three "Accessories" are all children, so this mostly protects a future
   * duplicate root — but the check is cheap and the failure it prevents is
   * deleting the wrong row.
   */
  const duplicateNames = useMemo(() => {
    const seen = new Map<string, number>();
    for (const root of items) {
      const key = root.nameEn.trim().toLowerCase();
      seen.set(key, (seen.get(key) ?? 0) + 1);
      for (const child of root.children) {
        const childKey = child.nameEn.trim().toLowerCase();
        seen.set(childKey, (seen.get(childKey) ?? 0) + 1);
      }
    }
    return seen;
  }, [items]);

  const flat = useMemo(() => {
    const rows: FlatRow[] = [];
    for (const root of items) {
      rows.push({ row: root, depth: 0, siblings: items });
      if (root.children.length > 0 && !collapsed.has(root.id)) {
        for (const child of root.children) {
          rows.push({ row: child, depth: 1, siblings: root.children });
        }
      }
    }
    return rows;
  }, [items, collapsed]);

  const toggleCollapse = useCallback((id: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setActive = useCallback(
    async (row: CategoryRow, next: boolean) => {
      setBusyId(row.id);
      setNotice(null);
      try {
        await adminFetch<CategoryRow>(`/admin/categories/${row.id}/active`, {
          method: 'POST',
          body: { isActive: next },
        });
        setNotice(
          lang === 'bn'
            ? `${nameOf(row, lang)} ${next ? 'সক্রিয়' : 'নিষ্ক্রিয়'} করা হয়েছে।`
            : `${nameOf(row, lang)} ${next ? 'activated' : 'deactivated'}.`,
        );
        router.refresh();
      } catch (caught) {
        setNotice(
          caught instanceof AdminApiError
            ? caught.message
            : lang === 'bn'
              ? 'পরিবর্তন করা যায়নি।'
              : 'Could not update.',
        );
      } finally {
        setBusyId(null);
      }
    },
    [lang, router],
  );

  /**
   * Move one row up or down inside its own sibling group.
   *
   * The endpoint wants the complete group in its new order, so this builds the
   * full id list from the group, swaps two adjacent entries, and posts it. The
   * anchor `:id` is the moved row. `sortOrder` is renumbered densely by the
   * server, so repeated moves cannot drift into gaps.
   */
  const move = useCallback(
    async (row: CategoryRow, siblings: CategoryRow[], direction: -1 | 1) => {
      const index = siblings.findIndex((sibling) => sibling.id === row.id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= siblings.length) return;

      const ordered = siblings.map((sibling) => sibling.id);
      const [moved] = ordered.splice(index, 1);
      ordered.splice(target, 0, moved!);

      setBusyId(row.id);
      setNotice(null);
      try {
        await adminFetch<{ updated: number }>(`/admin/categories/${row.id}/reorder`, {
          method: 'POST',
          body: { orderedIds: ordered },
        });
        router.refresh();
      } catch (caught) {
        setNotice(
          caught instanceof AdminApiError
            ? caught.message
            : lang === 'bn'
              ? 'ক্রম পরিবর্তন করা যায়নি।'
              : 'Could not reorder.',
        );
      } finally {
        setBusyId(null);
      }
    },
    [lang, router],
  );

  const submitSearch = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const value = searchRef.current?.value.trim() ?? '';
      const params = new URLSearchParams();
      if (value) params.set('q', value);
      if (active !== 'all') params.set('active', active);
      router.push(`/admin/categories${params.toString() ? `?${params.toString()}` : ''}`);
    },
    [active, router],
  );

  const hrefWithActive = useCallback(
    (next: ActiveFilter) => {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (next !== 'all') params.set('active', next);
      return `/admin/categories${params.toString() ? `?${params.toString()}` : ''}`;
    },
    [q],
  );

  return (
    <>
      <form className="cat-toolbar" onSubmit={submitSearch} role="search">
        <label className="cat-search">
          <Search size={16} aria-hidden />
          <input
            ref={searchRef}
            type="search"
            name="q"
            defaultValue={q}
            placeholder={lang === 'bn' ? 'নাম বা স্লাগ খুঁজুন…' : 'Search name or slug…'}
            aria-label={lang === 'bn' ? 'ক্যাটাগরি খুঁজুন' : 'Search categories'}
          />
        </label>

        <div className="seg" role="group" aria-label={lang === 'bn' ? 'সক্রিয় ফিল্টার' : 'Active filter'}>
          {(['all', 'true', 'false'] as ActiveFilter[]).map((value) => (
            <a
              key={value}
              href={hrefWithActive(value)}
              className={active === value ? 'on' : undefined}
              aria-current={active === value ? 'true' : undefined}
            >
              {value === 'all'
                ? lang === 'bn'
                  ? 'সব'
                  : 'All'
                : value === 'true'
                  ? lang === 'bn'
                    ? 'সক্রিয়'
                    : 'Active'
                  : lang === 'bn'
                    ? 'নিষ্ক্রিয়'
                    : 'Inactive'}
            </a>
          ))}
        </div>

        {filtered && (
          <span className="cat-filter-note">
            {lang === 'bn'
              ? 'ফিল্টার চালু থাকায় ক্রম বদলানো বন্ধ।'
              : 'Reorder is off while a filter is active — it needs the full sibling group.'}
          </span>
        )}
      </form>

      <div className="card cat-table-card">
        <div className="cat-table-head">
          <span className="cat-count">
            {lang === 'bn'
              ? `${num(flat.length, lang)}টি দেখানো হচ্ছে · ${num(total, lang)}টি মোট`
              : `Showing ${num(flat.length, lang)} of ${num(total, lang)}`}
          </span>
          {notice && <span className="rev-notice">{notice}</span>}
        </div>

        {flat.length === 0 ? (
          <div className="cat-empty">
            <FolderTree size={28} className="cat-empty-icon" aria-hidden />
            <p className="cat-empty-title">
              {filtered
                ? lang === 'bn'
                  ? 'এই ফিল্টারে কিছু নেই'
                  : 'Nothing matches this filter'
                : lang === 'bn'
                  ? 'এখনো কোনো ক্যাটাগরি নেই'
                  : 'No categories yet'}
            </p>
            <p className="cat-empty-body">
              {filtered
                ? lang === 'bn'
                  ? 'সার্চ বা সক্রিয় ফিল্টার মুছে আবার দেখুন।'
                  : 'Clear the search or the active filter to see the full tree.'
                : lang === 'bn'
                  ? 'ক্যাটাগরি যোগ করলে সেগুলো এখানে গাছের আকারে দেখা যাবে।'
                  : 'Once categories exist they appear here as a tree.'}
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="cat-table">
              <thead>
                <tr>
                  <th className="cat-col-name">{lang === 'bn' ? 'ক্যাটাগরি' : 'Category'}</th>
                  <th className="cat-col-count">{lang === 'bn' ? 'পণ্য' : 'Products'}</th>
                  <th className="cat-col-active">{lang === 'bn' ? 'সক্রিয়' : 'Active'}</th>
                  <th className="cat-col-order">{lang === 'bn' ? 'ক্রম' : 'Order'}</th>
                  <th className="cat-col-order" aria-label={lang === 'bn' ? 'অ্যাকশন' : 'Actions'} />
                </tr>
              </thead>
              <tbody>
                {flat.map(({ row, depth, siblings }) => {
                  const isRoot = depth === 0;
                  const hasChildren = row.childCount > 0;
                  const isOpen = !collapsed.has(row.id);
                  const index = siblings.findIndex((sibling) => sibling.id === row.id);
                  const isFirst = index === 0;
                  const isLast = index === siblings.length - 1;
                  const showPath =
                    !isRoot || (duplicateNames.get(row.nameEn.trim().toLowerCase()) ?? 0) > 1;

                  return (
                    <tr
                      key={row.id}
                      className={isRoot ? undefined : 'cat-child-row'}
                      data-depth={depth}
                    >
                      <td className="cat-col-name">
                        <span className="cat-name">
                          {isRoot ? (
                            hasChildren ? (
                              <button
                                type="button"
                                className={isOpen ? 'cat-expand open' : 'cat-expand'}
                                onClick={() => toggleCollapse(row.id)}
                                aria-expanded={isOpen}
                                aria-label={
                                  lang === 'bn'
                                    ? `${nameOf(row, lang)} এর উপ-ক্যাটাগরি ${isOpen ? 'লুকান' : 'দেখান'}`
                                    : `${isOpen ? 'Collapse' : 'Expand'} ${nameOf(row, lang)}`
                                }
                              >
                                <ChevronRight size={15} />
                              </button>
                            ) : (
                              <span className="cat-expand-spacer" aria-hidden />
                            )
                          ) : (
                            <span className="cat-indent" style={{ width: 26 }} aria-hidden />
                          )}

                          {/* 84 of 98 categories have no accentColor, so the tile
                              is neutral by default and colour is never the thing
                              that distinguishes two rows. */}
                          <span
                            className={row.iconEmoji ? 'cat-icon' : 'cat-icon empty'}
                            aria-hidden
                          >
                            {row.iconEmoji ?? '·'}
                          </span>

                          <span className="cat-label">
                            <b>{nameOf(row, lang)}</b>
                            <small>{lang === 'bn' ? row.nameEn : row.nameBn}</small>
                            {showPath && <span className="cat-path">{row.path}</span>}
                          </span>
                        </span>
                      </td>

                      <td className="cat-col-count" data-label={lang === 'bn' ? 'পণ্য' : 'Products'}>
                        <span className={row.productCount === 0 ? 'cat-num zero' : 'cat-num'}>
                          {num(row.productCount, lang)}
                          {row.childCount > 0 && (
                            <small>
                              {lang === 'bn'
                                ? `${num(row.childCount, lang)}টি উপ`
                                : `${num(row.childCount, lang)} sub`}
                            </small>
                          )}
                        </span>
                      </td>

                      <td className="cat-col-active" data-label={lang === 'bn' ? 'সক্রিয়' : 'Active'}>
                        <button
                          type="button"
                          className={row.isActive ? 'cat-toggle on' : 'cat-toggle'}
                          onClick={() => void setActive(row, !row.isActive)}
                          disabled={!canWrite || busyId === row.id}
                          aria-pressed={row.isActive}
                          aria-label={
                            lang === 'bn'
                              ? `${nameOf(row, lang)} ${row.isActive ? 'নিষ্ক্রিয় করুন' : 'সক্রিয় করুন'}`
                              : `${row.isActive ? 'Deactivate' : 'Activate'} ${nameOf(row, lang)}`
                          }
                        >
                          <i aria-hidden />
                          {row.isActive
                            ? lang === 'bn'
                              ? 'সক্রিয়'
                              : 'Active'
                            : lang === 'bn'
                              ? 'নিষ্ক্রিয়'
                              : 'Inactive'}
                        </button>
                      </td>

                      <td className="cat-col-order" data-label={lang === 'bn' ? 'ক্রম' : 'Order'}>
                        <span className="cat-order">
                          <button
                            type="button"
                            onClick={() => void move(row, siblings, -1)}
                            disabled={!canWrite || filtered || isFirst || busyId === row.id}
                            aria-label={
                              lang === 'bn'
                                ? `${nameOf(row, lang)} উপরে সরান`
                                : `Move ${nameOf(row, lang)} up`
                            }
                          >
                            <ChevronUp size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => void move(row, siblings, 1)}
                            disabled={!canWrite || filtered || isLast || busyId === row.id}
                            aria-label={
                              lang === 'bn'
                                ? `${nameOf(row, lang)} নিচে সরান`
                                : `Move ${nameOf(row, lang)} down`
                            }
                          >
                            <ChevronDown size={13} />
                          </button>
                        </span>
                      </td>

                      <td className="cat-col-order" data-label="">
                        <span className="cat-row-actions">
                          <button
                            type="button"
                            className="cat-del"
                            onClick={() => setDeleteFor(row)}
                            disabled={!canWrite}
                            aria-label={
                              lang === 'bn'
                                ? `${nameOf(row, lang)} মুছুন`
                                : `Delete ${nameOf(row, lang)}`
                            }
                          >
                            <Trash2 size={14} />
                          </button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {deleteFor && (
        <DeleteDialog
          lang={lang}
          row={deleteFor}
          onClose={() => setDeleteFor(null)}
          onDone={(message) => {
            setDeleteFor(null);
            setNotice(message);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
