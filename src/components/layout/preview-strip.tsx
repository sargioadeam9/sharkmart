'use client';

/**
 * PreviewStrip — the reference's `.pv` bar (oshoppingbd.html L28-32, markup
 * L606). Phase 3 spec item #1: "dev-only, removable via env flag".
 *
 * It is a developer navigation strip — jump to Home / Category / Product /
 * Brand, open the cart, with a "preview only" note. It is useful while building
 * and must never reach a customer, so it renders only when
 * `NEXT_PUBLIC_SHOW_PREVIEW_STRIP` is exactly `"true"`. Unset (the default, and
 * what `.env.example` ships) means the component returns null and the strip is
 * absent from the DOM entirely — not hidden with CSS.
 *
 * The reference's version links to hash routes and a `data-open-cart` button.
 * Production uses real paths and the Phase 2 cart store, so the links are real
 * hrefs and the cart button calls the store directly.
 */

import Link from 'next/link';

import { useLang } from '@/lib/hooks';
import { useUiStore } from '@/lib/store/ui-store';

/** Read at module scope: NEXT_PUBLIC_ vars are inlined at build time. */
const ENABLED = process.env.NEXT_PUBLIC_SHOW_PREVIEW_STRIP === 'true';

export function PreviewStrip() {
  const { t } = useLang();
  const openCart = useUiStore((state) => state.openCart);

  if (!ENABLED) return null;

  return (
    <div className="pv">
      <div className="wrap">
        <b>{t('dp')}</b>
        <Link href="/">{t('home2')}</Link>
        <Link href="/category/fashion">Category</Link>
        <Link href="/product/4">Product</Link>
        <Link href="/brand/fashion">Brand</Link>
        <button type="button" onClick={openCart}>
          {t('cart')}
        </button>
        <span>{t('demo')}</span>
      </div>
    </div>
  );
}
