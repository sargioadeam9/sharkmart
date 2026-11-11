/**
 * /dev/shell — Phase 2 proof route.
 *
 * Not linked from the storefront. It exists to exercise the shell's riskiest
 * behaviour on demand, without needing a homepage:
 *
 * - Cart maths at the four gate values (৳0 / ৳1,999 / ৳2,000 / ৳50,000)
 * - Adding lines, changing quantity, removing
 * - Opening the drawer, the mobile category sheet, the support popup
 * - Switching language and watching every surface follow
 *
 * The gate values are seeded by buttons rather than typed by hand, so the
 * check is repeatable.
 */

'use client';

import { useMemo } from 'react';

import { MOCK_PRODUCTS } from '@/lib/mock';
import { useCartStore, cartItemCount } from '@/lib/store/cart-store';
import { useUiStore } from '@/lib/store/ui-store';
import { useLang } from '@/lib/hooks';
import { cartTotals } from '@/lib/cart-totals';
import { formatMoney } from '@/lib/format';
import { toCartLine } from '@/components/product/product-card';
import { toast } from '@/components/shared/toast';

/** A synthetic line so a gate value can be seeded exactly, to the poisha. */
function makeLine(unitPricePoisha: number, quantity: number, id: string) {
  return {
    productId: `gate_${id}`,
    slug: `gate-${id}`,
    sku: `GATE-${id}`,
    nameEn: `Gate line ${id}`,
    nameBn: `গেট লাইন ${id}`,
    imageUrl: null,
    emoji: '🧪',
    tint: '#F4E9DD',
    unitPricePoisha,
    originalUnitPricePoisha: 0,
    variantId: null,
    variantNameEn: null,
    variantNameBn: null,
    quantity,
    stockQuantity: 99,
  };
}

export default function ShellDevPage() {
  const { lang, t, tu } = useLang();

  const lines = useCartStore((s) => s.lines);
  const addLine = useCartStore((s) => s.addLine);
  const clear = useCartStore((s) => s.clear);

  const openCart = useUiStore((s) => s.openCart);
  const openSheet = useUiStore((s) => s.openSheet);

  const totals = useMemo(() => cartTotals(lines), [lines]);
  const count = cartItemCount(lines);

  const gates = [
    { label: '৳0 (empty)', run: () => clear() },
    { label: '৳1,999', run: () => { clear(); addLine(makeLine(199_900, 1, 'a')); } },
    { label: '৳2,000', run: () => { clear(); addLine(makeLine(200_000, 1, 'b')); } },
    { label: '৳50,000', run: () => { clear(); addLine(makeLine(5_000_000, 1, 'c')); } },
  ];

  return (
    <div className="wrap py-8">
      <header className="rounded-[20px] bg-white p-6 shadow-shop">
        <h1 className="text-[26px] font-extrabold tracking-[-0.02em] text-shop-navy">
          Shell — Phase 2
        </h1>
        <p className="mt-1 text-[13.5px] text-shop-muted">
          Header, nav, mega menu, drawer, footer, mobile chrome. Not linked from
          the storefront.
        </p>
      </header>

      <section className="mt-6 rounded-[20px] bg-white p-6 shadow-shop">
        <h2 className="text-[15px] font-bold text-shop-navy">
          Cart maths — the four gate values
        </h2>
        <p className="mt-1 text-[13px] text-shop-muted">
          Delivery is ৳0 at or above ৳2,000, ৳60 below it, and ৳0 on an empty
          cart.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {gates.map((gate) => (
            <button
              key={gate.label}
              type="button"
              className="btn line"
              style={{ padding: '8px 16px', fontSize: 13 }}
              onClick={gate.run}
            >
              {gate.label}
            </button>
          ))}
          <button
            type="button"
            className="btn red"
            style={{ padding: '8px 16px', fontSize: 13 }}
            onClick={openCart}
          >
            {tu('openCart')}
          </button>
          <button
            type="button"
            className="btn line"
            style={{ padding: '8px 16px', fontSize: 13 }}
            onClick={openSheet}
          >
            {t('allcat')}
          </button>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-x-8 gap-y-2 text-[13.5px] sm:grid-cols-3">
          <div className="flex justify-between border-b border-shop-line py-1">
            <dt className="text-shop-muted">lines</dt>
            <dd className="font-bold">{totals.lineCount}</dd>
          </div>
          <div className="flex justify-between border-b border-shop-line py-1">
            <dt className="text-shop-muted">items</dt>
            <dd className="font-bold">{count}</dd>
          </div>
          <div className="flex justify-between border-b border-shop-line py-1">
            <dt className="text-shop-muted">subtotal</dt>
            <dd className="font-bold">{formatMoney(totals.subtotalPoisha, lang)}</dd>
          </div>
          <div className="flex justify-between border-b border-shop-line py-1">
            <dt className="text-shop-muted">discount</dt>
            <dd className="font-bold">{formatMoney(totals.discountPoisha, lang)}</dd>
          </div>
          <div className="flex justify-between border-b border-shop-line py-1">
            <dt className="text-shop-muted">delivery</dt>
            <dd className="font-bold">
              {totals.deliveryFeePoisha
                ? formatMoney(totals.deliveryFeePoisha, lang)
                : t('free')}
            </dd>
          </div>
          <div className="flex justify-between border-b border-shop-line py-1">
            <dt className="text-shop-muted">total</dt>
            <dd className="font-bold">{formatMoney(totals.totalPoisha, lang)}</dd>
          </div>
        </dl>
      </section>

      <section className="mt-6 rounded-[20px] bg-white p-6 shadow-shop">
        <h2 className="text-[15px] font-bold text-shop-navy">Add real products</h2>
        <p className="mt-1 text-[13px] text-shop-muted">
          Adding fires a toast and updates both cart badges. It must not open the
          drawer.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {MOCK_PRODUCTS.slice(0, 6).map((product) => (
            <button
              key={product.id}
              type="button"
              className="btn-add"
              style={{ padding: '10px 16px', fontSize: 13 }}
              onClick={() => {
                addLine(toCartLine(product), 1);
                toast(
                  `${lang === 'bn' ? product.nameBn : product.nameEn} — ${t('addedT')}`,
                );
              }}
            >
              + {lang === 'bn' ? product.nameBn : product.nameEn}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
