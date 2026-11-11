'use client';

/**
 * SearchBar + suggestions — the reference's `.search` / `.sug`
 * (oshoppingbd.html L50-62, markup L634).
 *
 * Behaviour:
 *   - Typing is debounced (250ms) before suggestions are computed, so a fast
 *     typist does not run a filter per keystroke.
 *   - Suggestions are a combobox: ArrowDown/ArrowUp move, Enter selects,
 *     Escape closes, and the active option is announced via
 *     `aria-activedescendant`.
 *   - Clicking outside closes the dropdown.
 *   - Submitting goes to `/search?q=…` — the real route, not the reference's
 *     hash router (AGENTS.md landmine #10).
 *
 * Phase 1 has no search endpoint, so the suggestions come from the local mock
 * catalog. Phase 6 swaps `suggest()` for the API call; the component does not
 * change.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { localized, type ProductDto, type CategoryDto } from '@/types/catalog';
import { cn } from '@/lib/utils';
import { useDebounced, useLang } from '@/lib/hooks';

export interface SearchBarProps {
  /** Products to suggest from. */
  products?: ProductDto[];
  /** Categories to suggest from. */
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

export function SearchBar({
  products = [],
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

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const debounced = useDebounced(value.trim().toLowerCase(), 250);

  const suggestions = useMemo<Suggestion[]>(() => {
    if (debounced.length < 2) return [];

    const catHits: Suggestion[] = categories
      .filter((c) => {
        const en = c.nameEn.toLowerCase();
        const bn = c.nameBn.toLowerCase();
        return en.includes(debounced) || bn.includes(debounced);
      })
      .slice(0, 3)
      .map((c) => ({
        kind: 'category',
        id: c.id,
        label: localized(lang, c.nameEn, c.nameBn),
        href: `/category/${c.slug}`,
        meta: `${c.productCount}`,
        emoji: c.iconEmoji,
        tint: c.lightTintColor,
      }));

    const prodHits: Suggestion[] = products
      .filter((p) => {
        const hay = [
          p.nameEn,
          p.nameBn,
          p.sku,
          p.brand?.nameEn ?? '',
          p.brand?.nameBn ?? '',
        ]
          .join(' ')
          .toLowerCase();
        return hay.includes(debounced);
      })
      .slice(0, MAX_SUGGESTIONS - catHits.length)
      .map((p) => ({
        kind: 'product',
        id: p.id,
        label: localized(lang, p.nameEn, p.nameBn),
        href: `/product/${p.slug}`,
        meta: p.sku,
        emoji: '🛍️',
        tint: '#F4E9DD',
      }));

    return [...catHits, ...prodHits];
  }, [debounced, categories, products, lang]);

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

  // Reset the highlight when the result set changes — during render, so the
  // list never paints with a stale highlight pointing at a different row.
  const [lastDebounced, setLastDebounced] = useState(debounced);
  if (debounced !== lastDebounced) {
    setLastDebounced(debounced);
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
