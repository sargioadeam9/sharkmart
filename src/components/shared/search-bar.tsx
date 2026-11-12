'use client';

/**
 * SearchBar + suggestions — the reference's `.search` / `.sug`
 * (oshoppingbd.html L50-62, markup L634).
 *
 * Behaviour:
 *   - Typing is debounced (220ms) before a request fires, so a fast typist does
 *     not run a query per keystroke.
 *   - Suggestions are a combobox: ArrowDown/ArrowUp move, Enter selects,
 *     Escape closes, and the active option is announced via
 *     `aria-activedescendant`.
 *   - Clicking outside closes the dropdown.
 *   - Submitting goes to `/search?q=…` — the real route, not the reference's
 *     hash router (AGENTS.md landmine #10).
 *
 * Source of suggestions: the real API, through `searchProducts`.
 *
 * This used to filter the local mock catalog, which was correct in Phase 1 when
 * there was no endpoint and wrong the moment `USE_MOCK` went false — the header
 * would suggest products the live catalog might not contain, and clicking one
 * landed on a 404. The server's bilingual `contains` is the only source that
 * agrees with what `/search` will actually return.
 *
 * Categories still come from props: they are the fourteen fixed reference
 * records, not catalog data, so filtering them locally costs nothing and keeps
 * the dropdown useful before the first request lands.
 *
 * Failure policy: a failed or aborted request leaves the box fully usable. It
 * clears the list and does not throw — a suggestion dropdown is an enhancement,
 * and an API blip must not break typing or submitting.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { localized, type ProductDto, type CategoryDto } from '@/types/catalog';
import { cn } from '@/lib/utils';
import { useDebounced, useLang } from '@/lib/hooks';
import { searchProducts } from '@/lib/api/products';

export interface SearchBarProps {
  /**
   * @deprecated Suggestions come from the API now. Kept so existing callers do
   * not break; the value is ignored.
   */
  products?: ProductDto[];
  /** Categories to suggest from — fixed reference records, filtered locally. */
  categories?: CategoryDto[];
  /** Initial value, e.g. from `?q=` on the results page. */
  defaultValue?: string;
  /** Compact styling for the mobile header. */
  size?: 'md' | 'sm';
  className?: string;
  autoFocus?: boolean;
}

interface Suggestion {
  kind: 'product' | 'category';
  id: string;
  label: string;
  href: string;
  meta: string;
  emoji: string;
  tint: string;
}

const MAX_SUGGESTIONS = 7;
/** Below this many characters a query matches almost everything, so it waits. */
const MIN_TERM = 2;
/** 220ms: long enough to skip intermediate keystrokes, short enough to feel live. */
const DEBOUNCE_MS = 220;

export function SearchBar({
  categories = [],
  defaultValue = '',
  size = 'md',
  className,
  autoFocus = false,
}: SearchBarProps) {
  const router = useRouter();
  const { lang, t, tu } = useLang();

  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [productHits, setProductHits] = useState<Suggestion[]>([]);

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const term = value.trim().toLowerCase();
  const debounced = useDebounced(term, DEBOUNCE_MS);

  /**
   * Fetch suggestions for the debounced term.
   *
   * The previous request is aborted on every new term, so a slow response for
   * "pa" cannot land after the response for "panjabi" and repaint the list with
   * the wrong products. The `cancelled` flag covers the same race for a request
   * that resolved before the abort was observed.
   */
  useEffect(() => {
    if (debounced.length < MIN_TERM) {
      setProductHits([]);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    searchProducts(debounced, { limit: MAX_SUGGESTIONS, signal: controller.signal })
      .then((response) => {
        if (cancelled) return;

        setProductHits(
          response.data.map((p) => ({
            kind: 'product' as const,
            id: p.id,
            label: localized(lang, p.nameEn, p.nameBn),
            href: `/product/${p.slug}`,
            meta: p.sku,
            emoji: '🛍️',
            tint: '#F4E9DD',
          })),
        );
      })
      .catch(() => {
        // Aborted by a newer keystroke, or the API failed. Either way the box
        // stays usable: clear the list, keep the typed value, allow submitting.
        if (cancelled || controller.signal.aborted) return;
        setProductHits([]);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [debounced, lang]);

  /**
   * Category hits are local and cheap, so they are derived during render rather
   * than fetched. They lead the list because a category is the broader answer.
   */
  const catHits: Suggestion[] =
    debounced.length < MIN_TERM
      ? []
      : categories
          .filter((c) => {
            const en = c.nameEn.toLowerCase();
            const bn = c.nameBn.toLowerCase();
            return en.includes(debounced) || bn.includes(debounced);
          })
          .slice(0, 3)
          .map((c) => ({
            kind: 'category' as const,
            id: c.id,
            label: localized(lang, c.nameEn, c.nameBn),
            href: `/category/${c.slug}`,
            meta: `${c.productCount}`,
            emoji: c.iconEmoji,
            tint: c.lightTintColor,
          }));

  const suggestions: Suggestion[] = [
    ...catHits,
    ...productHits.slice(0, Math.max(0, MAX_SUGGESTIONS - catHits.length)),
  ];

  const showList = open && suggestions.length > 0;

  // Close on outside click.
  useEffect(() => {
    if (!open) return;

    const handler = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  /**
   * Reset the highlight when the result set changes — during render, so the
   * list never paints with a stale highlight pointing at a different row.
   *
   * Keyed on the suggestion ids rather than the term: the list can change under
   * the same term (a late response, a language switch), and the highlight must
   * follow the rows, not the string.
   */
  const signature = suggestions.map((s) => `${s.kind}-${s.id}`).join('|');
  const [lastSignature, setLastSignature] = useState(signature);
  if (signature !== lastSignature) {
    setLastSignature(signature);
    setActiveIndex(-1);
  }

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      setActiveIndex(-1);
      router.push(href);
    },
    [router],
  );

  const submit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      const q = value.trim();
      if (!q) return;

      if (activeIndex >= 0) {
        const target = suggestions[activeIndex];
        if (target) {
          go(target.href);
          return;
        }
      }

      go(`/search?q=${encodeURIComponent(q)}`);
    },
    [value, activeIndex, suggestions, go],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape') {
        setOpen(false);
        setActiveIndex(-1);
        return;
      }

      if (!showList) return;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((i) => (i + 1) % suggestions.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
      }
    },
    [showList, suggestions.length],
  );

  const activeOptionId =
    activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined;

  return (
    <div ref={rootRef} className={cn('search', className)}>
      <form role="search" onSubmit={submit}>
        <input
          ref={inputRef}
          type="search"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={t('search')}
          aria-label={t('search')}
          autoComplete="off"
          autoFocus={autoFocus}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeOptionId}
          className={size === 'sm' ? 'text-[13.5px] py-[10px]' : undefined}
        />
        <button className="go" type="submit" aria-label={t('srch')}>
          {size === 'sm' ? (
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              aria-hidden="true"
              style={{
                stroke: '#fff',
                fill: 'none',
                strokeWidth: 2.2,
                strokeLinecap: 'round',
              }}
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
          ) : (
            t('srch')
          )}
        </button>
      </form>

      <div className={cn('sug', showList && 'open')} id={listId} role="listbox">
        {showList && (
          <>
            <h6>{tu('suggestions')}</h6>
            {suggestions.map((s, i) => (
              <button
                key={`${s.kind}-${s.id}`}
                type="button"
                id={`${listId}-opt-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                className={cn('sug-row', i === activeIndex && 'bg-shop-pink')}
                onClick={() => go(s.href)}
                onMouseEnter={() => setActiveIndex(i)}
              >
                <span className="th" style={{ background: s.tint }} aria-hidden="true">
                  {s.emoji}
                </span>
                <span className="truncate">{s.label}</span>
                <small>{s.meta}</small>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
