'use client';

/**
 * StarRating — the reference's `.stars` (oshoppingbd.html L198).
 *
 * The reference draws five glyphs and clips a gradient at `--r: rating/5*100%`,
 * so a 4.5 shows four and a half gold stars with no image assets. Same trick
 * here; the gradient stops come from components.css.
 *
 * Accessibility: the visible glyphs are `aria-hidden`. The accessible value is
 * a single label — "4.5 / 5" — because a screen reader reading "star star star
 * star star" five times is noise, not information.
 */

import { cn, formatRating } from '@/lib/utils';
import { formatNumber } from '@/lib/format';
import type { Lang } from '@/lib/format';

export interface StarRatingProps {
  /** 0–5, one decimal. */
  rating: number;
  /** Renders "(1,284)" after the stars. */
  reviewCount?: number;
  /** Localised count text, e.g. "1,284 ratings". Overrides reviewCount. */
  countLabel?: string;
  /** Locale for the numeric value and count — Bangla gets Bangla digits. */
  lang?: Lang;
  size?: 'sm' | 'md' | 'lg';
  /** Show the numeric value next to the stars. */
  showValue?: boolean;
  className?: string;
}

const SIZE_CLASS = {
  sm: 'text-[11px] tracking-[0.5px]',
  md: '',
  lg: 'text-[18px] tracking-[2px]',
} as const;

export function StarRating({
  rating,
  reviewCount,
  countLabel,
  lang = 'en',
  size = 'md',
  showValue = false,
  className,
}: StarRatingProps) {
  const safe = Math.max(0, Math.min(5, rating));
  const percent = (safe / 5) * 100;
  const label = `${formatRating(safe)} / 5`;

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span
        className={cn('stars', SIZE_CLASS[size])}
        style={{ ['--r' as string]: `${percent}%` }}
        role="img"
        aria-label={label}
      >
        <span aria-hidden="true">★★★★★</span>
      </span>

      {showValue && (
        <span className="text-[12px] font-semibold text-shop-navy">
          {formatNumber(safe, lang)}
        </span>
      )}

      {countLabel ? (
        <span className="text-[12px] text-shop-muted">{countLabel}</span>
      ) : reviewCount !== undefined ? (
        <span className="text-[12px] text-shop-muted">
          ({formatNumber(reviewCount, lang)})
        </span>
      ) : null}
    </span>
  );
}
