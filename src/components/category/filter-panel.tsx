'use client';

/**
 * FilterPanel — the reference's `.flt` sidebar (oshoppingbd.html L313-318,
 * markup L682).
 *
 * ONE component, rendered twice: as the sticky desktop sidebar and inside the
 * mobile `MobileSheet`. The reference duplicates the markup and the two copies
 * drift; here the fields exist once, so a new filter cannot appear on one
 * surface and not the other.
 *
 * Field behaviour follows the reference, with three fixes:
 *
 *   - The price range is a slider *and* two number inputs. The reference has
 *     only the slider, which cannot express "৳1,200 to ৳1,800" without
 *     dragging to a guess.
 *   - Brand checkboxes are derived from the products actually in this category,
 *     not from the first seven brands in the catalog.
 *   - Every control has a real label association, so a screen reader announces
 *     "Nike, checkbox, checked" rather than "checkbox".
 */

import type { BrandDto } from '@/types/catalog';
import { localized } from '@/types/catalog';
import { formatMoney } from '@/lib/format';
import { useLang } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import type { CategoryFilters, SortKey } from '@/lib/category-filters';
import { RATING_OPTIONS } from '@/lib/category-filters';

export interface FilterPanelProps {
  filters: CategoryFilters;
  onChange: (next: CategoryFilters) => void;
  /** Brands present in this category, already sorted. */
  brands: BrandDto[];
  /** Upper bound of the price slider, in poisha. */
  priceCeilingPoisha: number;
  /** Category accent, for the checkbox/radio highlight. */
  accent?: string;
  /** `id` prefix so the sidebar and the sheet never collide on input ids. */
  idPrefix: string;
  className?: string;
}

export function FilterPanel({
  filters,
  onChange,
  brands,
  priceCeilingPoisha,
  accent,
  idPrefix,
  className,
}: FilterPanelProps) {
  const { lang, t, tu } = useLang();

  const sliderMax = Math.max(priceCeilingPoisha, 100);
  const sliderValue = filters.maxPricePoisha ?? sliderMax;

  const setBrand = (slug: string, checked: boolean) => {
    const next = checked
      ? [...filters.brands, slug]
      : filters.brands.filter((b) => b !== slug);
    onChange({ ...filters, brands: next });
  };

  const setMaxPrice = (value: number | null) => {
    onChange({
      ...filters,
      maxPricePoisha: value === null ? null : Math.min(Math.max(0, value), sliderMax),
    });
  };

  return (
    <div
      className={cn('flt-fields', className)}
      style={accent ? { ['--a' as string]: accent } : undefined}
    >
      {/* ── price ─────────────────────────────────────────────────────── */}
      <h4>
        {t('price')}:{' '}
        <span>{formatMoney(filters.maxPricePoisha ?? sliderMax, lang)}</span>
      </h4>

      <input
        type="range"
        min={0}
        max={sliderMax}
        step={10000}
        value={sliderValue}
        onChange={(event) => setMaxPrice(Number(event.target.value))}
        aria-label={t('price')}
        aria-valuetext={formatMoney(sliderValue, lang)}
      />

      <div className="price-row">
        <input
          type="number"
          id={`${idPrefix}-min`}
          inputMode="numeric"
          min={0}
          max={sliderMax}
          step={100}
          placeholder={tu('minPrice')}
          aria-label={tu('minPrice')}
          value={filters.minPricePoisha === null ? '' : Math.round(filters.minPricePoisha / 100)}
          onChange={(event) => {
            const raw = event.target.value;
            onChange({
              ...filters,
              minPricePoisha: raw === '' ? null : Math.max(0, Number(raw)) * 100,
            });
          }}
        />
        <span aria-hidden="true">—</span>
        <input
          type="number"
          id={`${idPrefix}-max`}
          inputMode="numeric"
          min={0}
          max={sliderMax}
          step={100}
          placeholder={tu('maxPrice')}
          aria-label={tu('maxPrice')}
          value={
            filters.maxPricePoisha === null ? '' : Math.round(filters.maxPricePoisha / 100)
          }
          onChange={(event) => {
            const raw = event.target.value;
            setMaxPrice(raw === '' ? null : Number(raw) * 100);
          }}
        />
      </div>

      {/* ── brands ────────────────────────────────────────────────────── */}
      {brands.length > 0 && (
        <>
          <h4>{t('brand')}</h4>
          {brands.map((brand) => {
            const name = localized(lang, brand.nameEn, brand.nameBn);
            const id = `${idPrefix}-brand-${brand.slug}`;
            return (
              <label key={brand.id} htmlFor={id}>
                <input
                  type="checkbox"
                  id={id}
                  value={brand.slug}
                  checked={filters.brands.includes(brand.slug)}
                  onChange={(event) => setBrand(brand.slug, event.target.checked)}
                />
                {name}
              </label>
            );
          })}
        </>
      )}

      {/* ── rating ────────────────────────────────────────────────────── */}
      <h4>{t('rating')}</h4>
      {RATING_OPTIONS.map((floor) => {
        const id = `${idPrefix}-rating-${floor}`;
        return (
          <label key={floor} htmlFor={id}>
            <input
              type="radio"
              id={id}
              name={`${idPrefix}-rating`}
              value={floor}
              checked={filters.minRating === floor}
              onChange={() => onChange({ ...filters, minRating: floor })}
            />
            {floor === 0 ? <span>{lang === 'bn' ? 'সব' : 'All'}</span> : null}
            {floor !== 0 ? <span>{floor}★ +</span> : null}
          </label>
        );
      })}

      {/* ── availability ──────────────────────────────────────────────── */}
      <h4>{t('avail')}</h4>
      <label htmlFor={`${idPrefix}-stock`}>
        <input
          type="checkbox"
          id={`${idPrefix}-stock`}
          checked={filters.inStockOnly}
          onChange={(event) =>
            onChange({ ...filters, inStockOnly: event.target.checked })
          }
        />
        {t('avail')}
      </label>
      <label htmlFor={`${idPrefix}-discount`}>
        <input
          type="checkbox"
          id={`${idPrefix}-discount`}
          checked={filters.onDiscountOnly}
          onChange={(event) =>
            onChange({ ...filters, onDiscountOnly: event.target.checked })
          }
        />
        {t('discO')}
      </label>
    </div>
  );
}

/** The sort `<select>` — the reference's `#f-sort` (markup L682). */
export interface SortSelectProps {
  value: SortKey;
  onChange: (next: SortKey) => void;
  className?: string;
}

export function SortSelect({ value, onChange, className }: SortSelectProps) {
  const { t, tu } = useLang();

  const options: { value: SortKey; label: string }[] = [
    { value: 'relevance', label: t('rel') },
    { value: 'newest', label: t('newest') },
    { value: 'popular', label: t('popu') },
    { value: 'price_asc', label: t('lh') },
    { value: 'price_desc', label: t('hl') },
    { value: 'rating', label: t('hr') },
  ];

  return (
    <select
      className={cn('sel', className)}
      value={value}
      onChange={(event) => onChange(event.target.value as SortKey)}
      aria-label={tu('sortProducts')}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
