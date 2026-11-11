'use client';

/**
 * FrequentlyBoughtTogether — the reference's bundle strip (oshoppingbd.html L749).
 *
 * Reference behaviour: `fb = [product, ...sameCategory.slice(0, 2)]`, the sum is
 * `fb.reduce((s, x) => s + x.p, 0)`, and the displayed bundle price is
 * `fbSum * 0.95` — a flat 5% bundle discount. That math is reproduced exactly,
 * in integer poisha, with the rounding done once at the end.
 *
 * The reference's "Add all 3 to cart" button adds every item in the bundle. This
 * does the same, but through the real cart store, one line per product, and it
 * skips anything out of stock rather than adding a line the cart cannot honour.
 *
 * Note on the 5%: this is a *display* price. Checkout recomputes every total
 * server-side from the DB (AGENTS.md §7.3), so if the backend does not implement
 * a bundle rule, the customer sees the honest cart price at checkout. Nothing
 * here is trusted for money.
 */

import Link from 'next/link';
import { Fragment, useCallback } from 'react';

import { useLang } from '@/lib/hooks';
import { formatMoney } from '@/lib/format';
import { localized, type ProductDetailDto, type ProductDto } from '@/types/catalog';

import { useCartStore, type CartLine } from '@/lib/store/cart-store';
import { Button } from '@/components/ui/button';
import { SectionHeader } from '@/components/home/section-header';
import { toast } from '@/components/shared/toast';

/** The reference's bundle discount, as a fraction kept out of float math. */
const BUNDLE_DISCOUNT_PERCENT = 5;

export interface FrequentlyBoughtTogetherProps {
  product: ProductDetailDto;
  /** Up to two companions. Fewer is fine; zero renders nothing. */
  candidates: ProductDto[];
}

/** Builds a cart line from a list DTO — no variant selection exists here. */
function toCartLine(product: ProductDto): CartLine {
  const main = product.images.find((image) => image.isMain) ?? product.images[0];

  return {
    productId: product.id,
    slug: product.slug,
    sku: product.sku,
    nameEn: product.nameEn,
    nameBn: product.nameBn,
    imageUrl: main?.url ?? null,
    emoji: null,
    // `ProductDto` carries no tint; the detail DTO does. Neutral fallback, same
    // as ProductCard's default, so a bundle tile is never an unstyled block.
    tint: '#F4E9DD',
    unitPricePoisha: product.pricePoisha,
    originalUnitPricePoisha: product.originalPricePoisha,
    variantId: null,
    variantNameEn: null,
    variantNameBn: null,
    quantity: 1,
    stockQuantity: product.stockQuantity,
  };
}

export function FrequentlyBoughtTogether({
  product,
  candidates,
}: FrequentlyBoughtTogetherProps) {
  const { lang, t, tu } = useLang();
  const addLine = useCartStore((s) => s.addLine);

  const companions = candidates.slice(0, 2);

  const handleAddAll = useCallback(() => {
    const bundle: ProductDto[] = [product, ...companions];
    const inStock = bundle.filter((item) => item.stockQuantity > 0);

    if (inStock.length === 0) return;

    for (const item of inStock) addLine(toCartLine(item), 1);

    toast(`${inStock.length} ${tu('items')} — ${t('addedT')}`);
  }, [product, companions, addLine, tu, t]);

  // A bundle of one is not a bundle.
  if (companions.length === 0) return null;

  const bundle: ProductDto[] = [product, ...companions];
  const sumPoisha = bundle.reduce((total, item) => total + item.pricePoisha, 0);
  const bundlePoisha = Math.round(
    (sumPoisha * (100 - BUNDLE_DISCOUNT_PERCENT)) / 100,
  );
  const anyInStock = bundle.some((item) => item.stockQuantity > 0);

  return (
    <section className="sec">
      <SectionHeader title={t('fbt')} />

      <div className="fbt">
      {bundle.map((item, index) => {
        const itemName = localized(lang, item.nameEn, item.nameBn);

        return (
          <Fragment key={item.id}>
            {index > 0 ? (
              <span className="pl" aria-hidden="true">
                +
              </span>
            ) : null}

            <Link className="it" href={`/product/${item.slug}`}>
              <div
                className="im"
                style={{ background: '#F4E9DD' }}
                aria-hidden="true"
              >
                {item.images[0]?.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.images[0].url}
                    alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 16 }}
                  />
                ) : (
                  '🛍️'
                )}
              </div>
              {itemName}
              <br />
              <b style={{ color: 'var(--color-shop-red)' }}>
                {formatMoney(item.pricePoisha, lang)}
              </b>
            </Link>
          </Fragment>
        );
      })}

      <div className="sm">
        <small>{t('bundle')}</small>
        <b>{formatMoney(bundlePoisha, lang)}</b>
        <Button variant="primary" disabled={!anyInStock} onClick={handleAddAll}>
          {t('addAll')}
        </Button>
      </div>
      </div>
    </section>
  );
}
