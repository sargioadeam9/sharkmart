'use client';

/**
 * MiniProductCard — the reference's `.mini` (oshoppingbd.html L280-286, markup
 * L785), used in the cart drawer's "You may also like" strip.
 *
 * Deliberately smaller than ProductCard: no stars, no stock line, no wishlist.
 * It exists to be scanned in a 148px column, so it carries only image, name,
 * price and a one-tap add.
 */

import Link from 'next/link';
import { useCallback } from 'react';
import type { ProductDto } from '@/types/catalog';
import { localized } from '@/types/catalog';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useLang } from '@/lib/hooks';
import { useCartStore } from '@/lib/store/cart-store';
import { toast } from '@/components/shared/toast';
import { toCartLine } from '@/components/product/product-card';

export interface MiniProductCardProps {
  product: ProductDto;
  tint?: string;
  className?: string;
}

export function MiniProductCard({
  product,
  tint = '#F4E9DD',
  className,
}: MiniProductCardProps) {
  const { lang, t } = useLang();
  const addLine = useCartStore((s) => s.addLine);

  const name = localized(lang, product.nameEn, product.nameBn);
  const mainImage = product.images.find((i) => i.isMain) ?? product.images[0];
  const isOut = product.stockStatus === 'out_of_stock';

  const handleAdd = useCallback(() => {
    if (isOut) return;
    addLine(toCartLine(product), 1);
    toast(`${name} — ${t('addedT')}`);
  }, [isOut, addLine, product, name, t]);

  return (
    <div className={cn('mini', className)}>
      <Link
        href={`/product/${product.slug}`}
        className="im"
        style={{ background: tint }}
        aria-label={name}
        tabIndex={-1}
      >
        {mainImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- data-URI placeholder until real assets land.
          <img
            src={mainImage.url}
            alt=""
            className="h-full w-full object-contain"
            loading="lazy"
          />
        ) : (
          <span aria-hidden="true">🛍️</span>
        )}
      </Link>

      <b className="n">{name}</b>

      <div className="pr">
        {formatMoney(product.pricePoisha, lang)}
        {product.originalPricePoisha > product.pricePoisha && (
          <s>{formatMoney(product.originalPricePoisha, lang)}</s>
        )}
      </div>

      <button
        type="button"
        className="btn-add"
        onClick={handleAdd}
        disabled={isOut}
        aria-label={`${t('add')} — ${name}`}
      >
        + {t('add').split(' ')[0]}
      </button>
    </div>
  );
}
