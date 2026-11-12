'use client';

/**
 * `/wishlist` — the guest wishlist.
 *
 * The store keeps ids only (`wishlist-store.ts`), so this page resolves them
 * against the API. That is deliberate: a wishlist is a set of references, and a
 * product that changed price must show the current price rather than a snapshot
 * from whenever it was saved.
 *
 * Guest-only for now. There is no server call and no auth: the ids live in
 * localStorage under `sharkmart.wishlist`. The login merge is Phase 8 — see the
 * `PHASE 8:` note at the hook point below.
 *
 * Resolution strategy: one `listProducts` read of the catalog, filtered to the
 * saved ids. The alternative — a request per id — is N round trips for a page
 * that is usually a handful of items, and the catalog read is already cached by
 * the server. An id that no longer exists simply does not come back, which is
 * the correct behaviour for a product that was delisted.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import type { ProductDto } from '@/types/catalog';
import { localized } from '@/types/catalog';
import { useLang, useStoreHydrated } from '@/lib/hooks';
import { listProducts } from '@/lib/api/products';
import { MAX_PAGE_LIMIT } from '@/lib/api/config';
import { useWishlistStore } from '@/lib/store/wishlist-store';
import { useCartStore } from '@/lib/store/cart-store';
import { formatMoney } from '@/lib/format';
import { toast } from '@/components/shared/toast';
import { EmptyState } from '@/components/shared/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { toCartLine } from '@/components/product/product-card';

type Status = 'idle' | 'ready' | 'failed';

export function WishlistPage() {
  const { lang, t, tu } = useLang();

  const ids = useWishlistStore((s) => s.ids);
  const remove = useWishlistStore((s) => s.remove);
  const addLine = useCartStore((s) => s.addLine);

  /**
   * Hydration gate. The store reads localStorage, which does not exist during
   * SSR — rendering the real list on the server would produce markup that
   * disagrees with the client and trip a hydration error. Until hydration
   * completes, show the skeleton.
   */
  const hydrated = useStoreHydrated(useWishlistStore);

  const [status, setStatus] = useState<Status>('idle');
  /**
   * Bumped by the retry button. The effect's real trigger is `ids.length`, so
   * a failed read could not otherwise be retried: setting `status` back to
   * `idle` changes nothing the effect depends on.
   */
  const [retryNonce, setRetryNonce] = useState(0);
  const [catalog, setCatalog] = useState<ProductDto[]>([]);

  /**
   * Load the catalog once, then resolve ids against it locally.
   *
   * Fetching the whole catalog rather than one request per id means adding or
   * removing an item never refetches: the page already holds every product it
   * could need to show.
   *
   * It must page: the catalog is larger than `MAX_PAGE_LIMIT` (168 products vs a
   * 100 cap), so a single read silently omitted every product past the first
   * hundred and a saved item from that half rendered as "wishlist is empty".
   * The loop is bounded by the server's own `total` and a hard ceiling, so a
   * pathological catalog cannot spin here.
   */
  useEffect(() => {
    if (!hydrated || ids.length === 0) return;

    let cancelled = false;

    (async () => {
      const all: ProductDto[] = [];
      const CEILING = 10; // 10 × 100 = 1,000 products; far past any real catalog.

      for (let page = 1; page <= CEILING; page++) {
        const response = await listProducts({ limit: MAX_PAGE_LIMIT, page });
        all.push(...response.data);

        const total = response.meta?.total ?? all.length;
        if (response.data.length === 0 || all.length >= total) break;
      }

      return all;
    })()
      .then((all) => {
        if (cancelled) return;
        setCatalog(all);
        setStatus('ready');

        /**
         * Prune ids that no longer resolve.
         *
         * A saved id can outlive its product: the catalog was reseeded, or the
         * id was written while the mock layer was still live (`prd_osb-1001`).
         * Leaving it in the store makes the header badge claim two saved items
         * while the page can only show one — a count that disagrees with the
         * list is a bug, not a rounding error.
         *
         * Only safe after a COMPLETE read: `all` is the whole catalog here, so
         * an id missing from it genuinely does not exist. If the read had
         * failed we would be in the catch above and nothing is pruned.
         */
        const live = new Set(all.map((p) => p.id));
        const stale = ids.filter((id) => !live.has(id));
        if (stale.length > 0) {
          for (const id of stale) remove(id);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setStatus('failed');
      });

    return () => {
      cancelled = true;
    };
    // `ids.length` is the trigger, not `ids`: adding a second product must not
    // refetch a catalog already in hand. Only the empty → non-empty transition
    // needs a load. `retryNonce` is the explicit retry lever.
  }, [hydrated, ids.length, retryNonce]);

  /** Saved ids in the order they were added, resolved to products. */
  const items = useMemo(() => {
    if (catalog.length === 0) return [];
    const byId = new Map(catalog.map((p) => [p.id, p]));
    return ids.map((id) => byId.get(id)).filter((p): p is ProductDto => Boolean(p));
  }, [catalog, ids]);

  const moveToCart = useCallback(
    (product: ProductDto) => {
      if (product.stockStatus === 'out_of_stock') return;

      addLine(toCartLine(product), 1);
      remove(product.id);
      toast(`${localized(lang, product.nameEn, product.nameBn)} — ${t('addedT')}`);
    },
    [addLine, remove, lang, t],
  );

  const handleRemove = useCallback(
    (product: ProductDto) => {
      remove(product.id);
      toast(tu('removedFromWishlist'));
    },
    [remove, tu],
  );

  // ── states ───────────────────────────────────────────────────────────────

  /**
   * Loading is derived, not stored: `status` only records an outcome, and
   * setting it synchronously inside the effect is the cascading render the
   * rule forbids. A non-empty wishlist with no outcome yet is still loading.
   */
  const loading = hydrated && ids.length > 0 && status === 'idle';

  if (!hydrated || (loading && items.length === 0)) {
    return (
      <div className="wrap" aria-busy="true">
        <div className="cat-grid">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[320px] w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className="wrap">
        <EmptyState
          tone="error"
          title={tu('errorTitle')}
          body={tu('errorBody')}
          action={
            <button
              type="button"
              className="btn red"
              onClick={() => {
                setStatus('idle');
                setRetryNonce((n) => n + 1);
              }}
            >
              {tu('retry')}
            </button>
          }
        />
      </div>
    );
  }

  if (ids.length === 0 || items.length === 0) {
    return (
      <div className="wrap">
        <EmptyState
          tone="empty"
          title={tu('emptyWishlist')}
          body={tu('emptyWishlistBody')}
          action={
            <Link className="btn red" href="/">
              {tu('browseAll')}
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="wrap">
      <h1 className="sec-t" style={{ marginTop: 18 }}>
        {t('wish')}
      </h1>

      <ul className="cat-grid" style={{ listStyle: 'none', padding: 0 }}>
        {items.map((product) => {
          const name = localized(lang, product.nameEn, product.nameBn);
          const main = product.images.find((i) => i.isMain) ?? product.images[0];
          const isOut = product.stockStatus === 'out_of_stock';

          return (
            <li key={product.id} className="pc">
              <Link href={`/product/${product.slug}`} className="pc-img">
                {main ? (
                  // eslint-disable-next-line @next/next/no-img-element -- data-URI placeholder; next/image lands with real assets.
                  <img
                    src={main.url}
                    alt={localized(lang, main.altEn, main.altBn)}
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <span className="emo" aria-hidden="true">
                    🛍️
                  </span>
                )}
                {isOut && <span className="oos">{t('out')}</span>}
              </Link>

              <div className="pc-b">
                <Link href={`/product/${product.slug}`} className="pc-n">
                  {name}
                </Link>

                <div className="pc-p">
                  <b>{formatMoney(product.pricePoisha, lang)}</b>
                  {product.originalPricePoisha > product.pricePoisha && (
                    <s>{formatMoney(product.originalPricePoisha, lang)}</s>
                  )}
                </div>

                <div className="flex gap-2" style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    className="btn red"
                    onClick={() => moveToCart(product)}
                    disabled={isOut}
                  >
                    {isOut ? t('out') : t('add')}
                  </button>

                  <button
                    type="button"
                    className="btn"
                    onClick={() => handleRemove(product)}
                    aria-label={`${tu('removeFromWishlist')} — ${name}`}
                  >
                    {tu('removeFromWishlist')}
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {/*
        PHASE 8: this is the hook point for the guest → logged-in merge.
        When auth lands, an authenticated visitor's ids must be POSTed to the
        server here (or on session establishment) and the local list cleared
        only after the server confirms, so a failed merge cannot lose a saved
        product. Do not build it before the session exists.
      */}
    </div>
  );
}
