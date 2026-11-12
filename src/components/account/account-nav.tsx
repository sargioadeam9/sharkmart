/**
 * AccountNav — the shared sidebar for the account pages.
 *
 * One component so the three account routes cannot drift into three different
 * link sets, and so the active item is decided in one place.
 */

'use client';

import Link from 'next/link';

import { useLang } from '@/lib/hooks';
import { cn } from '@/lib/utils';

type NavKey = 'profile' | 'orders' | 'addresses';

export function AccountNav({ active }: { active: NavKey }) {
  const { tu } = useLang();

  const items: Array<{ key: NavKey; href: string; label: string }> = [
    { key: 'profile', href: '/profile', label: tu('profile') },
    { key: 'orders', href: '/orders', label: tu('myOrders') },
    { key: 'addresses', href: '/profile/addresses', label: tu('myAddresses') },
  ];

  return (
    <nav className="acct-panel" aria-label={tu('profile')}>
      <div className="acct-panel-body" style={{ padding: 8 }}>
        {items.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className={cn('acct-nav-link', active === item.key && 'is-active')}
            aria-current={active === item.key ? 'page' : undefined}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
