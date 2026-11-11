'use client';

/**
 * FlashCountdown — the reference's `.cd` (oshoppingbd.html L169-174, markup
 * L648, ticker L812).
 *
 * The reference runs one global `setInterval` that rewrites the text of every
 * `[data-cd]` element once a second. That is a whole-document query every tick
 * and it cannot be cancelled cleanly.
 *
 * Here: one interval, scoped to this component, writing four state values.
 * React re-renders four text nodes — not the page. The gate requires exactly
 * that ("countdown is real-time and does not drift or re-render the page").
 *
 * Details that matter:
 *   - The target is a fixed timestamp passed in, not `Date.now() + offset`
 *     recomputed on render, so a re-render does not restart the clock.
 *   - Remaining time is computed from the absolute target each tick, so the
 *     display cannot drift the way an accumulating counter does.
 *   - It stops at zero instead of going negative, and clears its interval.
 *   - Bangla digits, matching the reference's `nf()`.
 */

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useLang } from '@/lib/hooks';
import { localizeNumber } from '@/lib/i18n';

export interface FlashCountdownProps {
  /** ISO timestamp the sale ends at. */
  endsAt: string;
}

interface Remaining {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  done: boolean;
}

function split(msRemaining: number): Remaining {
  const total = Math.max(0, Math.floor(msRemaining / 1000));

  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
    done: total === 0,
  };
}

export function FlashCountdown({ endsAt }: FlashCountdownProps) {
  const { lang, t } = useLang();

  const target = useMemo(() => new Date(endsAt).getTime(), [endsAt]);

  const [remaining, setRemaining] = useState<Remaining>(() =>
    split(target - Date.now()),
  );

  useEffect(() => {
    const id = window.setInterval(() => {
      const next = split(target - Date.now());
      setRemaining(next);
      if (next.done) window.clearInterval(id);
    }, 1000);

    return () => window.clearInterval(id);
  }, [target]);

  /** Two digits in English, one glyph in Bangla — the reference's padStart. */
  const pad = (value: number) => {
    const text = String(value);
    return lang === 'bn' ? localizeNumber(text, lang) : text.padStart(2, '0');
  };

  const cells = [
    { key: 'd' as const, value: remaining.days, label: t('d') },
    { key: 'h' as const, value: remaining.hours, label: t('h') },
    { key: 'm' as const, value: remaining.minutes, label: t('m') },
    { key: 's' as const, value: remaining.seconds, label: t('s') },
  ];

  return (
    <div className="cd" aria-live="off">
      {cells.map((cell, index) => (
        <Fragment key={cell.key}>
          <span>
            <b>{pad(cell.value)}</b>
            <small>{cell.label}</small>
          </span>
          {index < cells.length - 1 ? <i aria-hidden="true">:</i> : null}
        </Fragment>
      ))}
    </div>
  );
}
