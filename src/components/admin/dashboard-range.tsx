'use client';

/**
 * The dashboard range selector.
 *
 * A segmented control (Today / 7 days / 30 days / Custom) that writes the range
 * into the URL. The URL is the state — not component state — because the
 * dashboard is a server component that re-fetches on navigation. Keeping the
 * range in the query string means a refresh, a shared link and the back button
 * all land on the same view.
 *
 * The custom range opens a Saturday-start calendar, per AGENTS.md landmine #8:
 * the Bangladesh working week starts Saturday, and the reference's `WD` array
 * begins there. A Monday-start picker would be wrong for this market.
 */

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CalendarDays } from 'lucide-react';

/** Saturday-first weekday labels — the reference's `WD` (admin panel.html:718). */
const WEEKDAYS = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

const PRESETS = [
  { key: 'today', labelEn: 'Today', labelBn: 'আজ' },
  { key: '7d', labelEn: '7 days', labelBn: '৭ দিন' },
  { key: '30d', labelEn: '30 days', labelBn: '৩০ দিন' },
] as const;

/** ISO date (YYYY-MM-DD) from a Date, in local time — not UTC. */
function isoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** The Saturday on or before a date — the start of its week. */
function startOfWeekSaturday(date: Date): Date {
  const start = new Date(date);
  // getDay(): 0=Sun … 6=Sat. Saturday is 6, so the offset back to Saturday is
  // (getDay() + 1) % 7.
  const offset = (start.getDay() + 1) % 7;
  start.setDate(start.getDate() - offset);
  start.setHours(0, 0, 0, 0);
  return start;
}

/** Every day in a month grid, padded to whole Saturday-start weeks. */
function monthGrid(year: number, month: number): Array<Date | null> {
  const first = new Date(year, month, 1);
  const gridStart = startOfWeekSaturday(first);
  const last = new Date(year, month + 1, 0);

  const cells: Array<Date | null> = [];
  const cursor = new Date(gridStart);

  // Pad to whole weeks until we have passed the last day of the month.
  while (cursor <= last || cells.length % 7 !== 0) {
    cells.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
    if (cells.length > 42) break;
  }

  return cells;
}

export function DashboardRange({ current, lang }: { current: string; lang: 'en' | 'bn' }) {
  const router = useRouter();
  const params = useSearchParams();

  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState<string>(params.get('from') ?? '');
  const [to, setTo] = useState<string>(params.get('to') ?? '');
  const [viewMonth, setViewMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  function apply(preset: string, fromValue?: string, toValue?: string) {
    const query = new URLSearchParams();
    query.set('range', preset);
    if (preset === 'custom') {
      if (fromValue) query.set('from', fromValue);
      if (toValue) query.set('to', toValue);
    }
    router.push(`/admin?${query.toString()}`);
  }

  function pickDay(day: Date) {
    const value = isoDate(day);
    // First click sets the start, second sets the end. A third starts over.
    if (!from || (from && to)) {
      setFrom(value);
      setTo('');
      return;
    }
    if (value < from) {
      setFrom(value);
      setTo(from);
    } else {
      setTo(value);
    }
  }

  const cells = monthGrid(viewMonth.year, viewMonth.month);
  const monthLabel = new Date(viewMonth.year, viewMonth.month, 1).toLocaleDateString(
    lang === 'bn' ? 'bn-BD' : 'en-GB',
    { month: 'long', year: 'numeric' },
  );

  return (
    <>
      <div className="seg" role="group" aria-label={lang === 'bn' ? 'সময়সীমা' : 'Date range'}>
        {PRESETS.map((preset) => (
          <button
            key={preset.key}
            className={current === preset.key ? 'on' : undefined}
            onClick={() => apply(preset.key)}
            aria-pressed={current === preset.key}
          >
            {lang === 'bn' ? preset.labelBn : preset.labelEn}
          </button>
        ))}
        <button
          className={current === 'custom' ? 'on' : undefined}
          onClick={() => setOpen((value) => !value)}
          aria-pressed={current === 'custom'}
          aria-expanded={open}
        >
          <CalendarDays size={14} aria-hidden style={{ marginRight: 6, verticalAlign: -2 }} />
          {lang === 'bn' ? 'কাস্টম' : 'Custom'}
        </button>
      </div>

      {open && (
        <div className="card" style={{ position: 'absolute', zIndex: 55, marginTop: 52, width: 320 }}>
          <div className="card-head">
            <button
              className="btn ghost sm"
              onClick={() =>
                setViewMonth(({ year, month }) =>
                  month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 },
                )
              }
              aria-label={lang === 'bn' ? 'আগের মাস' : 'Previous month'}
            >
              ‹
            </button>
            <b style={{ fontSize: 14 }}>{monthLabel}</b>
            <button
              className="btn ghost sm"
              onClick={() =>
                setViewMonth(({ year, month }) =>
                  month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 },
                )
              }
              aria-label={lang === 'bn' ? 'পরের মাস' : 'Next month'}
            >
              ›
            </button>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              gap: 4,
              fontSize: 11,
              color: 'var(--faint)',
              textAlign: 'center',
              marginBottom: 6,
            }}
          >
            {WEEKDAYS.map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {cells.map((day, index) => {
              if (!day) return <span key={`pad-${index}`} />;
              const value = isoDate(day);
              const inMonth = day.getMonth() === viewMonth.month;
              const selected = value === from || value === to;
              const inRange = from && to && value > from && value < to;

              return (
                <button
                  key={value}
                  onClick={() => pickDay(day)}
                  style={{
                    height: 34,
                    borderRadius: 8,
                    fontSize: 12.5,
                    fontWeight: selected ? 700 : 500,
                    color: selected
                      ? '#fff'
                      : inRange
                        ? 'var(--brand)'
                        : inMonth
                          ? 'var(--text)'
                          : 'var(--faint)',
                    background: selected
                      ? 'var(--brand)'
                      : inRange
                        ? 'var(--brand-50)'
                        : 'transparent',
                  }}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>

          <div className="row" style={{ marginTop: 14, justifyContent: 'space-between' }}>
            <small style={{ color: 'var(--muted)' }}>
              {from || (lang === 'bn' ? 'শুরু নির্বাচন করুন' : 'Pick a start')}
              {to ? ` → ${to}` : ''}
            </small>
            <button
              className="btn sm"
              disabled={!from || !to}
              onClick={() => {
                apply('custom', from, to);
                setOpen(false);
              }}
            >
              {lang === 'bn' ? 'প্রয়োগ করুন' : 'Apply'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
