/**
 * Storefront route group layout.
 *
 * Everything inside `(shop)` gets the Phase 2 chrome. `/admin` (Phase 9) will
 * live in its own route group with its own shell, which is why this is a group
 * and not the root layout.
 *
 * The root layout keeps only `<html>`, `<body>`, fonts and the Toaster.
 */

import type { ReactNode } from 'react';
import { StorefrontShell } from '@/components/layout/storefront-shell';
import { SessionProvider } from '@/components/providers/session-provider';
import { StoreProvider } from '@/components/providers/store-provider';
import { fetchStoreProfile } from '@/lib/api/public-settings';

/**
 * `SessionProvider` wraps the whole storefront, not just the account routes.
 *
 * It has to: the header shows the signed-in name, the cart drawer needs to know
 * whether to merge, and the guest→account cart merge must run once on any page
 * a shopper lands on after signing in — not only if they happen to open
 * `/profile`.
 */
export default async function ShopLayout({ children }: { children: ReactNode }) {
  /**
   * One fetch, at the top of the tree, so the header, footer, cart drawer and
   * checkout all read the same store name and the same delivery numbers.
   *
   * `fetchStoreProfile` never throws and falls back to the constants, and the
   * request is revalidated rather than `no-store`, so the storefront stays
   * static/ISR instead of going dynamic for every visitor.
   */
  const store = await fetchStoreProfile();

  return (
    <StoreProvider value={store}>
      <SessionProvider>
        <StorefrontShell>{children}</StorefrontShell>
      </SessionProvider>
    </StoreProvider>
  );
}
