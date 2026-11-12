'use client';

/**
 * The cart the shopper actually has, whichever side of sign-in they are on.
 *
 * Before this hook, three surfaces disagreed:
 *
 *   - `/cart` read the *server* cart when signed in (correct).
 *   - The header badge and the drawer read the *local* store only.
 *
 * So after a guest cart merged at login, the local store was cleared (the
 * merge succeeded, so clearing is right) and the badge dropped to 0 while the
 * cart page still showed the item. The drawer said "Your cart is empty" over a
 * cart that had a line in it. One source, read in one place, is the fix.
 *
 * The shape returned is `CartLine` — the local store's type — because that is
 * what the drawer and the badge already render. A server line is adapted into
 * it once, here, rather than in each component.
 */

import { useEffect, useState } from 'react';
import { getCart } from '@/lib/api/account';
import { useCartStore, type CartLine } from '@/lib/store/cart-store';
import { useSessionStore } from '@/lib/store/session-store';
import type { ServerCart, ServerCartLine } from '@/types/account';

export type EffectiveCartStatus = 'loading' | 'ready' | 'failed';

export interface EffectiveCart {
  lines: CartLine[];
  itemCount: number;
  subtotalPoisha: number;
  /** True while the server cart is still being fetched for a signed-in user. */
  loading: boolean;
  /** True when the shopper is signed in, so the server is the source of truth. */
  signedIn: boolean;
  /** Server-only: a line is out of stock or no longer purchasable. */
  hasIssues: boolean;
  status: EffectiveCartStatus;
  /** Re-read the server cart after a mutation. No-op for a guest. */
  refresh: () => void;
}

/**
 * A server line → the drawer's line shape.
 *
 * `emoji` and `tint` are presentation-only and the server does not carry them,
 * so they get the same neutral values the card fallback uses. Everything that
 * affects money or identity is copied straight across.
 */
function fromServerLine(line: ServerCartLine): CartLine {
  return {
    productId: line.productId,
    slug: line.slug,
    sku: line.sku,
    nameEn: line.nameEn,
    nameBn: line.nameBn,
    imageUrl: line.imageUrl,
    emoji: null,
    tint: '#F4E9DD',
    unitPricePoisha: line.unitPricePoisha,
    originalUnitPricePoisha: line.originalUnitPricePoisha,
    variantId: line.variantId,
    variantNameEn: line.variantNameEn,
    variantNameBn: line.variantNameBn,
    quantity: line.quantity,
    stockQuantity: line.stockQuantity,
    serverLineId: line.id,
  };
}

export function useEffectiveCart(): EffectiveCart {
  const sessionStatus = useSessionStore((s) => s.status);
  const localLines = useCartStore((s) => s.lines);
  const serverRevision = useCartStore((s) => s.serverRevision);

  const signedIn = sessionStatus === 'authenticated';

  const [serverCart, setServerCart] = useState<ServerCart | null>(null);
  const [status, setStatus] = useState<EffectiveCartStatus>('loading');
  const [nonce, setNonce] = useState(0);

  /**
   * Drop the previous session's cart the moment the session flips.
   *
   * Adjusted during render, not in an effect: an effect would paint one frame
   * of the signed-out shopper's stale server cart after signing back in, and a
   * cart is money. `set-state-in-effect` also forbids the synchronous reset.
   */
  const [cartOwner, setCartOwner] = useState(signedIn);
  if (cartOwner !== signedIn) {
    setCartOwner(signedIn);
    setServerCart(null);
    setStatus('loading');
  }

  useEffect(() => {
    if (!signedIn) return;

    let cancelled = false;

    getCart()
      .then((cart) => {
        if (cancelled) return;
        setServerCart(cart);
        setStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setStatus('failed');
      });

    return () => {
      cancelled = true;
    };
  }, [signedIn, nonce, serverRevision]);

  const refresh = () => setNonce((n) => n + 1);

  if (!signedIn) {
    return {
      lines: localLines,
      itemCount: localLines.reduce((sum, line) => sum + line.quantity, 0),
      subtotalPoisha: localLines.reduce(
        (sum, line) => sum + line.unitPricePoisha * line.quantity,
        0,
      ),
      loading: false,
      signedIn: false,
      hasIssues: false,
      status: 'ready',
      refresh,
    };
  }

  const lines = (serverCart?.lines ?? []).map(fromServerLine);

  return {
    lines,
    itemCount: serverCart?.itemCount ?? 0,
    subtotalPoisha: serverCart?.subtotalPoisha ?? 0,
    loading: status === 'loading',
    signedIn: true,
    hasIssues: Boolean(serverCart?.hasIssues),
    status,
    refresh,
  };
}
