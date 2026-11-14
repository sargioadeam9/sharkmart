/**
 * BottomNav — the reference's `.bnav` (oshoppingbd.html L507-511, markup L616).
 *
 * Fixed to the bottom below 760px: Home, Categories, Search, Wishlist, Account.
 * Five items, active state on the current route, and `env(safe-area-inset-bottom)`
 * padding so it clears the home indicator on an iPhone.
 *
 * The footer reserves 70px of bottom padding on mobile (`.fg` / `footer`) so
 * this bar never covers the copyright line — that is the Phase 2 gate item.
 */

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useUiStore } from '@/lib/store/ui-store';
import { useLang } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import {
  GridIcon,
  HeartIcon,
  HomeIcon,
  SearchIcon,
  UserIcon,
} from '@/components/ui/icons';

export function BottomNav() {
  const { t } = useLang();
  const pathname = usePathname();

  const openSheet = useUiStore((s) => s.openSheet);

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <nav className="bnav" aria-label="Mobile">
      <Link href="/" className={cn(isActive('/') && 'on')}>
        <HomeIcon />
        {t('home')}
      </Link>

      <button type="button" onClick={openSheet}>
        <GridIcon />
        {t('catg')}
      </button>

      {/* The reference scrolls to the header search and focuses it. */}
      <button
        type="button"
        onClick={() => {
          const input = document.querySelector<HTMLInputElement>(
            '.mhd .search input',
          );
          window.scrollTo(0, 0);
          input?.focus();
        }}
      >
        <SearchIcon />
        {t('srch')}
      </button>

      <Link href="/wishlist" className={cn(isActive('/wishlist') && 'on')}>
        <HeartIcon />
        {t('wish')}
      </Link>

      {/*
        `/profile`, not `/account`. The tab is labelled "Account" but the route
        that holds it is `/profile` — the link pointed at a page that has never
        existed, so the most-used tab on a phone was a 404.
      */}
      <Link href="/profile" className={cn(isActive('/profile') && 'on')}>
        <UserIcon />
        {t('acc')}
      </Link>
    </nav>
  );
}
