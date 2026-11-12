/**
 * Header — the reference's `header.hd` (oshoppingbd.html L44-98, markup L609).
 *
 * Three rows on desktop: the top bar, the main row (logo, search, wishlist /
 * cart / account), and the nav row (All Categories pill, 7 links, More).
 *
 * Sticky through scroll (`header.hd { position: sticky; top: 0 }`), which is
 * why the cart count badge animates on change — the user is often scrolled
 * away from the product they just added, so the badge is the only feedback.
 *
 * The badge animation is the reference's `.cnt.bump` keyframe. It is replayed
 * by keying the badge on the count, which remounts the element; a CSS class
 * toggle would need a forced reflow, which is what the reference does
 * (`void e.offsetWidth`).
 */

'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { CategoryDto, ProductDto } from '@/types/catalog';
import { useWishlistStore } from '@/lib/store/wishlist-store';
import { useUiStore } from '@/lib/store/ui-store';
import { useSessionStore } from '@/lib/store/session-store';
import { useLang } from '@/lib/hooks';
import { useEffectiveCart } from '@/lib/hooks/use-effective-cart';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Logo } from '@/components/brand/logo';
import { SearchBar } from '@/components/shared/search-bar';
import { CartIcon, HeartIcon, UserIcon } from '@/components/ui/icons';
import { MegaMenu } from './mega-menu';

export interface HeaderProps {
  categories: CategoryDto[];
  products: ProductDto[];
}

/** The reference's nav links: [i18n key, href, extra class]. */
const NAV_LINKS: { key: 'flash' | 'brands' | 'newa' | 'best' | 'deals'; href: string; className?: string }[] = [
  { key: 'flash', href: '/flash-sale', className: 'fs' },
  { key: 'brands', href: '/brands' },
  { key: 'newa', href: '/new-arrivals' },
  { key: 'best', href: '/best-sellers' },
  { key: 'deals', href: '/deals' },
];

const MORE_LINKS: { key: 'only' | 'trend' | 'clear' | 'gift' | 'help'; href: string }[] = [
  { key: 'only', href: '/search/only-for-you' },
  { key: 'trend', href: '/search/trending' },
  { key: 'clear', href: '/search/clearance' },
  { key: 'gift', href: '/search/gift-ideas' },
  { key: 'help', href: '/help' },
];

export function Header({ categories, products }: HeaderProps) {
  const { lang, t, tu } = useLang();

  const cartCount = useEffectiveCart().itemCount;  const wishCount = useWishlistStore((s) => s.ids.length);
  const openCart = useUiStore((s) => s.openCart);

  /**
   * The account link reflects the session.
   *
   * `status` starts 'unknown' and resolves after `/me`, so the first paint is
   * the signed-out state — which is what the server rendered too, so there is
   * no hydration mismatch. A signed-in shopper sees their first name instead of
   * "Login / Register", which is the difference between a shop that remembers
   * you and one that does not.
   */
  const sessionUser = useSessionStore((s) => s.user);
  const signedIn = useSessionStore((s) => s.status) === 'authenticated';
  const firstName = sessionUser?.name.trim().split(/\s+/)[0] ?? '';

  /**
   * The badge replays its bump animation whenever the count changes. Keying on
   * the count remounts the element, which restarts the CSS animation without a
   * forced reflow.
   */
  const [bumpKey, setBumpKey] = useState(0);
  const previousCount = useRef(cartCount);

  useEffect(() => {
    if (cartCount !== previousCount.current) {
      previousCount.current = cartCount;
      setBumpKey((k) => k + 1);
    }
  }, [cartCount]);

  const closeMega = useCallback(() => {
    // Navigation closes the menu; the mega menu owns its own open state.
  }, []);

  const cartLabel = useMemo(
    () => formatNumber(cartCount, lang),
    [cartCount, lang],
  );
  const wishLabel = useMemo(
    () => formatNumber(wishCount, lang),
    [wishCount, lang],
  );

  return (
    <header className="hd">
      <div className="wrap hd-main">
        <Logo href="/" size="md" priority />

        <SearchBar products={products} categories={categories} />

        <div className="hd-act">
          <Link className="ib" href="/wishlist" aria-label={t('wish')}>
            <HeartIcon />
            <span>{t('wish')}</span>
            <b className="cnt" key={`w-${wishLabel}`}>
              {wishLabel}
            </b>
          </Link>

          <button
            type="button"
            className="ib"
            onClick={openCart}
            aria-label={tu('openCart')}
          >
            <CartIcon />
            <span>{t('cart')}</span>
            <b className="cnt bump" key={`c-${bumpKey}`}>
              {cartLabel}
            </b>
          </button>

          <Link className="ib" href={signedIn ? '/profile' : '/login'}>
            <UserIcon />
            <span>{signedIn ? firstName : t('login')}</span>
          </Link>
        </div>
      </div>

      <div className="hd-nav">
        <div className="wrap">
          <MegaMenu categories={categories} onNavigate={closeMega} />

          <ul className="nl">
            <li>
              <Link href="/">{t('home')}</Link>
            </li>
            {NAV_LINKS.map((link) => (
              <li key={link.key}>
                <Link href={link.href} className={cn(link.className)}>
                  {t(link.key)}
                </Link>
              </li>
            ))}
            <li>
              <button type="button" aria-haspopup="true">
                {t('more')} ▾
              </button>
              <div className="more-m">
                {MORE_LINKS.map((link) => (
                  <Link key={link.key} href={link.href}>
                    {t(link.key)}
                  </Link>
                ))}
              </div>
            </li>
          </ul>
        </div>
      </div>
    </header>
  );
}
