'use client';

/**
 * VariantSelector — the reference's `pUpd()` (oshoppingbd.html L760-765).
 *
 * The reference keeps `PS.sel` — one index per group — and derives everything
 * from it in `pCur()`. This component keeps that shape exactly: the parent owns
 * `selection: number[]`, and `resolveVariant()` is the single function that
 * turns it into price, stock, swatch and cart payload.
 *
 * Why one selector and not per-field state: if price, stock and the selected
 * image each had their own `useState`, a variant change could update the price
 * and leave the stock showing the previous option's count. One array in, one
 * derived object out, and they cannot disagree.
 */

import { cn } from '@/lib/utils';
import { useLang } from '@/lib/hooks';
import type { ProductDetailDto, VariantGroupDto } from '@/types/catalog';
import { localized } from '@/types/catalog';

export interface ResolvedVariant {
  /** The real `ProductVariant.id` for this selection, or null when unmatched. */
  variantId: string | null;
  /** Base price plus every selected option's delta, in poisha. */
  pricePoisha: number;
  /** Struck-through price, 0 when the product has no discount. */
  originalPricePoisha: number;
  /** Lowest stock across the selected options — the stepper's ceiling. */
  stock: number;
  /** Selected colour hex, when a swatch group is selected. */
  swatch: string | null;
  /** Human-readable combination, e.g. "M · Navy". Empty when no groups. */
  labelEn: string;
  labelBn: string;
  /** True when any selected option has no stock. */
  isOutOfStock: boolean;
}

/**
 * The selection key the server publishes as `combinations`.
 *
 * Must match `combinationKey()` in `server/src/services/mappers.ts` exactly:
 * every `attributeId:value` pair, sorted, joined with `|`. The server owns the
 * table; this only has to build the same string from the same selection.
 */
export function selectionKey(
  groups: VariantGroupDto[],
  selection: number[],
): string {
  return groups
    .map((group, groupIndex) => {
      const option = group.options[selection[groupIndex] ?? 0];
      return option ? `${group.id}:${option.nameEn}` : null;
    })
    .filter((part): part is string => part !== null)
    .sort()
    .join('|');
}

/**
 * The one derivation. Everything the page displays about the current variant
 * comes from here.
 */
export function resolveVariant(
  product: ProductDetailDto,
  selection: number[],
): ResolvedVariant {
  let delta = 0;
  let stock = product.stockQuantity;
  let swatch: string | null = null;
  const labelsEn: string[] = [];
  const labelsBn: string[] = [];

  product.variantGroups.forEach((group, groupIndex) => {
    const optionIndex = selection[groupIndex] ?? 0;
    const option = group.options[optionIndex];
    if (!option) return;

    delta += option.priceDeltaPoisha;
    stock = Math.min(stock, option.stock);
    if (option.swatch) swatch = option.swatch;

    labelsEn.push(option.nameEn);
    labelsBn.push(option.nameBn);
  });

  const pricePoisha = product.pricePoisha + delta;

  // A combination's own stock is authoritative: it is the row that actually
  // ships. The per-option minimum is only a fallback for a selection the
  // combination table does not cover.
  const combinations = product.variantGroups[0]?.combinations ?? {};
  const variantId = combinations[selectionKey(product.variantGroups, selection)] ?? null;
  const combinationStock = variantId
    ? product.variants.find((v) => v.id === variantId)?.stock
    : undefined;

  return {
    variantId,
    pricePoisha,
    originalPricePoisha:
      product.originalPricePoisha > 0 ? product.originalPricePoisha + delta : 0,
    stock: Math.max(0, combinationStock ?? stock),
    swatch,
    labelEn: labelsEn.join(' · '),
    labelBn: labelsBn.join(' · '),
    isOutOfStock: (combinationStock ?? stock) <= 0,
  };
}

/**
 * The initial selection: the first in-stock option of each group, falling back
 * to index 0 when the whole group is sold out. The reference does the same
 * (`g.o.findIndex(o => o.s > 0)` clamped at 0).
 */
export function initialSelection(product: ProductDetailDto): number[] {
  return product.variantGroups.map((group) => {
    const index = group.options.findIndex((option) => option.stock > 0);
    return index === -1 ? 0 : index;
  });
}

export interface VariantSelectorProps {
  product: ProductDetailDto;
  selection: number[];
  onChange: (next: number[]) => void;
}

export function VariantSelector({
  product,
  selection,
  onChange,
}: VariantSelectorProps) {
  const { lang } = useLang();

  if (product.variantGroups.length === 0) return null;

  return (
    <>
      {product.variantGroups.map((group, groupIndex) => (
        <VariantGroup
          key={group.id}
          group={group}
          lang={lang}
          selectedIndex={selection[groupIndex] ?? 0}
          onSelect={(optionIndex) => {
            const next = [...selection];
            next[groupIndex] = optionIndex;
            onChange(next);
          }}
        />
      ))}
    </>
  );
}

function VariantGroup({
  group,
  lang,
  selectedIndex,
  onSelect,
}: {
  group: VariantGroupDto;
  lang: 'en' | 'bn';
  selectedIndex: number;
  onSelect: (index: number) => void;
}) {
  const selected = group.options[selectedIndex];
  const isSwatch = group.kind === 'swatch';

  return (
    <div className="vg">
      <h5>
        {localized(lang, group.labelEn, group.labelBn)}:{' '}
        <span>
          {selected ? localized(lang, selected.nameEn, selected.nameBn) : ''}
        </span>
      </h5>

      <div className={cn('vo', isSwatch && 'col')}>
        {group.options.map((option, index) => {
          const out = option.stock <= 0;
          return (
            <button
              key={option.valueKey}
              type="button"
              onClick={() => onSelect(index)}
              className={cn(index === selectedIndex && 'on')}
              disabled={out}
              aria-pressed={index === selectedIndex}
              aria-label={localized(lang, option.nameEn, option.nameBn)}
              title={localized(lang, option.nameEn, option.nameBn)}
              style={option.swatch ? { background: option.swatch } : undefined}
            >
              {isSwatch ? '' : localized(lang, option.nameEn, option.nameBn)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
