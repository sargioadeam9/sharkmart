'use client';

/**
 * The sales bar chart.
 *
 * Hand-rolled bars rather than a charting library: the reference draws plain
 * divs with a height, and adding a dependency to reproduce that would be a
 * hundred kilobytes for a gradient. The bars animate with `transform: scaleY`
 * from the stylesheet, so `prefers-reduced-motion` disables them for free.
 *
 * The tallest bar is highlighted crimson (one accent per view); the rest stay
 * quiet grey, matching the reference's `.bar.top` rule.
 *
 * Accessibility: the chart is decorative as a picture but the numbers matter, so
 * each bar carries an accessible label and a `<title>`-style tooltip via
 * `data-tip`. A screen reader gets the same figures from the label.
 */

import { formatMoneyAdmin } from '@/lib/format';

interface SeriesPoint {
  date: string;
  orders: number;
  revenuePoisha: number;
}

export function SalesChart({ series, lang }: { series: SeriesPoint[]; lang: 'en' | 'bn' }) {
  if (series.length === 0) {
    return (
      <p className="empty">
        {lang === 'bn' ? 'এই সময়ে কোনো অর্ডার নেই।' : 'No orders in this range.'}
      </p>
    );
  }

  const max = Math.max(...series.map((point) => point.orders), 1);
  const peakIndex = series.reduce(
    (best, point, index) => (point.orders > series[best]!.orders ? index : best),
    0,
  );

  return (
    <div className="chart" role="img" aria-label={lang === 'bn' ? 'দৈনিক অর্ডার' : 'Daily orders'}>
      {series.map((point, index) => {
        // A zero-order day still gets a hairline bar, so the axis reads as a
        // continuous series rather than a gap.
        const height = point.orders === 0 ? 2 : Math.max(6, Math.round((point.orders / max) * 100));
        const dayLabel = new Date(`${point.date}T00:00:00`).toLocaleDateString(
          lang === 'bn' ? 'bn-BD' : 'en-GB',
          { day: '2-digit', month: 'short' },
        );

        return (
          <div key={point.date} className="bar-col">
            <div
              className={index === peakIndex && point.orders > 0 ? 'bar top' : 'bar'}
              style={{ height: `${height}%`, animationDelay: `${index * 40}ms` }}
              data-tip={`${dayLabel} · ${point.orders} · ${formatMoneyAdmin(point.revenuePoisha)}`}
              aria-label={`${dayLabel}: ${point.orders} ${lang === 'bn' ? 'অর্ডার' : 'orders'}, ${formatMoneyAdmin(point.revenuePoisha)}`}
            />
            <span>{dayLabel}</span>
          </div>
        );
      })}
    </div>
  );
}
