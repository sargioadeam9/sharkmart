/**
 * MobileHeader — the reference's `.mhd` (oshoppingbd.html L466-475, markup
 * L615).
 *
 * Shown only below 760px, where `.topbar`, `.hd-main` and `.hd-nav` are hidden.
 * Compact logo, language pill, wishlist + cart icons, then a full-width search.
 *
 * The cart badge here is the same live count as the desktop header — one store,
 * two surfaces, so they can never disagree.
 */

'use client';

import Link from 'next/link';

import type { CategoryDto, ProductDto } from '@/types/catalog';
import { useCartStore, cartItemCount } from '@/lib/store/cart-store';
import { useWishlistStore } from '@/lib/store/wishlist-store';
import { useUiStore } from '@/lib/store/ui-store';
import { useLang } from '@/lib/hooks';
import { formatNumber } from '@/lib/format';
import { Logo } from '@/components/brand/logo';
import { SearchBar } from '@/components/shared/search-bar';
import { CartIcon, HeartIcon } from '@/components/ui/icons';
import { LanguageToggle } from './language-toggle';

export interface MobileHeaderProps {
  categories: CategoryDto[];
  products: ProductDto[];
}

export function MobileHeader({ categories, products }: MobileHeaderProps) {
  const { lang, t, tu } = useLang();

  const cartCount = useCartStore((s) => cartItemCount(s.lines));
  const wishCount = useWishlistStore((s) => s.ids.length);
  const openCart = useUiStore((s) => s.openCart);

  return (
    <div className="mhd">
      <div className="r1">
        <Logo href="/" size="sm" priority />

        <div className="rr">
          <LanguageToggle variant="mobile" />

          <Link className="ib" href="/wishlist" aria-label={t('wish')}>
            <HeartIcon />
            <b className="cnt">{formatNumber(wishCount, lang)}</b>
          </Link>

          <button
            type="button"
            className="ib"
            onClick={openCart}
            aria-label={tu('openCart')}
          >
            <CartIcon />
            <b className="cnt">{formatNumber(cartCount, lang)}</b>
          </button>
        </div>
      </div>

      <SearchBar
        products={products}
        categories={categories}
        size="sm"
        className="w-full"
      />
    </div>
  );
}
