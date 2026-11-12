/**
 * SessionProvider — resolves the session once, on mount, and does the guest
 * cart merge.
 *
 * Two jobs, both of which have to happen exactly once per page load:
 *
 * 1. **Resolve `/me`.** The cookie is HttpOnly, so the only way to know whether
 *    a visitor is signed in is to ask the server. This runs in an effect, not
 *    during render, so the server-rendered HTML is the signed-out state and the
 *    header swaps after hydration instead of mismatching.
 *
 * 2. **Merge the guest cart.** A shopper who added items before signing in has
 *    them in localStorage. On the first authenticated resolution, those lines
 *    are POSTed to `/cart/sync` and the local store is cleared *only after the
 *    server confirms*. If the merge fails the local cart survives, which is the
 *    difference between a retry and a lost sale.
 *
 * The merge is guarded by a module-level flag, not React state: two providers
 * (or a Fast Refresh remount) must not push the same cart twice, and the server
 * merge is idempotent by (product, variant) anyway — but the flag keeps the
 * request count honest.
 */

'use client';

import { useEffect, useRef } from 'react';

import { useSessionStore } from '@/lib/store/session-store';
import { useCartStore } from '@/lib/store/cart-store';
import { useUiStore } from '@/lib/store/ui-store';
import { tUi } from '@/lib/i18n/ui';
import { toast } from '@/components/shared/toast';
import { syncCart } from '@/lib/api/account';

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const status = useSessionStore((s) => s.status);
  const reload = useSessionStore((s) => s.reload);

  const merged = useRef(false);

  // ── Resolve the session once ──────────────────────────────────────────
  useEffect(() => {
    if (status !== 'unknown') return;
    void reload();
  }, [status, reload]);

  // ── Merge the guest cart after sign-in ────────────────────────────────
  useEffect(() => {
    if (status !== 'authenticated' || merged.current) return;
    merged.current = true;

    const lines = useCartStore.getState().lines;
    if (lines.length === 0) return;

    void (async () => {
      try {
        const result = await syncCart(
          lines.map((line) => ({
            productId: line.productId,
            variantId: line.variantId,
            quantity: line.quantity,
          })),
        );

        /**
         * Clear the local cart only when the server took every line.
         *
         * `skipped` is the server's own count of lines it could not store. The
         * old code cleared unconditionally, so a merge that stored nothing
         * (which is exactly what happened while variant ids were display
         * labels) still wiped the shopper's cart. A partial merge keeps the
         * local lines: the authenticated UI reads the server cart, so a
         * leftover local line is invisible, while a cleared one is gone.
         *
         * The count is also told to the shopper. A silent partial merge is the
         * same failure in a quieter costume: the line is still there locally,
         * but the account cart is short and nothing says why.
         */
        const lang = useUiStore.getState().lang;

        if (result.skipped === 0) {
          useCartStore.getState().clear();
          toast(tUi(lang, 'cartMerged'));
        } else {
          toast(tUi(lang, 'cartMergePartial', { count: result.skipped }), 'info');
        }

        /**
         * Tell every server-cart reader to re-read.
         *
         * The merge and `useEffectiveCart`'s fetch both start when the session
         * flips to authenticated, so the fetch can win the race and cache the
         * pre-merge (empty) cart. Without this the badge stayed at 0 and the
         * drawer said "empty" over a cart the server had just filled.
         */
        useCartStore.getState().bumpServerRevision();
      } catch {
        // Keep the local cart. The next authenticated load retries.
        merged.current = false;
      }
    })();
  }, [status]);

  return <>{children}</>;
}
