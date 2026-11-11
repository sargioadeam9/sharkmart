'use client';

/**
 * 404 boundary for the storefront.
 *
 * The reference's `nf404()` (oshoppingbd.html L717) is a `.nores` panel with a
 * compass emoji, a heading and a "back home" button. Same shape here, but it
 * uses the shared `EmptyState` so the copy, spacing and focus behaviour match
 * every other empty surface in the app.
 *
 * This file also covers `/category/[slug]` for an unknown slug, which is the
 * case the Phase 4 gate names: "Unknown slug must render the 404 state, not
 * crash."
 */

import Link from 'next/link';
import { useLang } from '@/lib/hooks';
import { EmptyState } from '@/components/shared/empty-state';
export default function NotFound() {
  const { tu } = useLang();

  return (
    <div className="wrap">
      <EmptyState
        tone="search"
        icon="🧭"
        title={tu('notFoundTitle')}
        body={tu('notFoundBody')}
        action={
          <Link className="btn red" href="/">
            {tu('backHome')}
          </Link>
        }
      />
    </div>
  );
}
