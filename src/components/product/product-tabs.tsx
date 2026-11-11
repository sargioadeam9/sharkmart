'use client';

/**
 * ProductTabs — the reference's tab strip and panels (oshoppingbd.html L745-757).
 *
 * The reference renders eight tabs and swaps `#tc`'s innerHTML on click. This is
 * the same eight, in the same order, with the same class names (`.tabs`, `.tl`,
 * `.tc`, `.spec`, `.faq`) so the ported CSS in `product.css` applies unchanged.
 *
 * Two deliberate departures from the reference, both about honesty:
 *
 *   1. No fabricated barcode. The reference invents one with
 *      `89${1000000000 + id * 7919}`. `ProductDetailDto` has no barcode field,
 *      so a barcode row would be a number we made up. It is omitted.
 *   2. No invented warranty. The reference hardcodes "12 months" for gadgets and
 *      "N/A" for everything else. That is a promise about a real product, and it
 *      is not in the data. Warranty rows come from `product.specs` if the
 *      catalog carries them, and are absent otherwise.
 *
 * Accessibility: a real tablist. Arrow keys move between tabs, Home/End jump to
 * the ends, and only the active tab is in the tab order (roving tabindex) — the
 * pattern the WAI-ARIA authoring practices specify, and what a keyboard user
 * expects from a tab strip.
 */

import { Fragment, useCallback, useMemo, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import { useLang } from '@/lib/hooks';
import { localized, type ProductDetailDto } from '@/types/catalog';

type TabId = 'ovw' | 'desc' | 'feats' | 'specs' | 'how' | 'size' | 'dr' | 'faq';

/** Reference order (L745-757). Load-bearing: the strip is not reordered. */
const TAB_ORDER: TabId[] = ['ovw', 'desc', 'feats', 'specs', 'how', 'size', 'dr', 'faq'];

export interface ProductTabsProps {
  product: ProductDetailDto;
}

export function ProductTabs({ product }: ProductTabsProps) {
  const { lang, t, tu } = useLang();
  const [active, setActive] = useState<TabId>('ovw');
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const name = localized(lang, product.nameEn, product.nameBn);
  const brandName = product.brand
    ? localized(lang, product.brand.nameEn, product.brand.nameBn)
    : null;
  const categoryName = localized(
    lang,
    product.category.nameEn,
    product.category.nameBn,
  );

  /** Roving tabindex: arrow keys move focus AND selection, as the pattern wants. */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      const last = TAB_ORDER.length - 1;
      let next = index;

      if (event.key === 'ArrowRight') next = index === last ? 0 : index + 1;
      else if (event.key === 'ArrowLeft') next = index === 0 ? last : index - 1;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = last;
      else return;

      event.preventDefault();
      const id = TAB_ORDER[next];
      if (!id) return;
      setActive(id);
      tabRefs.current[id]?.focus();
    },
    [],
  );

  const features = lang === 'bn' ? product.featuresBn : product.featuresEn;

  /**
   * Specs rows: whatever the catalog actually carries, then any of the three
   * identity fields it does not already have.
   *
   * The dedupe is not defensive padding — the mock's `specs` already includes
   * SKU, Brand and Category (it is generated from the reference's spec table),
   * so appending unconditionally rendered every one of them twice. Matching on
   * the label keeps this correct whether the catalog supplies them or not.
   *
   * No barcode, no invented warranty — see the header note.
   */
  const specRows = useMemo(() => {
    const rows = product.specs.map((row) => ({
      label: localized(lang, row.labelEn, row.labelBn),
      value: localized(lang, row.valueEn, row.valueBn),
    }));

    const present = new Set(rows.map((row) => row.label.trim().toLowerCase()));

    const identity = [
      { label: tu('specSku'), value: product.sku },
      { label: tu('specBrand'), value: brandName ?? tu('specUnbranded') },
      { label: tu('specCategory'), value: categoryName },
    ];

    for (const row of identity) {
      if (!present.has(row.label.trim().toLowerCase())) rows.push(row);
    }

    return rows;
  }, [product.specs, product.sku, lang, brandName, categoryName, tu]);

  const panel: Record<TabId, React.ReactNode> = {
    ovw: (
      <p>
        {name} — {tu('ovwSuffix')}
      </p>
    ),

    desc: <p>{tu('descBody')}</p>,

    feats: features.length > 0 ? (
      <ul>
        {features.map((feature) => (
          <li key={feature}>{feature}</li>
        ))}
      </ul>
    ) : (
      <p className="muted">{tu('tabEmpty')}</p>
    ),

    specs:
      specRows.length > 0 ? (
        <div className="spec">
          {/* Fragment, not a wrapper div: `.spec > b` and `.spec > *` are direct-child
              selectors in product.css, so a wrapper would break the grid. */}
          {specRows.map((row) => (
            <Fragment key={row.label}>
              <b>{row.label}</b>
              <span>{row.value}</span>
            </Fragment>
          ))}
        </div>
      ) : (
        <p className="muted">{tu('tabEmpty')}</p>
      ),

    how: (
      <ul>
        <li>{tu('how1')}</li>
        <li>{tu('how2')}</li>
      </ul>
    ),

    size: (
      <div className="spec">
        <b>S</b>
        <span>{tu('sizeS')}</span>
        <b>M</b>
        <span>{tu('sizeM')}</span>
        <b>L</b>
        <span>{tu('sizeL')}</span>
        <b>XL</b>
        <span>{tu('sizeXL')}</span>
      </div>
    ),

    dr: (
      <ul>
        <li>{tu('dr1')}</li>
        <li>{tu('dr2')}</li>
      </ul>
    ),

    faq: (
      <div className="faq">
        <details open>
          <summary>{tu('faqQ1')}</summary>
          <p>{tu('faqA1')}</p>
        </details>
        <details>
          <summary>{tu('faqQ2')}</summary>
          <p>{tu('faqA2')}</p>
        </details>
      </div>
    ),
  };

  return (
    <div className="tabs">
      <div className="tl" role="tablist" aria-label={tu('productTabs')}>
        {TAB_ORDER.map((id, index) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`tab-${id}`}
            aria-selected={active === id}
            aria-controls={`panel-${id}`}
            tabIndex={active === id ? 0 : -1}
            className={cn(active === id && 'on')}
            ref={(node) => {
              tabRefs.current[id] = node;
            }}
            onClick={() => setActive(id)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {t(id)}
          </button>
        ))}
      </div>

      <div
        className="tc"
        role="tabpanel"
        id={`panel-${active}`}
        aria-labelledby={`tab-${active}`}
        tabIndex={0}
      >
        {panel[active]}
      </div>
    </div>
  );
}
