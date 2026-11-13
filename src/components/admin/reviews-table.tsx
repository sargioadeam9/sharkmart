'use client';

/**
 * The reviews screen's client island — tabs, table, moderation drawer, bulk bar.
 *
 * ── What it does NOT do ─────────────────────────────────────────────────────
 *
 * It does not derive a review's state. `state` arrives from the server, because
 * "pending" and "rejected" differ only by `moderatedAt` and a second copy of
 * that rule in the browser would drift from the one the counts endpoint uses.
 *
 * It does not count. Every tab badge comes from `/counts`, which is one groupBy
 * over the whole table. A client-side tally over one page of twenty would report
 * "3 pending" for a queue of forty.
 *
 * ── Class names ─────────────────────────────────────────────────────────────
 *
 * Everything new is prefixed `rev-`. The storefront's home.css has unscoped
 * `.card`, `.badge` and `.grid` rules and Pass A lost time to exactly that
 * collision (AGENTS.md landmine 17). The admin stylesheet scopes under
 * `.admin-root`; the prefix is a second lock on the same door.
 *
 * ── The rating decision, visible ────────────────────────────────────────────
 *
 * The drawer shows the product's stored `ratingAvg`/`reviewCount` next to the
 * real `approvedReviewCount`, and says in one line that they do not agree. That
 * is the honest presentation of option A: the moderator can see that approving
 * this review will not move the stars, rather than discovering it later and
 * filing a bug.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Flag, Star, Trash2, X } from 'lucide-react';

import {
  approveReview,
  bulkModerate,
  deleteReview,
  getReview,
  rejectReview,
  toggleReviewFlag,
  type ReviewDetail,
  type ReviewListItem,
  type ReviewRowState,
  type ReviewState,
} from '@/lib/api/admin-reviews';
import { AdminApiError } from '@/lib/api/admin-client';

type Lang = 'en' | 'bn';

const STATE_TONE: Record<ReviewRowState, string> = {
  pending: 'warn',
  approved: 'ok',
  rejected: 'bad',
  flagged: 'info',
};

const STATE_LABEL: Record<ReviewRowState, { en: string; bn: string }> = {
  pending: { en: 'Pending', bn: 'অপেক্ষমাণ' },
  approved: { en: 'Approved', bn: 'অনুমোদিত' },
  rejected: { en: 'Rejected', bn: 'প্রত্যাখ্যাত' },
  flagged: { en: 'Flagged', bn: 'চিহ্নিত' },
};

const TAB_LABEL: Record<ReviewState, { en: string; bn: string }> = {
  pending: { en: 'Pending', bn: 'অপেক্ষমাণ' },
  approved: { en: 'Approved', bn: 'অনুমোদিত' },
  rejected: { en: 'Rejected', bn: 'প্রত্যাখ্যাত' },
  flagged: { en: 'Flagged', bn: 'চিহ্নিত' },
  all: { en: 'All', bn: 'সব' },
};

function stateLabel(state: ReviewRowState, lang: Lang): string {
  return STATE_LABEL[state]?.[lang] ?? state;
}

/** Admin surface uses lakh grouping (AGENTS.md §3). */
function num(value: number, lang: Lang): string {
  return value.toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-IN');
}

function formatDate(iso: string, lang: Lang): string {
  const date = new Date(iso);
  return date.toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Stars are a visual second channel; the number is always shown beside them.
 *
 * AGENTS.md §3 / rule 6: a rating conveyed only by filled glyphs is invisible to
 * a screen reader and ambiguous at a glance. The `<span>` carries the value and
 * the glyphs are `aria-hidden`.
 */
function Stars({ rating, lang }: { rating: number; lang: Lang }) {
  return (
    <span className="rev-stars" title={`${rating} / 5`}>
      <span aria-hidden>
        {[1, 2, 3, 4, 5].map((n) => (
          <Star key={n} size={13} className={n <= rating ? 'rev-star on' : 'rev-star'} />
        ))}
      </span>
      <b className="rev-rating-num">{num(rating, lang)}</b>
    </span>
  );
}

// ─── Tabs ───────────────────────────────────────────────────────────────────

interface TabProps {
  lang: Lang;
  active: ReviewState;
  counts: Record<ReviewState, number>;
  /**
   * Precomputed hrefs, not a callback.
   *
   * A server component cannot pass a function to a client component — React
   * refuses it unless it is a server action, and the page dies with "Functions
   * cannot be passed directly to Client Components". The page builds the five
   * URLs and hands them over as data, which is also cheaper: the client never
   * needs to know how a URL is composed.
   */
  hrefs: Record<ReviewState, string>;
}

export function ReviewTabs({ lang, active, counts, hrefs }: TabProps) {
  const tabs: ReviewState[] = ['pending', 'approved', 'rejected', 'flagged', 'all'];

  return (
    <div className="rev-tabs" role="tablist" aria-label={lang === 'bn' ? 'পর্যালোচনা ফিল্টার' : 'Review filters'}>
      {tabs.map((tab) => (
        <a
          key={tab}
          href={hrefs[tab]}
          role="tab"
          aria-selected={active === tab}
          className={active === tab ? 'rev-tab on' : 'rev-tab'}
        >
          {TAB_LABEL[tab][lang]}
          <span className="rev-tab-count">{num(counts[tab] ?? 0, lang)}</span>
        </a>
      ))}
    </div>
  );
}

// ─── Table ──────────────────────────────────────────────────────────────────

interface TableProps {
  lang: Lang;
  items: ReviewListItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  prevHref: string | null;
  nextHref: string | null;
  canModerate: boolean;
  activeState: ReviewState;
}

export function ReviewsTable({
  lang,
  items,
  total,
  page,
  limit,
  totalPages,
  prevHref,
  nextHref,
  canModerate,
  activeState,
}: TableProps) {
  const router = useRouter();
  const [drawerFor, setDrawerFor] = useState<ReviewListItem | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const first = total === 0 ? 0 : (page - 1) * limit + 1;
  const last = Math.min(page * limit, total);

  const allSelected = items.length > 0 && items.every((item) => selected.has(item.id));

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      if (items.every((item) => prev.has(item.id))) return new Set();
      return new Set(items.map((item) => item.id));
    });
  }, [items]);

  const runBulk = useCallback(
    async (action: 'approve' | 'reject' | 'flag') => {
      if (selected.size === 0) return;
      setBusy(true);
      setNotice(null);
      try {
        const result = await bulkModerate([...selected], action);
        /**
         * The skipped list is surfaced, never swallowed. A bulk action that
         * silently updates 4 of 5 rows is worse than one that fails loudly.
         */
        const skippedText =
          result.skipped.length > 0
            ? lang === 'bn'
              ? ` — ${result.skipped.length}টি বাদ (${result.skipped[0]!.reason})`
              : ` — ${result.skipped.length} skipped (${result.skipped[0]!.reason})`
            : '';
        setNotice(
          lang === 'bn'
            ? `${result.updated.length}টি আপডেট হয়েছে${skippedText}`
            : `${result.updated.length} updated${skippedText}`,
        );
        setSelected(new Set());
        router.refresh();
      } catch (caught) {
        setNotice(
          caught instanceof AdminApiError
            ? caught.message
            : lang === 'bn'
              ? 'আপডেট করা যায়নি।'
              : 'Could not update.',
        );
      } finally {
        setBusy(false);
      }
    },
    [selected, lang, router],
  );

  return (
    <>
      <div className="card rev-table-card">
        <div className="rev-table-head">
          <span className="rev-count">
            {lang === 'bn' ? `${first}–${last} / ${num(total, lang)}` : `${first}–${last} of ${num(total, lang)}`}
          </span>
          {notice && <span className="rev-notice">{notice}</span>}
        </div>

        {items.length === 0 ? (
          /**
           * The empty state is the first thing anyone sees, because the seed
           * creates no reviews. It has to read as "nothing to do", not as a
           * broken screen — hence a sentence per tab rather than one generic
           * "no data".
           */
          <div className="rev-empty">
            <Star size={28} className="rev-empty-icon" aria-hidden />
            <p className="rev-empty-title">
              {activeState === 'pending'
                ? lang === 'bn'
                  ? 'পর্যালোচনার অপেক্ষায় কিছু নেই'
                  : 'No reviews waiting'
                : activeState === 'approved'
                  ? lang === 'bn'
                    ? 'এখনো কোনো পর্যালোচনা অনুমোদিত হয়নি'
                    : 'No approved reviews yet'
                  : activeState === 'rejected'
                    ? lang === 'bn'
                      ? 'কোনো পর্যালোচনা প্রত্যাখ্যান করা হয়নি'
                      : 'No rejected reviews'
                    : activeState === 'flagged'
                      ? lang === 'bn'
                        ? 'কোনো পর্যালোচনা চিহ্নিত করা হয়নি'
                        : 'No flagged reviews'
                      : lang === 'bn'
                        ? 'এখনো কোনো পর্যালোচনা নেই'
                        : 'No reviews yet'}
            </p>
            <p className="rev-empty-body">
              {lang === 'bn'
                ? 'গ্রাহক পর্যালোচনা লিখলে সেগুলো এখানে অপেক্ষমাণ হিসেবে আসবে।'
                : 'When a customer writes a review it arrives here as pending.'}
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="rev-table">
              <thead>
                <tr>
                  {canModerate && (
                    <th className="rev-col-check">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        aria-label={lang === 'bn' ? 'সব নির্বাচন করুন' : 'Select all on this page'}
                      />
                    </th>
                  )}
                  <th className="rev-col-rating">{lang === 'bn' ? 'রেটিং' : 'Rating'}</th>
                  <th className="rev-col-reviewer">{lang === 'bn' ? 'পর্যালোচক' : 'Reviewer'}</th>
                  <th className="rev-col-product">{lang === 'bn' ? 'পণ্য' : 'Product'}</th>
                  <th className="rev-col-excerpt">{lang === 'bn' ? 'সারাংশ' : 'Excerpt'}</th>
                  <th>{lang === 'bn' ? 'অবস্থা' : 'State'}</th>
                  <th className="rev-col-date">{lang === 'bn' ? 'তারিখ' : 'Date'}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.id}
                    onClick={() => setDrawerFor(item)}
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setDrawerFor(item);
                      }
                    }}
                    aria-label={
                      lang === 'bn'
                        ? `${item.reviewer.name} — পর্যালোচনা দেখুন`
                        : `${item.reviewer.name} — open review`
                    }
                  >
                    {canModerate && (
                      <td className="rev-col-check" data-label="">
                        <input
                          type="checkbox"
                          checked={selected.has(item.id)}
                          onChange={() => toggle(item.id)}
                          onClick={(event) => event.stopPropagation()}
                          aria-label={
                            lang === 'bn'
                              ? `${item.reviewer.name} নির্বাচন করুন`
                              : `Select ${item.reviewer.name}`
                          }
                        />
                      </td>
                    )}
                    <td data-label={lang === 'bn' ? 'রেটিং' : 'Rating'}>
                      <Stars rating={item.rating} lang={lang} />
                    </td>
                    <td data-label={lang === 'bn' ? 'পর্যালোচক' : 'Reviewer'}>
                      <span className="rev-reviewer">
                        <b>{item.reviewer.name}</b>
                        {item.isVerifiedPurchase && (
                          <small className="rev-verified">
                            {lang === 'bn' ? 'যাচাইকৃত ক্রয়' : 'Verified purchase'}
                          </small>
                        )}
                      </span>
                    </td>
                    <td className="rev-col-product" data-label={lang === 'bn' ? 'পণ্য' : 'Product'}>
                      {lang === 'bn' ? item.product.nameBn : item.product.nameEn}
                    </td>
                    <td className="rev-col-excerpt" data-label={lang === 'bn' ? 'সারাংশ' : 'Excerpt'}>
                      <span className="rev-excerpt">
                        {item.titleEn || item.titleBn ? (
                          <b>{lang === 'bn' ? item.titleBn ?? item.titleEn : item.titleEn ?? item.titleBn}</b>
                        ) : null}
                        {item.excerpt}
                      </span>
                      {item.mediaCount > 0 && (
                        <span className="rev-media-count">
                          {lang === 'bn' ? `${item.mediaCount}টি মিডিয়া` : `${item.mediaCount} media`}
                        </span>
                      )}
                    </td>
                    <td data-label={lang === 'bn' ? 'অবস্থা' : 'State'}>
                      <span className={`badge ${STATE_TONE[item.state]}`}>{stateLabel(item.state, lang)}</span>
                    </td>
                    <td className="rev-col-date" data-label={lang === 'bn' ? 'তারিখ' : 'Date'}>
                      {formatDate(item.createdAt, lang)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="rev-pager">
            {prevHref ? (
              <a className="rev-page-btn" href={prevHref}>
                {lang === 'bn' ? 'পূর্ববর্তী' : 'Previous'}
              </a>
            ) : (
              <span className="rev-page-btn off">{lang === 'bn' ? 'পূর্ববর্তী' : 'Previous'}</span>
            )}
            <span className="rev-page-count">
              {lang === 'bn' ? `${page} / ${totalPages}` : `Page ${page} of ${totalPages}`}
            </span>
            {nextHref ? (
              <a className="rev-page-btn" href={nextHref}>
                {lang === 'bn' ? 'পরবর্তী' : 'Next'}
              </a>
            ) : (
              <span className="rev-page-btn off">{lang === 'bn' ? 'পরবর্তী' : 'Next'}</span>
            )}
          </div>
        )}
      </div>

      {canModerate && selected.size > 0 && (
        <div className="rev-bulk-bar" role="region" aria-label={lang === 'bn' ? 'বাল্ক অ্যাকশন' : 'Bulk actions'}>
          <span className="rev-bulk-count">
            {lang === 'bn' ? `${selected.size}টি নির্বাচিত` : `${selected.size} selected`}
          </span>
          <div className="rev-bulk-actions">
            <button type="button" className="btn sm" disabled={busy} onClick={() => runBulk('approve')}>
              {lang === 'bn' ? 'অনুমোদন' : 'Approve'}
            </button>
            <button type="button" className="btn sm ghost" disabled={busy} onClick={() => runBulk('reject')}>
              {lang === 'bn' ? 'প্রত্যাখ্যান' : 'Reject'}
            </button>
            <button type="button" className="btn sm ghost" disabled={busy} onClick={() => runBulk('flag')}>
              {lang === 'bn' ? 'চিহ্নিত' : 'Flag'}
            </button>
            <button
              type="button"
              className="btn sm ghost"
              onClick={() => setSelected(new Set())}
              aria-label={lang === 'bn' ? 'নির্বাচন বাতিল' : 'Clear selection'}
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {drawerFor && (
        <ReviewDrawer
          lang={lang}
          reviewId={drawerFor.id}
          canModerate={canModerate}
          onClose={() => setDrawerFor(null)}
          onChanged={() => router.refresh()}
        />
      )}
    </>
  );
}

// ─── Drawer ─────────────────────────────────────────────────────────────────

interface DrawerProps {
  lang: Lang;
  reviewId: string;
  canModerate: boolean;
  onClose: () => void;
  onChanged: () => void;
}

function ReviewDrawer({ lang, reviewId, canModerate, onClose, onChanged }: DrawerProps) {
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    getReview(reviewId)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof AdminApiError ? caught.message : 'Could not load the review.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reviewId]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const act = useCallback(
    async (fn: () => Promise<unknown>, message: string) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        await fn();
        setNotice(message);
        onChanged();
        // Re-read so the drawer shows the new state without closing.
        const fresh = await getReview(reviewId);
        setDetail(fresh);
      } catch (caught) {
        setError(
          caught instanceof AdminApiError
            ? caught.message
            : lang === 'bn'
              ? 'কাজটি সম্পন্ন হয়নি।'
              : 'That action did not go through.',
        );
      } finally {
        setBusy(false);
      }
    },
    [reviewId, lang, onChanged],
  );

  return (
    <div className="overlay side open" role="presentation" onClick={onClose}>
      <aside
        className="drawer rev-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rev-drawer-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="m-head">
          <h2 id="rev-drawer-title">{lang === 'bn' ? 'পর্যালোচনা' : 'Review'}</h2>
          <button ref={closeRef} type="button" className="x" onClick={onClose} aria-label={lang === 'bn' ? 'বন্ধ করুন' : 'Close'}>
            <X size={18} aria-hidden />
          </button>
        </div>

        {error && <p className="rev-error">{error}</p>}
        {notice && <p className="rev-notice">{notice}</p>}

        {!detail ? (
          <p className="rev-loading">{lang === 'bn' ? 'লোড হচ্ছে…' : 'Loading…'}</p>
        ) : (
          <div className="rev-drawer-body">
            <div className="rev-detail-top">
              <Stars rating={detail.rating} lang={lang} />
              <span className={`badge ${STATE_TONE[detail.state]}`}>{stateLabel(detail.state, lang)}</span>
              {detail.isVerifiedPurchase && (
                <span className="badge ok">{lang === 'bn' ? 'যাচাইকৃত' : 'Verified'}</span>
              )}
            </div>

            {(detail.titleEn || detail.titleBn) && (
              <h3 className="rev-detail-title">
                {lang === 'bn' ? detail.titleBn ?? detail.titleEn : detail.titleEn ?? detail.titleBn}
              </h3>
            )}

            <p className="rev-detail-body">
              {lang === 'bn' ? detail.contentBn ?? detail.contentEn : detail.contentEn ?? detail.contentBn}
            </p>

            <dl className="rev-meta">
              <div>
                <dt>{lang === 'bn' ? 'পর্যালোচক' : 'Reviewer'}</dt>
                <dd>{detail.reviewer.name}</dd>
              </div>
              <div>
                <dt>{lang === 'bn' ? 'পণ্য' : 'Product'}</dt>
                <dd>{lang === 'bn' ? detail.product.nameBn : detail.product.nameEn}</dd>
              </div>
              <div>
                <dt>{lang === 'bn' ? 'জমা দেওয়া' : 'Submitted'}</dt>
                <dd>{formatDate(detail.createdAt, lang)}</dd>
              </div>
              {detail.moderatedAt && (
                <div>
                  <dt>{lang === 'bn' ? 'পরিমার্জিত' : 'Moderated'}</dt>
                  <dd>
                    {formatDate(detail.moderatedAt, lang)}
                    {detail.moderatedByName ? ` · ${detail.moderatedByName}` : ''}
                  </dd>
                </div>
              )}
            </dl>

            {detail.media.length > 0 && (
              <div className="rev-media">
                <h3>{lang === 'bn' ? 'মিডিয়া' : 'Media'}</h3>
                <ul>
                  {detail.media.map((item) => (
                    <li key={item.id}>
                      {item.type === 'IMAGE' ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.url} alt="" loading="lazy" />
                      ) : (
                        <a href={item.url} target="_blank" rel="noreferrer">
                          {lang === 'bn' ? 'ভিডিও দেখুন' : 'View video'}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/**
             * The rating decision, stated where the moderator is standing.
             *
             * Under option A the stored aggregate is not derived from reviews, so
             * `reviewCount` (stored) and `approvedReviewCount` (real) disagree.
             * Showing both and naming the gap is the honest presentation — the
             * alternative is a moderator approving a review, seeing the stars not
             * move, and filing a bug that is actually a documented decision.
             */}
            <div className="rev-aggregate">
              <h3>{lang === 'bn' ? 'পণ্যের বর্তমান রেটিং' : "Product's current rating"}</h3>
              <p className="rev-aggregate-row">
                <span>
                  {lang === 'bn' ? 'সংরক্ষিত' : 'Stored'}: <b>{detail.product.ratingAvg.toFixed(2)}</b> ·{' '}
                  {num(detail.product.reviewCount, lang)}
                </span>
                <span>
                  {lang === 'bn' ? 'প্রকৃত অনুমোদিত' : 'Actually approved'}:{' '}
                  <b>{num(detail.product.approvedReviewCount, lang)}</b>
                </span>
              </p>
              <p className="rev-aggregate-note">
                {lang === 'bn'
                  ? 'সংরক্ষিত সংখ্যাটি ক্যাটালগ থেকে নেওয়া, পর্যালোচনা থেকে গণনা করা নয়। অনুমোদন করলে তারা বদলাবে না।'
                  : 'The stored figure comes from the catalog, not from reviews. Approving this will not move it.'}
              </p>
            </div>

            {canModerate ? (
              <div className="rev-actions">
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    act(
                      () => approveReview(detail.id),
                      lang === 'bn' ? 'অনুমোদিত হয়েছে' : 'Approved',
                    )
                  }
                >
                  {lang === 'bn' ? 'অনুমোদন' : 'Approve'}
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  disabled={busy}
                  onClick={() =>
                    act(
                      () => rejectReview(detail.id),
                      lang === 'bn' ? 'প্রত্যাখ্যাত হয়েছে' : 'Rejected',
                    )
                  }
                >
                  {lang === 'bn' ? 'প্রত্যাখ্যান' : 'Reject'}
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  disabled={busy}
                  onClick={() =>
                    act(
                      () => toggleReviewFlag(detail.id),
                      detail.isFlagged
                        ? lang === 'bn'
                          ? 'চিহ্ন সরানো হয়েছে'
                          : 'Flag removed'
                        : lang === 'bn'
                          ? 'চিহ্নিত হয়েছে'
                          : 'Flagged',
                    )
                  }
                >
                  <Flag size={14} /> {detail.isFlagged ? (lang === 'bn' ? 'চিহ্ন সরান' : 'Unflag') : lang === 'bn' ? 'চিহ্নিত' : 'Flag'}
                </button>
                <button
                  type="button"
                  className="btn ghost rev-danger"
                  disabled={busy}
                  onClick={() => {
                    if (
                      !window.confirm(
                        lang === 'bn'
                          ? 'এই পর্যালোচনাটি স্থায়ীভাবে মুছে যাবে। নিশ্চিত?'
                          : 'This review will be permanently deleted. Continue?',
                      )
                    ) {
                      return;
                    }
                    act(
                      async () => {
                        await deleteReview(detail.id);
                        onClose();
                      },
                      lang === 'bn' ? 'মুছে ফেলা হয়েছে' : 'Deleted',
                    );
                  }}
                >
                  <Trash2 size={14} /> {lang === 'bn' ? 'মুছুন' : 'Delete'}
                </button>
              </div>
            ) : (
              <p className="rev-readonly">
                {lang === 'bn'
                  ? 'আপনি পর্যালোচনা দেখতে পারেন, কিন্তু অনুমোদন বা প্রত্যাখ্যান করতে পারবেন না।'
                  : 'You can read reviews but not moderate them.'}
              </p>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
