/**
 * CartDrawer — the reference's `#drawer` + `renderDrawer()` (oshoppingbd.html
 * L252-300, L782).
 *
 * The highest-risk interactive surface on the storefront, so the rules are
 * explicit:
 *
 * 1. **Never auto-opens.** Adding to cart fires a toast; the drawer is opened
 *    only by an explicit click (Phase 2 constraint). The reference does the
 *    same, and it is the difference between a shop and a nag.
 * 2. **Scroll position survives re-render.** The reference re-renders the whole
 *    drawer innerHTML on every quantity change and then *manually restores*
 *    `scrollLeft` / `scrollTop` (L782, `renderDrawer(keep)`). That is a bug
 *    being papered over. Here React keeps the DOM nodes, so scroll position is
 *    preserved by construction — but the "you may also like" carousel is keyed
 *    separately so a quantity change cannot remount it.
 * 3. **Quantity 0 removes the line.** Reference behaviour, and what a shopper
 *    expects from a stepper that reaches zero.
 * 4. **Escape closes; focus returns to the trigger.** The trigger is captured
 *    when the drawer opens (see `useFocusReturn`).
 * 5. **Body scroll locks while open**, with scrollbar compensation so the page
 *    does not jump.
 *
 * Money is integer poisha end to end; `formatMoney` is the only formatter.
 */

'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';

import { useCartStore, type CartLine } from '@/lib/store/cart-store';
import { useUiStore } from '@/lib/store/ui-store';
import { useLang, useBodyScrollLock, useEscapeKey, useFocusReturn } from '@/lib/hooks';
import { useEffectiveCart } from '@/lib/hooks/use-effective-cart';
import { removeCartItem, updateCartItem } from '@/lib/api/account';
import { cartTotals } from '@/lib/cart-totals';
import {
  amountToFreeDeliveryPoisha,
  freeDeliveryProgressPercent,
} from '@/lib/commerce';
import { formatMoney } from '@/lib/format';
import { MOCK_PRODUCTS } from '@/lib/mock';
import { cn } from '@/lib/utils';
import { toast } from '@/components/shared/toast';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { MiniProductCard } from '@/components/product/mini-product-card';
import { Carousel } from '@/components/shared/carousel';
import { CartIcon } from '@/components/ui/icons';

/** How many "you may also like" suggestions the drawer shows. */
const MAX_RELATED = 10;

export function CartDrawer() {
  const { lang, t, tu } = useLang();

  const open = useUiStore((s) => s.cartOpen);
  const closeCart = useUiStore((s) => s.closeCart);

  const cart = useEffectiveCart();
  const lines = cart.lines;
  const setQuantity = useCartStore((s) => s.setQuantity);
  const removeLine = useCartStore((s) => s.removeLine);

  const panelRef = useRef<HTMLElement>(null);

  useBodyScrollLock(open);
  useEscapeKey(closeCart, open);

  /**
   * Focus return: capture the trigger when the drawer opens, restore it when it
   * closes. `useFocusReturn` is a manual capture/restore pair (not automatic),
   * so both calls have to be wired — calling it bare does nothing, which is
   * exactly the bug the Phase 2 gate catches.
   */
  const { capture, restore } = useFocusReturn();

  const totals = useMemo(() => cartTotals(lines), [lines]);

  /**
   * Related products: in-stock items not already in the cart, ranked the way
   * the reference ranks them (`relCart()`, L780) — same category scores 3,
   * same brand 1.5, plus rating/1000 as a tiebreak.
   *
   * The reference scores against `p.c` / `p.b` on its flat product array. The
   * DTO exposes category/brand ids, so the comparison is by id.
   */
  const related = useMemo(() => {
    const inCart = new Set(lines.map((l) => l.productId));
    const categories = new Set<string>();
    const brands = new Set<string>();

    for (const product of MOCK_PRODUCTS) {
      if (inCart.has(product.id)) {
        categories.add(product.category.id);
        if (product.brand) brands.add(product.brand.id);
      }
    }

    return MOCK_PRODUCTS.filter(
      (p) => !inCart.has(p.id) && p.stockStatus !== 'out_of_stock',
    )
      .map((p) => ({
        product: p,
        score:
          (categories.has(p.category.id) ? 3 : 0) +
          (p.brand && brands.has(p.brand.id) ? 1.5 : 0) +
          p.rating / 1000,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RELATED)
      .map((x) => x.product);
  }, [lines]);

  const handleQuantityChange = useCallback(
    (line: CartLine, next: number) => {
      // Quantity 0 removes the line — reference behaviour.
      if (next <= 0) {
        if (line.serverLineId) {
          void removeCartItem(line.serverLineId)
            .then(() => cart.refresh())
            .catch(() => toast(tu('errorBody')));
          return;
        }
        removeLine(line.productId, line.variantId);
        return;
      }

      if (line.serverLineId) {
        void updateCartItem(line.serverLineId, next)
          .then(() => cart.refresh())
          .catch(() => toast(tu('errorBody')));
        return;
      }

      setQuantity(line.productId, line.variantId, next);
    },
    // `cart.refresh` is stable per render of the hook; the store actions are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [removeLine, setQuantity, tu],
  );

  const handleRemove = useCallback(
    (line: CartLine, name: string) => {
      if (line.serverLineId) {
        void removeCartItem(line.serverLineId)
          .then(() => {
            cart.refresh();
            toast(`${name} — ${tu('removeItem')}`);
          })
          .catch(() => toast(tu('errorBody')));
        return;
      }

      removeLine(line.productId, line.variantId);
      toast(`${name} — ${tu('removeItem')}`);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [removeLine, tu],
  );

  // Focus the panel when it opens so screen readers land inside the dialog,
  // and hand focus back to the trigger when it closes.
  useEffect(() => {
    if (!open) return;

    capture();

    const panel = panelRef.current;
    if (!panel) return;
    // The panel itself is not interactive; the first tab stop is the close button.
    const closeButton = panel.querySelector<HTMLElement>('[data-close-cart]');
    closeButton?.focus();

    return () => restore();
  }, [open, capture, restore]);

  const remaining = amountToFreeDeliveryPoisha(totals.subtotalPoisha);
  const progress = freeDeliveryProgressPercent(totals.subtotalPoisha);
  const qualifies = remaining === 0 && totals.lineCount > 0;

  return (
    <>
      {/* Overlay — clicking it closes the drawer. */}
      <div
        className={cn('ov', open && 'open')}
        onClick={closeCart}
        aria-hidden="true"
      />

      <aside
        id="drawer"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('cart')}
        aria-hidden={!open}
        className={cn(open && 'open')}
        // Keeps the panel out of the tab order while it is off-screen.
        inert={!open}
      >
        <div className="dr-h">
          <h3>
            {t('cart')}
            <em>{formatNumberSafe(totals.itemCount, lang)}</em>
          </h3>
          <button
            type="button"
            className="x"
            data-close-cart
            onClick={closeCart}
            aria-label={tu('close')}
          >
            ✕
          </button>
        </div>

        <div className="dr-b">
          {totals.lineCount > 0 ? (
            <>
              <div className="ship">
                {qualifies
                  ? `🎉 ${t('inc')}`
                  : t('moreMsg', { n: Math.round(remaining / 100) })}
                <div className="bar">
                  <i style={{ width: `${progress}%` }} />
                </div>
              </div>

              {lines.map((line) => {
                const name = lang === 'bn' ? line.nameBn : line.nameEn;
                const variantName =
                  lang === 'bn' ? line.variantNameBn : line.variantNameEn;
                const lineTotal = line.unitPricePoisha * line.quantity;

                return (
                  <div
                    key={`${line.productId}::${line.variantId ?? 'base'}`}
                    className="ci-row"
                  >
                    <Link
                      href={`/product/${line.slug}`}
                      className="im"
                      style={{ background: line.tint }}
                      onClick={closeCart}
                      tabIndex={-1}
                      aria-hidden="true"
                    >
                      {line.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- data-URI placeholder until real assets land.
                        <img
                          src={line.imageUrl}
                          alt=""
                          className="h-full w-full object-contain"
                          loading="lazy"
                        />
                      ) : (
                        (line.emoji ?? '🛍️')
                      )}
                    </Link>

                    <div>
                      <h5>{name}</h5>
                      {variantName && <div className="vr">{variantName}</div>}
                      <div className="up">
                        {formatMoney(line.unitPricePoisha, lang)}
                      </div>
                      <QuantityStepper
                        value={line.quantity}
                        onChange={(next) => handleQuantityChange(line, next)}
                        min={0}
                        max={line.stockQuantity > 0 ? line.stockQuantity : 1}
                        decreaseLabel={tu('decreaseQty')}
                        increaseLabel={tu('increaseQty')}
                        label={tu('quantity')}
                        size="sm"
                      />
                    </div>

                    <div className="rt">
                      <b>{formatMoney(lineTotal, lang)}</b>
                      <button
                        type="button"
                        className="rm"
                        onClick={() => handleRemove(line, name)}
                      >
                        {lang === 'bn' ? 'মুছুন' : 'Remove'}
                      </button>
                    </div>
                  </div>
                );
              })}

              {related.length > 0 && (
                <div className="rel">
                  <h4>{t('ymal')}</h4>
                  <Carousel
                    preset="per-mini"
                    label={t('ymal')}
                    previousLabel={tu('previous')}
                    nextLabel={tu('next')}
                  >
                    {related.map((product) => (
                      <MiniProductCard key={product.id} product={product} />
                    ))}
                  </Carousel>
                </div>
              )}
            </>
          ) : (
            <div className="empty">
              <div className="e">
                <CartIcon
                  style={{
                    width: 64,
                    height: 64,
                    margin: '0 auto',
                    stroke: 'currentColor',
                    fill: 'none',
                    strokeWidth: 1.4,
                  }}
                />
              </div>
              <p style={{ margin: '8px 0 16px' }}>{t('empty')}</p>
              <p style={{ fontSize: 13 }}>{tu('emptyCartBody')}</p>
            </div>
          )}
        </div>

        <div className="dr-f">
          <div className="row">
            <span>{t('sub')}</span>
            <b>{formatMoney(totals.subtotalPoisha, lang)}</b>
          </div>

          {totals.discountPoisha > 0 && (
            <div className="row disc">
              <span>{t('disc')}</span>
              <b>−{formatMoney(totals.discountPoisha, lang)}</b>
            </div>
          )}

          <div className="row">
            <span>{t('del')}</span>
            <b>
              {totals.deliveryFeePoisha
                ? formatMoney(totals.deliveryFeePoisha, lang)
                : t('free')}
            </b>
          </div>

          <div className="row tot">
            <span>{t('tot')}</span>
            <span>{formatMoney(totals.totalPoisha, lang)}</span>
          </div>

          <Link
            href="/checkout"
            className="btn red"
            aria-disabled={totals.lineCount === 0 || undefined}
            onClick={(event) => {
              // A Link cannot be `disabled`, so the guard is on the click. The
              // checkout page re-checks the cart anyway; this just avoids
              // navigating to an empty-checkout screen.
              if (totals.lineCount === 0) event.preventDefault();
              else closeCart();
            }}
            style={
              totals.lineCount === 0
                ? { pointerEvents: 'none', opacity: 0.55 }
                : undefined
            }
          >
            {t('chk')} →
          </Link>
          <button type="button" className="btn line" onClick={closeCart}>
            {t('cont')}
          </button>
        </div>
      </aside>
    </>
  );
}

/** Bangla digits for the item count badge, matching the reference's `nf()`. */
function formatNumberSafe(value: number, lang: 'en' | 'bn'): string {
  return new Intl.NumberFormat(lang === 'bn' ? 'bn-BD' : 'en-US').format(value);
}
