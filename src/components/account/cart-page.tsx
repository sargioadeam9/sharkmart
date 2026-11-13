/**
 * `/cart` — the full cart page.
 *
 * The storefront has two carts and this page has to speak both:
 *
 *   - **Guest**: lines live in `cart-store` (localStorage). Everything renders
 *     from local state, no network.
 *   - **Signed in**: the server is the cart (`/cart`). It re-prices every line
 *     from the DB and flags `insufficientStock` / `unavailable`, which the local
 *     store cannot know.
 *
 * The signed-in path is authoritative for money. When a session exists, the
 * local store is a stale cache of what the shopper added before signing in —
 * the SessionProvider has already pushed it up and cleared it, so this page
 * reads the server and never the local blob.
 *
 * Checkout is blocked on `hasIssues`. Sending a cart with a sold-out line to
 * `/checkout` would produce a 409 the shopper cannot act on from the error
 * message alone; blocking here, with the offending line marked, is the same
 * information at the point where it can be fixed.
 */

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import type { ServerCart, ServerCartLine } from '@/types/account';
import { useLang, useStoreHydrated } from '@/lib/hooks';
import { useCartStore, type CartLine } from '@/lib/store/cart-store';
import { useSessionStore } from '@/lib/store/session-store';
import {
  getCart,
  removeCartItem,
  updateCartItem,
} from '@/lib/api/account';
import { cartTotals } from '@/lib/cart-totals';
import { deliveryFeePoisha } from '@/lib/commerce';
import { useStore } from '@/components/providers/store-provider';
import { formatMoney } from '@/lib/format';
import { localized } from '@/types/catalog';
import { toast } from '@/components/shared/toast';
import { EmptyState } from '@/components/shared/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { cn } from '@/lib/utils';

type Status = 'loading' | 'ready' | 'failed';

export function CartPage() {
  const store = useStore();
  const { lang, t, tu } = useLang();

  const sessionStatus = useSessionStore((s) => s.status);
  const hydrated = useStoreHydrated(useCartStore);

  const localLines = useCartStore((s) => s.lines);
  const setLocalQuantity = useCartStore((s) => s.setQuantity);
  const removeLocalLine = useCartStore((s) => s.removeLine);

  const [serverCart, setServerCart] = useState<ServerCart | null>(null);
  const [serverStatus, setServerStatus] = useState<Status>('loading');
  const [busyLine, setBusyLine] = useState<string | null>(null);

  const signedIn = sessionStatus === 'authenticated';

  /**
   * Drop the previous session's cart the moment the session flips.
   *
   * Adjusted during render, not in an effect: an effect would paint one frame
   * of the signed-out shopper's old server cart after signing back in, and a
   * cart is money. `set-state-in-effect` also forbids the synchronous reset.
   */
  const [cartOwner, setCartOwner] = useState(signedIn);
  if (cartOwner !== signedIn) {
    setCartOwner(signedIn);
    setServerCart(null);
    setServerStatus('loading');
  }

  // ── load the server cart when signed in ────────────────────────────────
  useEffect(() => {
    if (sessionStatus === 'unknown' || !signedIn) return;

    let cancelled = false;

    getCart()
      .then((cart) => {
        if (cancelled) return;
        setServerCart(cart);
        setServerStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setServerStatus('failed');
      });

    return () => {
      cancelled = true;
    };
  }, [signedIn, sessionStatus]);

  /** A guest has no server cart; the local store is the cart, already ready. */
  const status: Status = signedIn ? serverStatus : 'ready';

  // ── derived money ──────────────────────────────────────────────────────
  const localTotals = useMemo(() => cartTotals(localLines, store.delivery), [localLines, store.delivery]);

  const subtotal = signedIn ? (serverCart?.subtotalPoisha ?? 0) : localTotals.subtotalPoisha;
  const itemCount = signedIn ? (serverCart?.itemCount ?? 0) : localTotals.itemCount;
  const delivery = deliveryFeePoisha(subtotal, store.delivery);
  const total = subtotal + delivery;

  const hasIssues = signedIn ? Boolean(serverCart?.hasIssues) : false;
  const isEmpty = signedIn ? (serverCart?.lines.length ?? 0) === 0 : localLines.length === 0;

  // ── mutations ──────────────────────────────────────────────────────────

  const handleServerQuantity = useCallback(
    async (line: ServerCartLine, next: number) => {
      setBusyLine(line.id);
      try {
        const cart =
          next <= 0
            ? await removeCartItem(line.id)
            : await updateCartItem(line.id, next);
        setServerCart(cart);
      } catch {
        toast(tu('errorBody'));
      } finally {
        setBusyLine(null);
      }
    },
    [tu],
  );

  const handleServerRemove = useCallback(
    async (line: ServerCartLine) => {
      setBusyLine(line.id);
      try {
        setServerCart(await removeCartItem(line.id));
        toast(`${localized(lang, line.nameEn, line.nameBn)} — ${tu('removeItem')}`);
      } catch {
        toast(tu('errorBody'));
      } finally {
        setBusyLine(null);
      }
    },
    [lang, tu],
  );

  // ── states ─────────────────────────────────────────────────────────────

  if (sessionStatus === 'unknown' || !hydrated || (signedIn && status === 'loading')) {
    return (
      <div className="wrap acct-page" aria-busy="true">
        <Skeleton className="h-[280px] w-full" />
      </div>
    );
  }

  if (signedIn && status === 'failed') {
    return (
      <div className="wrap acct-page">
        <EmptyState
          tone="error"
          title={tu('errorTitle')}
          body={tu('errorBody')}
          action={
            <button type="button" className="btn red" onClick={() => window.location.reload()}>
              {tu('retry')}
            </button>
          }
        />
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="wrap acct-page">
        <EmptyState
          tone="empty"
          title={tu('cartEmpty')}
          body={tu('cartEmptyBody')}
          action={
            <Link className="btn red" href="/">
              {tu('continueShopping')}
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="wrap acct-page">
      <div className="acct-head">
        <h1>{tu('cartTitle')}</h1>
      </div>

      <div className="acct-split">
        {/* ── lines ───────────────────────────────────────────────────── */}
        <div className="acct-panel">
          {signedIn
            ? serverCart!.lines.map((line) => (
                <ServerLine
                  key={line.id}
                  line={line}
                  busy={busyLine === line.id}
                  onQuantityChange={(next) => void handleServerQuantity(line, next)}
                  onRemove={() => void handleServerRemove(line)}
                />
              ))
            : localLines.map((line) => (
                <LocalLine
                  key={`${line.productId}::${line.variantId ?? 'base'}`}
                  line={line}
                  onQuantityChange={(next) =>
                    setLocalQuantity(line.productId, line.variantId, next)
                  }
                  onRemove={() => removeLocalLine(line.productId, line.variantId)}
                />
              ))}
        </div>

        {/* ── summary ─────────────────────────────────────────────────── */}
        <aside className="acct-aside">
          <div className="acct-panel">
            <div className="acct-panel-head">
              <h2>{tu('cartSummary')}</h2>
              <span className="acct-muted">
                {itemCount} {tu('items')}
              </span>
            </div>

            <div className="acct-panel-body">
              <div className="acct-rows">
                <div className="acct-row">
                  <span>{t('sub')}</span>
                  <b>{formatMoney(subtotal, lang)}</b>
                </div>
                <div className="acct-row">
                  <span>{t('del')}</span>
                  <b>{delivery ? formatMoney(delivery, lang) : t('free')}</b>
                </div>
                <div className="acct-row acct-row-total">
                  <span>{t('tot')}</span>
                  <span>{formatMoney(total, lang)}</span>
                </div>
              </div>

              {hasIssues && (
                <p className="acct-line-warn" style={{ marginTop: 14 }}>
                  {tu('outOfStockError')}
                </p>
              )}

              <div className="acct-actions" style={{ flexDirection: 'column' }}>
                {hasIssues ? (
                  <button type="button" className="btn red" disabled>
                    {tu('proceedToCheckout')}
                  </button>
                ) : (
                  <Link className="btn red" href="/checkout">
                    {tu('proceedToCheckout')}
                  </Link>
                )}

                <Link className="btn line" href="/">
                  {tu('continueShopping')}
                </Link>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ─── line renderers ──────────────────────────────────────────────────────

function ServerLine({
  line,
  busy,
  onQuantityChange,
  onRemove,
}: {
  line: ServerCartLine;
  busy: boolean;
  onQuantityChange: (next: number) => void;
  onRemove: () => void;
}) {
  const { lang, tu } = useLang();
  const name = localized(lang, line.nameEn, line.nameBn);
  const variantName = localized(lang, line.variantNameEn, line.variantNameBn);

  return (
    <div className={cn('acct-line', busy && 'opacity-60')}>
      <Link href={`/product/${line.slug}`} className="acct-line-img" aria-hidden="true" tabIndex={-1}>
        {line.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- data-URI placeholder until real assets land.
          <img src={line.imageUrl} alt="" loading="lazy" />
        ) : (
          '🛍️'
        )}
      </Link>

      <div>
        <Link href={`/product/${line.slug}`} className="acct-line-name">
          {name}
        </Link>
        {variantName && <div className="acct-line-variant">{variantName}</div>}

        <div className="acct-line-price">
          {formatMoney(line.unitPricePoisha, lang)}
          {line.originalUnitPricePoisha > line.unitPricePoisha && (
            <s>{formatMoney(line.originalUnitPricePoisha, lang)}</s>
          )}
        </div>

        {line.unavailable && <div className="acct-line-warn">{tu('itemUnavailable')}</div>}
        {!line.unavailable && line.insufficientStock && (
          <div className="acct-line-warn">
            {tu('itemInsufficientStock', { n: line.stockQuantity })}
          </div>
        )}

        <div style={{ marginTop: 10 }}>
          <QuantityStepper
            value={line.quantity}
            onChange={onQuantityChange}
            min={0}
            max={Math.max(1, line.stockQuantity)}
            decreaseLabel={tu('decreaseQty')}
            increaseLabel={tu('increaseQty')}
            label={tu('quantity')}
            size="sm"
          />
        </div>
      </div>

      <div className="acct-line-right">
        <span className="acct-line-total">
          {formatMoney(line.unitPricePoisha * line.quantity, lang)}
        </span>
        <button type="button" className="acct-line-remove" onClick={onRemove} disabled={busy}>
          {tu('removeFromCart')}
        </button>
      </div>
    </div>
  );
}

function LocalLine({
  line,
  onQuantityChange,
  onRemove,
}: {
  line: CartLine;
  onQuantityChange: (next: number) => void;
  onRemove: () => void;
}) {
  const { lang, tu } = useLang();
  const name = localized(lang, line.nameEn, line.nameBn);
  const variantName = localized(lang, line.variantNameEn, line.variantNameBn);

  return (
    <div className="acct-line">
      <Link href={`/product/${line.slug}`} className="acct-line-img" aria-hidden="true" tabIndex={-1}>
        {line.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- data-URI placeholder until real assets land.
          <img src={line.imageUrl} alt="" loading="lazy" />
        ) : (
          (line.emoji ?? '🛍️')
        )}
      </Link>

      <div>
        <Link href={`/product/${line.slug}`} className="acct-line-name">
          {name}
        </Link>
        {variantName && <div className="acct-line-variant">{variantName}</div>}

        <div className="acct-line-price">
          {formatMoney(line.unitPricePoisha, lang)}
          {line.originalUnitPricePoisha > line.unitPricePoisha && (
            <s>{formatMoney(line.originalUnitPricePoisha, lang)}</s>
          )}
        </div>

        <div style={{ marginTop: 10 }}>
          <QuantityStepper
            value={line.quantity}
            onChange={onQuantityChange}
            min={0}
            max={Math.max(1, line.stockQuantity)}
            decreaseLabel={tu('decreaseQty')}
            increaseLabel={tu('increaseQty')}
            label={tu('quantity')}
            size="sm"
          />
        </div>
      </div>

      <div className="acct-line-right">
        <span className="acct-line-total">
          {formatMoney(line.unitPricePoisha * line.quantity, lang)}
        </span>
        <button type="button" className="acct-line-remove" onClick={onRemove}>
          {tu('removeFromCart')}
        </button>
      </div>
    </div>
  );
}
