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

export default function ShopLayout({ children }: { children: ReactNode }) {
  return <StorefrontShell>{children}</StorefrontShell>;
}
