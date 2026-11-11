'use client';

/**
 * ProductCard — the reference's `.pc` (oshoppingbd.html L180-212, markup at
 * L639-645).
 *
 * Structure copied exactly: image tile with radial-gradient tint, discount
 * pill, out-of-stock bar, wishlist heart, brand line, 2-line clamped name,
 * stars + count, price + strikethrough, stock line, add button.
 *
 * Deliberate differences from the reference, all of them bug fixes:
 *   - The heart is a real toggle with `aria-pressed`, not a button that
 *     re-renders the whole grid.
 *   - The add button reports its own load/success cycle instead of mutating its
 *     text node in a timeout.
 *   - The card is an <article> with the link wrapping only the image and the
 *     name, so the buttons inside are not nested in an anchor (invalid HTML,
 *     and it breaks keyboard order).
 *   - `--t` (tint) and `--a` (accent) come from the product's category record,
 *     which is data, not a design decision.
 */

import Link from 'next/link';
import { useCallback, useState } from 'react';
import type { ProductDto } from '@/types/catalog';
import { localized } from '@/types/catalog';
import { formatMoney, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useLang } from '@/lib/hooks';
import { useCartStore, type CartLine } from '@/lib/store/cart-store';
import { useWishlistStore } from '@/lib/store/wishlist-store';
import { toast } from '@/components/shared/toast';
import { AddToCartButton, useAddToCartState } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StarRating } from '@/components/ui/star-rating';

export interface ProductCardProps {
  product: ProductDto;
  /** Category light tint for the image gradient. Falls back to a neutral. */
  tint?: string;
  /** Category accent, used for the hover border. */
  accent?: string;
  /** Sold percentage — only the flash-sale variant passes this. */
  soldPercent?: number;
  className?: string;
  /** Fires after the line is added; lets a parent open the drawer if it wants. */
  onAdded?: (product: ProductDto) => void;
}

/** Builds the persisted cart line from a product DTO. */
export function toCartLine(product: ProductDto): CartLine {
  const main = product.images.find((i) => i.isMain) ?? product.images[0];

  return {
    productId: product.id,
    slug: product.slug,
    sku: product.sku,
    nameEn: product.nameEn,
    nameBn: product.nameBn,
    imageUrl: main?.url ?? null,
    emoji: null,
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

export function ProductCard({
  product,
  tint = '#F4E9DD',
  accent,
  soldPercent,
  className,
  onAdded,
}: ProductCardProps) {
  const { lang, t, tu } = useLang();
  const addLine = useCartStore((s) => s.addLine);
  const wishlisted = useWishlistStore((s) => s.ids.includes(product.id));
  const toggleWishlist = useWishlistStore((s) => s.toggle);

  const [addState, runAdd] = useAddToCartState();
  const [wishBump, setWishBump] = useState(false);

  const name = localized(lang, product.nameEn, product.nameBn);
  const brandName = product.brand
    ? localized(lang, product.brand.nameEn, product.brand.nameBn)
    : null;

  const isOut = product.stockStatus === 'out_of_stock';
  const isLow = product.stockStatus === 'low_stock';
  const mainImage = product.images.find((i) => i.isMain) ?? product.images[0];

  const stockLabel = isOut
    ? t('out')
    : isLow
      ? t('left', { n: product.stockQuantity })
      : t('inst');

  const handleAdd = useCallback(() => {
    if (isOut) return;

    runAdd(() => {
      addLine(toCartLine(product), 1);
      toast(`${name} — ${t('addedT')}`);
      onAdded?.(product);
    });
  }, [isOut, runAdd, addLine, product, name, t, onAdded]);

  const handleWishlist = useCallback(() => {
    const nowSaved = toggleWishlist(product.id);
    setWishBump(true);
    window.setTimeout(() => setWishBump(false), 500);
    toast(nowSaved ? tu('savedToWishlist') : tu('removedFromWishlist'));
  }, [toggleWishlist, product.id, tu]);

  return (
    <article
      className={cn('pc', className)}
      style={{
        ['--t' as string]: tint,
        ...(accent ? { ['--a' as string]: accent } : {}),
      }}
    >
      <Link
        href={`/product/${product.slug}`}
        className="pc-img"
        aria-label={name}
        tabIndex={-1}
      >
        {mainImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- data-URI placeholder in Phase 1; next/image lands with real assets in Phase 6.
          <img
            src={mainImage.url}
            alt={localized(lang, mainImage.altEn, mainImage.altBn)}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span className="emo" aria-hidden="true">
            🛍️
          </span>
        )}

        {product.discountPercent > 0 && (
          <Badge overlay tone="discount">
            -{product.discountPercent}%
          </Badge>
        )}

        {isOut && <span className="oos">{t('out')}</span>}
      </Link>

      <button
        type="button"
        className={cn('wish', wishlisted && 'on', wishBump && 'animate-[sm-bump_0.5s]')}
        onClick={handleWishlist}
        aria-pressed={wishlisted}
        aria-label={wishlisted ? tu('removeFromWishlist') : tu('addToWishlist')}
      >
        <span aria-hidden="true">♥</span>
      </button>

      <div className="pc-b">
        {brandName && <div className="pc-brand">{brandName}</div>}

        <Link href={`/product/${product.slug}`} className="pc-n">
          {name}
        </Link>

        <div className="pc-r">
          <StarRating rating={product.rating} lang={lang} />
          <span>
            {formatNumber(product.rating, lang)} (
            {formatNumber(product.reviewCount, lang)})
          </span>
        </div>

        <div className="pc-p">
          <b>{formatMoney(product.pricePoisha, lang)}</b>
          {product.originalPricePoisha > product.pricePoisha && (
            <s>{formatMoney(product.originalPricePoisha, lang)}</s>
          )}
        </div>

        <div className={cn('pc-s', isOut && 'out', isLow && 'low')}>{stockLabel}</div>

        {soldPercent !== undefined && (
          <>
            <div className="sold">
              <i style={{ width: `${Math.min(100, soldPercent)}%` }} />
            </div>
            <div className="sold-t">{t('sold', { n: soldPercent })}</div>
          </>
        )}


        <AddToCartButton
          state={addState}
          onClick={handleAdd}
          disabled={isOut}
          successLabel={t('addedT')}
          aria-label={isOut ? t('out') : `${t('add')} — ${name}`}
        >
          {isOut ? t('out') : t('add')}
        </AddToCartButton>
      </div>
    </article>
  );
}
