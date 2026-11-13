'use client';

/**
 * The brands screen's client island — table, active toggles, up/down reorder,
 * and the detach-aware delete dialog.
 *
 * ── Scope decision in B5, not by oversight ─────────────────────────────────
 *
 * Reorder is button-based (two small up/down buttons per row) instead of
 * drag-and-drop: both call the same `POST /admin/brands/reorder` with the same
 * complete id list and produce the same dense `sortOrder`, the buttons work on
 * touch and with a keyboard, and drag-and-drop would cost a dependency for no
 * gain in correctness. CSV export is absent — 25 brands do not need one. Bulk
 * select and the sticky bulk bar are absent because the API exposes no bulk
 * operation for brands, so the bar would be decoration over a loop of single
 * calls.
 *
 * ── The delete contract, and why this dialog is shaped the way it is ───────
 *
 * Brand delete is `SET NULL` on products: the row goes and the products keep
 * existing with `brandId = null`. The storefront then shows a blank brand name,
 * which is a silent, visible-to-customers change. The API refuses that with a
 * 409 `BRAND_IN_USE` unless `?detach=true` is sent, so the dialog:
 *
 *   1. shows the count and the product names the API returned,
 *   2. labels the button "Detach N products and delete" rather than "Delete",
 *   3. sends `?detach=true` only from that button,
 *   4. reports `affectedCount` afterwards, so the operator learns how many
 *      products were left without a brand.
 *
 * A raw 409 or a red toast would be a failure of this screen: the operator would
 * have no idea what to do next.
 *
 * ── Reorder needs the whole group ──────────────────────────────────────────
 *
 * `/reorder` takes every brand id in its new order. Under a search or an active
 * filter the visible rows are a subset, so the buttons are disabled and the
 * toolbar says why.
 */

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronUp, Search, Tag, Trash2, X } from 'lucide-react';

import { adminFetch, AdminApiError } from '@/lib/api/admin-client';

type Lang = 'en' | 'bn';

export type ActiveFilter = 'all' | 'true' | 'false';
export type BrandSort = 'sortOrder' | 'name' | 'products';

/** Mirrors `BrandRow` in `server/src/routes/admin/brand.service.ts`. */
export interface BrandRow {
  id: string;
  slug: string;
  nameEn: string;
  nameBn: string;
  logo: string | null;
  taglineEn: string | null;
  taglineBn: string | null;
  color: string | null;
  isOwnBrand: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  productCount: number;
}

export interface BrandListResponse {
  items: BrandRow[];
  total: number;
}

/** The `details` payload of a 409 `BRAND_IN_USE`. */
interface BrandRefusalDetails {
  reason?: 'BRAND_IN_USE';
  productCount?: number;
  products?: Array<{ id: string; nameEn: string }>;
}

function nameOf(row: BrandRow, lang: Lang): string {
  return lang === 'bn' ? row.nameBn : row.nameEn;
}

function taglineOf(row: BrandRow, lang: Lang): string | null {
  return lang === 'bn' ? row.taglineBn ?? row.taglineEn : row.taglineEn ?? row.taglineBn;
}

/** Admin surface uses lakh grouping (AGENTS.md §3). */
function num(value: number, lang: Lang): string {
  return value.toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-IN');
}

/** Two initials for the logo placeholder, so a missing logo still reads as a row. */
function initials(row: BrandRow): string {
  return row.nameEn
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

// ─── Delete dialog ──────────────────────────────────────────────────────────

interface DeleteDialogProps {
  lang: Lang;
  row: BrandRow;
  onClose: () => void;
  onDone: (message: string) => void;
}

function DeleteDialog({ lang, row, onClose, onDone }: DeleteDialogProps) {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<BrandRefusalDetails | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const attempt = useCallback(
    async (detach: boolean) => {
      setBusy(true);
      setError(null);
      try {
        const query = detach ? '?detach=true' : '';
        const result = await adminFetch<{ deleted: true; affectedCount: number }>(
          `/admin/brands/${row.id}${query}`,
          { method: 'DELETE' },
        );

        const affected = result.data.affectedCount;
        onDone(
          detach && affected > 0
            ? lang === 'bn'
              ? `${nameOf(row, lang)} মুছে ফেলা হয়েছে; ${num(affected, lang)}টি পণ্য এখন ব্র্যান্ডবিহীন।`
              : `${nameOf(row, lang)} deleted; ${num(affected, lang)} products are now without a brand.`
            : lang === 'bn'
              ? `${nameOf(row, lang)} মুছে ফেলা হয়েছে।`
              : `${nameOf(row, lang)} deleted.`,
        );
      } catch (caught) {
        if (caught instanceof AdminApiError && caught.status === 409) {
          setRefusal((caught.details ?? {}) as BrandRefusalDetails);
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

  const inUse = refusal?.reason === 'BRAND_IN_USE';
  const count = refusal?.productCount ?? row.productCount;

  return (
    <div className="overlay open" role="presentation" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="brd-del-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="m-head">
          <h2 id="brd-del-title">{lang === 'bn' ? 'ব্র্যান্ড মুছুন' : 'Delete brand'}</h2>
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

            {message && <p className="cat-dialog-msg">{message}</p>}

            {inUse && refusal?.products?.length ? (
              <ul className="cat-dialog-list">
                {refusal.products.map((product) => (
                  <li key={product.id}>
                    <b>{product.nameEn}</b>
                  </li>
                ))}
                {count > refusal.products.length && (
                  <li>
                    {lang === 'bn'
                      ? `আরও ${num(count - refusal.products.length, lang)}টি…`
                      : `and ${num(count - refusal.products.length, lang)} more…`}
                  </li>
                )}
              </ul>
            ) : null}

            {inUse && (
              <p className="cat-dialog-note">
                {lang === 'bn'
                  ? 'ডিটাচ করলে পণ্যগুলো থেকে যাবে, কিন্তু তাদের ব্র্যান্ড থাকবে না — দোকানে ব্র্যান্ডের নাম ফাঁকা দেখাবে।'
                  : 'Detaching keeps the products but leaves them with no brand — the storefront will show a blank brand name on each one.'}
              </p>
            )}

            {error && <p className="cat-dialog-err">{error}</p>}
          </div>
        </div>

        <div className="m-foot">
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
            {lang === 'bn' ? 'বাতিল' : 'Cancel'}
          </button>

          {inUse ? (
            <button type="button" className="btn danger" onClick={() => void attempt(true)} disabled={busy}>
              {busy
                ? lang === 'bn'
                  ? 'চলছে…'
                  : 'Working…'
                : lang === 'bn'
                  ? `${num(count, lang)}টি পণ্য ডিটাচ করে মুছুন`
                  : `Detach ${num(count, lang)} products and delete`}
            </button>
          ) : (
            <button type="button" className="btn danger" onClick={() => void attempt(false)} disabled={busy}>
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

// ─── Table ──────────────────────────────────────────────────────────────────

interface TableProps {
  lang: Lang;
  items: BrandRow[];
  total: number;
  q: string;
  active: ActiveFilter;
  sort: BrandSort;
  canWrite: boolean;
}

export function BrandsTable({ lang, items, total, q, active, sort, canWrite }: TableProps) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleteFor, setDeleteFor] = useState<BrandRow | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  /**
   * Reorder posts the complete brand list, so a filtered view cannot supply it.
   * Sorting by name or product count also breaks the visual order the buttons
   * assume, so the buttons are only live on the natural `sortOrder` view.
   */
  const reorderable = q.length === 0 && active === 'all' && sort === 'sortOrder';

  const setActive = useCallback(
    async (row: BrandRow, next: boolean) => {
      setBusyId(row.id);
      setNotice(null);
      try {
        await adminFetch<BrandRow>(`/admin/brands/${row.id}/active`, {
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

  const move = useCallback(
    async (row: BrandRow, direction: -1 | 1) => {
      const index = items.findIndex((item) => item.id === row.id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= items.length) return;

      const ordered = items.map((item) => item.id);
      const [moved] = ordered.splice(index, 1);
      ordered.splice(target, 0, moved!);

      setBusyId(row.id);
      setNotice(null);
      try {
        await adminFetch<{ updated: number }>('/admin/brands/reorder', {
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
    [items, lang, router],
  );

  const submitSearch = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const value = searchRef.current?.value.trim() ?? '';
      const params = new URLSearchParams();
      if (value) params.set('q', value);
      if (active !== 'all') params.set('active', active);
      if (sort !== 'sortOrder') params.set('sort', sort);
      router.push(`/admin/brands${params.toString() ? `?${params.toString()}` : ''}`);
    },
    [active, sort, router],
  );

  const hrefWith = useCallback(
    (overrides: { active?: ActiveFilter; sort?: BrandSort }) => {
      const nextActive = overrides.active ?? active;
      const nextSort = overrides.sort ?? sort;
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (nextActive !== 'all') params.set('active', nextActive);
      if (nextSort !== 'sortOrder') params.set('sort', nextSort);
      return `/admin/brands${params.toString() ? `?${params.toString()}` : ''}`;
    },
    [q, active, sort],
  );

  const filtered = q.length > 0 || active !== 'all';

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
            aria-label={lang === 'bn' ? 'ব্র্যান্ড খুঁজুন' : 'Search brands'}
          />
        </label>

        <div className="seg" role="group" aria-label={lang === 'bn' ? 'সক্রিয় ফিল্টার' : 'Active filter'}>
          {(['all', 'true', 'false'] as ActiveFilter[]).map((value) => (
            <a
              key={value}
              href={hrefWith({ active: value })}
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

        <div className="seg" role="group" aria-label={lang === 'bn' ? 'সাজান' : 'Sort'}>
          {(['sortOrder', 'name', 'products'] as BrandSort[]).map((value) => (
            <a
              key={value}
              href={hrefWith({ sort: value })}
              className={sort === value ? 'on' : undefined}
              aria-current={sort === value ? 'true' : undefined}
            >
              {value === 'sortOrder'
                ? lang === 'bn'
                  ? 'ক্রম'
                  : 'Order'
                : value === 'name'
                  ? lang === 'bn'
                    ? 'নাম'
                    : 'Name'
                  : lang === 'bn'
                    ? 'পণ্য'
                    : 'Products'}
            </a>
          ))}
        </div>

        {!reorderable && (
          <span className="cat-filter-note">
            {lang === 'bn'
              ? 'ফিল্টার বা অন্য ক্রমে থাকায় ক্রম বদলানো বন্ধ।'
              : 'Reorder is off while a filter or a different sort is active — it needs the full list in stored order.'}
          </span>
        )}
      </form>

      <div className="card cat-table-card">
        <div className="cat-table-head">
          <span className="cat-count">
            {lang === 'bn'
              ? `${num(items.length, lang)}টি দেখানো হচ্ছে · ${num(total, lang)}টি মোট`
              : `Showing ${num(items.length, lang)} of ${num(total, lang)}`}
          </span>
          {notice && <span className="rev-notice">{notice}</span>}
        </div>

        {items.length === 0 ? (
          <div className="cat-empty">
            <Tag size={28} className="cat-empty-icon" aria-hidden />
            <p className="cat-empty-title">
              {filtered
                ? lang === 'bn'
                  ? 'এই ফিল্টারে কিছু নেই'
                  : 'Nothing matches this filter'
                : lang === 'bn'
                  ? 'এখনো কোনো ব্র্যান্ড নেই'
                  : 'No brands yet'}
            </p>
            <p className="cat-empty-body">
              {filtered
                ? lang === 'bn'
                  ? 'সার্চ বা সক্রিয় ফিল্টার মুছে আবার দেখুন।'
                  : 'Clear the search or the active filter to see every brand.'
                : lang === 'bn'
                  ? 'ব্র্যান্ড যোগ করলে সেগুলো এখানে দেখা যাবে।'
                  : 'Once brands exist they appear here.'}
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="cat-table">
              <thead>
                <tr>
                  <th className="cat-col-name">{lang === 'bn' ? 'ব্র্যান্ড' : 'Brand'}</th>
                  <th className="brd-col-own">{lang === 'bn' ? 'নিজস্ব' : 'Own brand'}</th>
                  <th className="brd-col-count">{lang === 'bn' ? 'পণ্য' : 'Products'}</th>
                  <th className="brd-col-active">{lang === 'bn' ? 'সক্রিয়' : 'Active'}</th>
                  <th className="brd-col-order">{lang === 'bn' ? 'ক্রম' : 'Order'}</th>
                  <th className="brd-col-order" aria-label={lang === 'bn' ? 'অ্যাকশন' : 'Actions'} />
                </tr>
              </thead>
              <tbody>
                {items.map((row, index) => {
                  const isFirst = index === 0;
                  const isLast = index === items.length - 1;
                  const tagline = taglineOf(row, lang);

                  return (
                    <tr key={row.id}>
                      <td className="cat-col-name">
                        <span className="brd-name">
                          <span className="brd-logo" aria-hidden>
                            {row.logo ? (
                              // A logo URL that 404s would leave an empty tile, so
                              // the initials sit behind it as the fallback.
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={row.logo} alt="" loading="lazy" />
                            ) : (
                              initials(row)
                            )}
                          </span>
                          <span className="cat-label">
                            <b>{nameOf(row, lang)}</b>
                            {tagline && <span className="brd-tagline">{tagline}</span>}
                          </span>
                        </span>
                      </td>

                      <td className="brd-col-own" data-label={lang === 'bn' ? 'নিজস্ব' : 'Own brand'}>
                        <span className={row.isOwnBrand ? 'brd-own' : 'brd-own no'}>
                          {row.isOwnBrand
                            ? lang === 'bn'
                              ? 'নিজস্ব'
                              : 'Own brand'
                            : lang === 'bn'
                              ? '—'
                              : '—'}
                        </span>
                      </td>

                      <td className="brd-col-count" data-label={lang === 'bn' ? 'পণ্য' : 'Products'}>
                        <span className={row.productCount === 0 ? 'cat-num zero' : 'cat-num'}>
                          {num(row.productCount, lang)}
                        </span>
                      </td>

                      <td className="brd-col-active" data-label={lang === 'bn' ? 'সক্রিয়' : 'Active'}>
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

                      <td className="brd-col-order" data-label={lang === 'bn' ? 'ক্রম' : 'Order'}>
                        <span className="cat-order">
                          <button
                            type="button"
                            onClick={() => void move(row, -1)}
                            disabled={!canWrite || !reorderable || isFirst || busyId === row.id}
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
                            onClick={() => void move(row, 1)}
                            disabled={!canWrite || !reorderable || isLast || busyId === row.id}
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

                      <td className="brd-col-order" data-label="">
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
