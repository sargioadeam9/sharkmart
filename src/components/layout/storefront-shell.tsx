/**
 * StorefrontShell — composes the Phase 2 chrome around every storefront page.
 *
 * Order matters and mirrors the reference's DOM:
 *   TopBar → Header (main row + nav row + mega) → MobileHeader → page →
 *   Footer → BottomNav → FloatingButtons → CartDrawer → MobileCategorySheet
 *
 * The overlays are mounted last so they paint above the page, and both are
 * always mounted (not conditionally) so their slide transitions can run.
 *
 * Data: categories and products come from the mock layer here, at the shell
 * level, so the mega menu, the search suggestions and the drawer's "you may
 * also like" all read the same source. Phase 6 swaps `MOCK_*` for the API
 * client in one place.
 */

'use client';

import type { ReactNode } from 'react';

import { MOCK_CATEGORIES, MOCK_PRODUCTS } from '@/lib/mock';
import { TopBar } from './top-bar';
import { Header } from './header';
import { MobileHeader } from './mobile-header';
import { Footer } from './footer';
import { BottomNav } from './bottom-nav';
import { FloatingButtons } from './floating-buttons';
import { CartDrawer } from './cart-drawer';
import { MobileCategorySheet } from './mobile-category-sheet';
import { DocumentLanguage } from './document-language';
import { PreviewStrip } from './preview-strip';

export function StorefrontShell({ children }: { children: ReactNode }) {
  return (
    <>
      <DocumentLanguage />
      <PreviewStrip />
      <TopBar />
      <Header categories={MOCK_CATEGORIES} products={MOCK_PRODUCTS} />
      <MobileHeader categories={MOCK_CATEGORIES} products={MOCK_PRODUCTS} />

      <main id="main">{children}</main>

      <Footer categories={MOCK_CATEGORIES} />
      <BottomNav />
      <FloatingButtons />

      <CartDrawer />
      <MobileCategorySheet categories={MOCK_CATEGORIES} />
    </>
  );
}
