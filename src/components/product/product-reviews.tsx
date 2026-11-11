'use client';

/**
 * ProductReviews — the reference's `pRev()` (oshoppingbd.html L769-771).
 *
 * Two behaviours matter and both are client-side only, no refetch:
 *   - Clicking a bar in the 5→1 breakdown filters the list to that star count.
 *     Clicking it again, or the active-filter chip, clears it.
 *   - The sort select reorders the already-loaded list.
 *
 * The reference keeps `PS.rf` (rating filter) and the select value in module
 * globals. Here they are component state, which is the same thing without the
 * leak.
 *
 * Empty state: a product with `reviewCount === 0` renders the "no reviews yet"
 * block and the write-review CTA. The breakdown bars are hidden rather than
 * drawn at 0%, because five empty bars read as "everyone hated it".
 */

import { useMemo, useState } from 'react';

import { useLang } from '@/lib/hooks';
import { formatNumber } from '@/lib/format';
import { localized } from '@/types/catalog';
import { StarRating } from '@/components/ui/star-rating';
import { toast } from '@/components/shared/toast';
import type { ReviewDto } from '@/types/catalog';

type SortKey = 'new' | 'hi' | 'lo';

export interface ProductReviewsProps {
  reviews: ReviewDto[];
  /** Average rating from the DTO. Never recomputed from the sample. */
  rating: number;
  reviewCount: number;
  /** Histogram, index 0 = 5 stars. */
  breakdown: number[];
}

export function ProductReviews({
  reviews,
  rating,
  reviewCount,
  breakdown,
}: ProductReviewsProps) {
  const { lang, t, tu } = useLang();

  const [ratingFilter, setRatingFilter] = useState<number | null>(null);
  const [sort, setSort] = useState<SortKey>('new');

  const visible = useMemo(() => {
    let list = ratingFilter
      ? reviews.filter((review) => review.rating === ratingFilter)
      : [...reviews];

    if (sort === 'hi') list = [...list].sort((a, b) => b.rating - a.rating);
    if (sort === 'lo') list = [...list].sort((a, b) => a.rating - b.rating);
    if (sort === 'new') {
      list = [...list].sort(
        (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
      );
    }

    return list;
  }, [reviews, ratingFilter, sort]);

  const hasReviews = reviewCount > 0 && reviews.length > 0;

  return (
    <section className="sec" id="rv">
      <div className="sh">
        <div>
          <h2>{t('reviews')}</h2>
        </div>
      </div>

      <div className="box" style={{ margin: 0 }}>
        <div className="rv">
          <div className="sum">
            <div className="big">{formatNumber(rating, lang)}</div>
            <StarRating rating={rating} lang={lang} size="lg" />
            <div style={{ color: 'var(--color-shop-muted)', fontSize: 13 }}>
              {t('ratings', { n: reviewCount })}
            </div>

            {hasReviews ? (
              <div className="bars">
                {[5, 4, 3, 2, 1].map((star) => {
                  const percent = breakdown[5 - star] ?? 0;
                  const active = ratingFilter === star;
                  return (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setRatingFilter(active ? null : star)}
                      aria-pressed={active}
                      aria-label={`${star}★ — ${percent}%`}
                      style={active ? { background: 'var(--color-shop-pink)' } : undefined}
                    >
                      <span>{formatNumber(star, lang)}★</span>
                      <b>
                        <i style={{ width: `${percent}%` }} />
                      </b>
                      <span>{formatNumber(percent, lang)}%</span>
                    </button>
                  );
                })}
              </div>
            ) : null}

            <button
              type="button"
              className="btn red"
              style={{ marginTop: 12, width: '100%' }}
              onClick={() => toast(t('write'))}
            >
              {t('write')}
            </button>
          </div>

          <div>
            <div className="tb" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              {ratingFilter ? (
                <button
                  type="button"
                  onClick={() => setRatingFilter(null)}
                  style={{
                    color: 'var(--color-shop-muted)',
                    fontSize: 14,
                    textDecoration: 'underline',
                  }}
                >
                  {formatNumber(ratingFilter, lang)}★ ✕
                </button>
              ) : (
                <span style={{ color: 'var(--color-shop-muted)', fontSize: 14 }}>
                  {t('reviews')}
                </span>
              )}

              <select
                className="sel"
                value={sort}
                onChange={(event) => setSort(event.target.value as SortKey)}
                aria-label={tu('sortProducts')}
                style={{ marginLeft: 'auto' }}
              >
                <option value="new">{t('newest')}</option>
                <option value="hi">{t('hr')}</option>
                <option value="lo">
                  {lang === 'bn' ? 'সর্বনিম্ন রেটিং' : 'Lowest rated'}
                </option>
              </select>
            </div>

            <div className="rl">
              {visible.length === 0 ? (
                <p style={{ color: 'var(--color-shop-muted)' }}>
                  {hasReviews ? t('nores') : tu('reviewsEmpty')}
                </p>
              ) : (
                visible.map((review) => (
                  <article className="rv-c" key={review.id}>
                    <div className="t">
                      <span className="av" aria-hidden="true">
                        {review.authorName.charAt(0)}
                      </span>
                      <b>{review.authorName}</b>
                      {review.isVerifiedPurchase ? (
                        <span className="vb">✔ {t('verified')}</span>
                      ) : null}
                      <span
                        style={{
                          color: 'var(--color-shop-muted)',
                          fontSize: 12.5,
                          marginLeft: 'auto',
                        }}
                      >
                        {formatDate(review.createdAt, lang)}
                      </span>
                    </div>

                    <StarRating rating={review.rating} lang={lang} size="sm" />

                    <p style={{ marginTop: 4, fontSize: 14.5 }}>
                      {localized(lang, review.bodyEn, review.bodyBn)}
                    </p>

                    <div className="ft">
                      <button type="button">
                        👍 {t('helpful')} ({formatNumber(review.helpfulCount, lang)})
                      </button>
                      <button
                        type="button"
                        onClick={() => toast(`${t('report')} ✓`)}
                      >
                        ⚑ {t('report')}
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Dates render in the reference's short form. `Intl.DateTimeFormat` handles the
 * Bangla month names; the reference hardcodes "12 Oct 2026".
 */
function formatDate(iso: string, lang: 'en' | 'bn'): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat(lang === 'bn' ? 'bn-BD' : 'en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}
