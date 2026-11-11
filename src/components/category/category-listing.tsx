'use client';

/**
 * CategoryListing — the reference's `listing()` + `initListing()`
 * (oshoppingbd.html L682-694).
 *
 * What the reference does and this does not:
 *
 *   - It filters a pre-built array in memory and re-renders `#grid` with
 *     `innerHTML`. That throws away scroll position, focus and every card's
 *     internal state on each keystroke.
 *   - It has no URL state, so a filtered view cannot be shared or refreshed.
 *   - Its empty state is a message with no way out.
 *
 * What this does instead:
 *
 *   - Filters live in the URL (`lib/category-filters.ts`), written with
 *     `router.replace(..., { scroll: false })` so a filter change never
 *     navigates, never resets scroll, and back/forward works.
 *   - Text/number input is debounced 250ms; checkboxes and the sort select are
 *     immediate, because a click is already a committed intent.
 *   - The product list is fetched once per category and filtered client-side.
 *     Filtering therefore never refetches the page — the gate requires this.
 *   - The empty state offers two real actions: clear the filters, and jump to
 *     the popular products further up the page.
 *
 * Load More adds 8 per click, matching the reference's `LV.n += 8`, starting
 * from 12 (`LV.n = 12`).
 */

import { useCallback, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import type { BrandDto, ProductDto } from '@/types/catalog';
import { useLang, useDebouncedCallback } from '@/lib/hooks';
import {
  applyClientFilters,
  DEFAULT_FILTERS,
  hasActiveFilters,
  parseFilters,
  toSearchParams,
  type CategoryFilters,
  type SortKey,
} from '@/lib/category-filters';
import { ProductCard } from '@/components/product/product-card';
import { EmptyState } from '@/components/shared/empty-state';
import { MobileSheet } from '@/components/shared/mobile-sheet';
import { SectionHeader } from '@/components/home/section-header';
import { FilterPanel, SortSelect } from './filter-panel';

/** First page size and per-click increment — the reference's 12 and 8. */
const PAGE_SIZE = 12;
const LOAD_MORE_STEP = 8;

export interface CategoryListingProps {
  /** Every product in this category, unfiltered. */
  products: ProductDto[];
  /** Brands present in this category. */
  brands: BrandDto[];
  accent: string;
  tint: string;
}

export function CategoryListing({
  products,
  brands,
  accent,
  tint,
}: CategoryListingProps) {
  const { t, tu } = useLang();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const brandSlugs = useMemo(() => brands.map((b) => b.slug), [brands]);

  // The URL is the source of truth. Parsing is total, so a garbage query string
  // degrades to defaults instead of an empty grid.
  const filters = useMemo(
    () => parseFilters(new URLSearchParams(searchParams.toString()), brandSlugs),
    [searchParams, brandSlugs],
  );

  /**
   * Paging state, reset by derivation rather than by an effect.
   *
   * `visible` is stored together with the filter signature it belongs to. When
   * the filters change, the stored signature no longer matches and the page
   * count falls back to PAGE_SIZE during render — no `setState` in an effect,
   * so no cascading render, and no frame where the old page count is applied to
   * the new result set.
   */
  const [sheetOpen, setSheetOpen] = useState(false);

  // A stable key for the current result set. Paging resets when this changes.
  const filterSignature = useMemo(
    () =>
      JSON.stringify({
        b: [...filters.brands].sort(),
        min: filters.minPricePoisha,
        max: filters.maxPricePoisha,
        r: filters.minRating,
        s: filters.inStockOnly,
        d: filters.onDiscountOnly,
        sort: filters.sort,
      }),
    [filters],
  );

  /**
   * Paging state, reset by derivation rather than by an effect.
   *
   * `visible` is stored together with the filter signature it belongs to. When
   * the filters change, the stored signature no longer matches and the page
   * count falls back to PAGE_SIZE during render — no `setState` in an effect,
   * so no cascading render, and no frame where the old page count is applied to
   * the new result set.
   */
  const [paging, setPaging] = useState({ signature: '', visible: PAGE_SIZE });

  const visible = paging.signature === filterSignature ? paging.visible : PAGE_SIZE;

  const showMore = useCallback(() => {
    setPaging({ signature: filterSignature, visible: visible + LOAD_MORE_STEP });
  }, [filterSignature, visible]);

  const writeFilters = useCallback(
    (next: CategoryFilters) => {
      const params = toSearchParams(next);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  /**
   * Debounced writer for the numeric price inputs.
   *
   * The slider and the checkboxes write immediately; only typed values wait
   * 250ms, because a number field fires on every digit and "1", "12", "120"
   * would otherwise be three URL writes and three grid rebuilds.
   */
  const commitPrice = useDebouncedCallback((next: CategoryFilters) => {
    writeFilters(next);
  }, 250);

  const onPanelChange = useCallback(
    (next: CategoryFilters) => {
      // A price edit is the only change that can arrive per-keystroke.
      const priceChanged =
        next.minPricePoisha !== filters.minPricePoisha ||
        next.maxPricePoisha !== filters.maxPricePoisha;

      if (priceChanged) {
        commitPrice(next);
      } else {
        writeFilters(next);
      }
    },
    [filters.minPricePoisha, filters.maxPricePoisha, commitPrice, writeFilters],
  );

  const onSortChange = useCallback(
    (sort: SortKey) => writeFilters({ ...filters, sort }),
    [filters, writeFilters],
  );

  const clearAll = useCallback(() => {
    writeFilters(DEFAULT_FILTERS);
  }, [writeFilters]);

  // ── the actual result set ────────────────────────────────────────────────
  const results = useMemo(
    () => applyClientFilters(products, filters),
    [products, filters],
  );

  const shown = results.slice(0, visible);
  const hasMore = visible < results.length;
  const active = hasActiveFilters(filters);

  const priceCeiling = useMemo(() => {
    if (products.length === 0) return 4000000;
    return Math.max(...products.map((p) => p.pricePoisha));
  }, [products]);

  const panel = (
    <FilterPanel
      filters={filters}
      onChange={onPanelChange}
      brands={brands}
      priceCeilingPoisha={priceCeiling}
      accent={accent}
      idPrefix="side"
    />
  );

  return (
    <section className="sec" id="allp">
      <SectionHeader title={t('allp')} subtitle={tu('categoryProducts')} />

      <div className="lay">
        {/* ── desktop sidebar ─────────────────────────────────────────── */}
        <aside className="flt" aria-label={t('filters')}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <h4 style={{ margin: 0 }}>{t('filters')}</h4>
            {active && (
              <button
                type="button"
                onClick={clearAll}
                style={{
                  color: 'var(--red)',
                  fontWeight: 700,
                  fontSize: 13,
                }}
              >
                {tu('clearFilters')}
              </button>
            )}
          </div>
          {panel}
        </aside>

        {/* ── results ─────────────────────────────────────────────────── */}
        <div>
          <div className="tb">
            <button
              type="button"
              className="chip fbtn"
              onClick={() => setSheetOpen(true)}
              aria-haspopup="dialog"
            >
              ⚙ {t('filters')}
              {active ? ' •' : ''}
            </button>

            <span className="count" aria-live="polite">
              {t('showing', { a: shown.length, b: results.length })}
            </span>

            <SortSelect value={filters.sort} onChange={onSortChange} />
          </div>

          {shown.length === 0 ? (
            <EmptyState
              tone="search"
              title={t('nores')}
              body={tu('noResultsBody')}
              action={
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {active && (
                    <button type="button" className="btn red" onClick={clearAll}>
                      {tu('clearFilters')}
                    </button>
                  )}
                  <a className="btn" href="#popular">
                    {t('pop')}
                  </a>
                </div>
              }
            />
          ) : (
            <div className="cat-grid">
              {shown.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  tint={tint}
                  accent={accent}
                />
              ))}
            </div>
          )}

          {hasMore && (
            <div className="lm">
              <button
                type="button"
                className="btn red"
                onClick={showMore}
              >
                {t('load')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── mobile filter sheet ───────────────────────────────────────── */}
      <MobileSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        label={tu('filterResults')}
        closeLabel={tu('closeSheet')}
        title={t('filters')}
      >
        <FilterPanel
          filters={filters}
          onChange={onPanelChange}
          brands={brands}
          priceCeilingPoisha={priceCeiling}
          accent={accent}
          idPrefix="sheet"
        />

        <div className="flt-actions">
          <button
            type="button"
            className="btn"
            onClick={() => {
              clearAll();
              setSheetOpen(false);
            }}
          >
            {tu('clearFilters')}
          </button>
          <button
            type="button"
            className="btn red"
            onClick={() => setSheetOpen(false)}
          >
            {tu('applyFilters')}
          </button>
        </div>
      </MobileSheet>
    </section>
  );
}
