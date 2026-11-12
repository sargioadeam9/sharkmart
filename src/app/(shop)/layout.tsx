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

/**
 * `SessionProvider` wraps the whole storefront, not just the account routes.
 *
 * It has to: the header shows the signed-in name, the cart drawer needs to know
 * whether to merge, and the guest→account cart merge must run once on any page
 * a shopper lands on after signing in — not only if they happen to open
 * `/profile`.
 */
export default function ShopLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <StorefrontShell>{children}</StorefrontShell>
    </SessionProvider>
  );
}
