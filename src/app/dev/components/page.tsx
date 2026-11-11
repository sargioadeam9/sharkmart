'use client';

/**
 * /dev/components — the Phase 1 gate proof.
 *
 * Renders every component in every state, in both languages, at every
 * breakpoint. This route is a development surface: it is not linked from the
 * storefront, and Phase 12 removes it (or gates it behind NODE_ENV).
 *
 * Why a client page: the whole point is to exercise live state — a button that
 * is actually loading, a cart that actually persists, a toast that actually
 * fires. A static storybook would prove the markup compiles, not that the
 * behaviour works.
 */

import { useMemo, useState } from 'react';
import { MOCK_CATEGORIES, MOCK_BRANDS, MOCK_PRODUCTS } from '@/lib/mock';
import { useLang, useStoreHydrated } from '@/lib/hooks';
import { useCartStore, cartItemCount } from '@/lib/store/cart-store';
import { useWishlistStore } from '@/lib/store/wishlist-store';
import { cn } from '@/lib/utils';

import { Button, AddToCartButton, useAddToCartState } from '@/components/ui/button';
import { Badge, CountBadge } from '@/components/ui/badge';
import { StarRating } from '@/components/ui/star-rating';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { Chip } from '@/components/ui/chip';
import {
  Skeleton,
  ProductCardSkeleton,
  BrandTileSkeleton,
  CategoryCardSkeleton,
  RowSkeleton,
} from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { Carousel } from '@/components/shared/carousel';
import { Modal } from '@/components/shared/modal';
import { MobileSheet } from '@/components/shared/mobile-sheet';
import { SearchBar } from '@/components/shared/search-bar';
import { toast } from '@/components/shared/toast';
import { ProductCard } from '@/components/product/product-card';
import { CategoryCard } from '@/components/product/category-card';
import { BrandTile } from '@/components/product/brand-tile';
import { MiniProductCard } from '@/components/product/mini-product-card';

/* ─────────────────────────────── helpers ─────────────────────────────── */

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10 border-t border-shop-line pt-8">
      <h2 className="text-[20px] font-extrabold tracking-[-0.02em] text-shop-navy">
        {title}
      </h2>
      {note && <p className="mt-1 text-[13px] text-shop-muted">{note}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

function StateLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-shop-muted">
      {children}
    </div>
  );
}

/* ─────────────────────────────── page ────────────────────────────────── */

export default function ComponentsDevPage() {
  const { lang, toggleLang, t, tu } = useLang();

  const cartLines = useCartStore((s) => s.lines);
  const clearCart = useCartStore((s) => s.clear);
  const wishIds = useWishlistStore((s) => s.ids);
  const clearWishlist = useWishlistStore((s) => s.clear);

  const [modalOpen, setModalOpen] = useState(false);

  // Zustand's persist middleware rehydrates in an effect after mount. Until it
  // has run the store holds its server snapshot (empty), and rendering the real
  // values before then would be a hydration mismatch. `useStoreHydrated`
  // subscribes to the hydration flag itself, so the first paint is the server
  // snapshot and the swap happens in the same tick the store finishes.
  const hydrated = useStoreHydrated(useCartStore);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [qty, setQty] = useState(1);
  const [chipOn, setChipOn] = useState('fashion');
  const [demoAddState, runDemoAdd] = useAddToCartState();

  const products = useMemo(() => MOCK_PRODUCTS.slice(0, 12), []);
  const categories = useMemo(() => MOCK_CATEGORIES.slice(0, 7), []);
  const brands = useMemo(() => MOCK_BRANDS.slice(0, 8), []);

  const inStock = products.find((p) => p.stockStatus === 'in_stock');
  const lowStock = products.find((p) => p.stockStatus === 'low_stock');
  const outOfStock = products.find((p) => p.stockStatus === 'out_of_stock');
  const discounted = products.find((p) => p.discountPercent > 0);

  const categoryById = useMemo(
    () => new Map(categories.map((c) => [c.slug, c])),
    [categories],
  );

  return (
    <main className="wrap py-8">
      {/* ── header ─────────────────────────────────────────────────────── */}
      <header className="rounded-[20px] bg-white p-6 shadow-shop">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-[26px] font-extrabold tracking-[-0.02em] text-shop-navy">
              Component library — Phase 1
            </h1>
            <p className="mt-1 text-[13.5px] text-shop-muted">
              Every primitive, every state, both languages. Not linked from the
              storefront.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={toggleLang}>
              {lang === 'en' ? 'বাংলা' : 'English'}
            </Button>
            <Button
              variant="primary"
              onClick={() => toast(lang === 'en' ? 'Toast fired' : 'টোস্ট দেখানো হলো')}
            >
              Fire toast
            </Button>
            <Button
              variant="plain"
              className="border border-shop-line"
              onClick={() => {
                clearCart();
                clearWishlist();
                toast('Stores cleared');
              }}
            >
              Clear stores
            </Button>
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
          <div className="rounded-[12px] bg-shop-bg p-3">
            <dt className="text-shop-muted">Cart lines</dt>
            <dd className="text-[18px] font-extrabold text-shop-navy">
              {hydrated ? cartLines.length : '…'}
            </dd>
          </div>
          <div className="rounded-[12px] bg-shop-bg p-3">
            <dt className="text-shop-muted">Cart items</dt>
            <dd className="text-[18px] font-extrabold text-shop-navy">
              {hydrated ? cartItemCount(cartLines) : '…'}
            </dd>
          </div>
          <div className="rounded-[12px] bg-shop-bg p-3">
            <dt className="text-shop-muted">Wishlist</dt>
            <dd className="text-[18px] font-extrabold text-shop-navy">
              {hydrated ? wishIds.length : '…'}
            </dd>
          </div>
          <div className="rounded-[12px] bg-shop-bg p-3">
            <dt className="text-shop-muted">Language</dt>
            <dd className="text-[18px] font-extrabold text-shop-navy">
              {lang.toUpperCase()}
            </dd>
          </div>
        </dl>
      </header>

      {/* ── buttons ────────────────────────────────────────────────────── */}
      <Section
        title="Button"
        note=".btn.red / .btn.line / .btn-add / .btn.addl — normal, hover, active, loading, success, disabled."
      >
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <StateLabel>Variants</StateLabel>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary">{t('add')}</Button>
              <Button variant="outline">{t('viewall')}</Button>
              <Button variant="addOutline">{t('buy')}</Button>
              <Button variant="plain" className="border border-shop-line">
                {t('cont')}
              </Button>
            </div>
          </div>

          <div>
            <StateLabel>Sizes</StateLabel>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" size="sm">
                Small
              </Button>
              <Button variant="primary" size="md">
                Medium
              </Button>
              <Button variant="primary" size="lg">
                Large
              </Button>
            </div>
          </div>

          <div>
            <StateLabel>Loading / success / disabled</StateLabel>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" loading>
                {t('chk')}
              </Button>
              <Button variant="primary" success>
                {t('addedT')}
              </Button>
              <Button variant="primary" disabled>
                {t('out')}
              </Button>
            </div>
          </div>

          <div>
            <StateLabel>Add to cart — click to run the cycle</StateLabel>
            <div className="flex flex-wrap items-center gap-3">
              <AddToCartButton
                state={demoAddState}
                onClick={() => runDemoAdd(() => toast(t('addedT')))}
              >
                {t('add')}
              </AddToCartButton>
              <Button variant="add" disabled>
                {t('out')}
              </Button>
            </div>
          </div>
        </div>
      </Section>

      {/* ── badges + stars ─────────────────────────────────────────────── */}
      <Section title="Badge & StarRating" note="Discount pill, status pills, gradient star fill.">
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <StateLabel>Badge tones</StateLabel>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="discount">-25%</Badge>
              <Badge tone="new">New</Badge>
              <Badge tone="sale">Sale</Badge>
              <Badge tone="bestseller">Bestseller</Badge>
              <Badge tone="trending">Trending</Badge>
              <Badge tone="neutral">Neutral</Badge>
              <Badge tone="success">In stock</Badge>
              <Badge tone="warning">Low</Badge>
              <Badge tone="danger">Out</Badge>
            </div>
          </div>

          <div>
            <StateLabel>Count badge</StateLabel>
            <div className="flex items-center gap-8">
              <span className="relative inline-flex h-9 w-9 items-center justify-center rounded-full bg-shop-pink">
                <CountBadge count={3} />
              </span>
              <span className="relative inline-flex h-9 w-9 items-center justify-center rounded-full bg-shop-pink">
                <CountBadge count={128} />
              </span>
            </div>
          </div>

          <div>
            <StateLabel>Stars — 5, 4.5, 3.2, 0</StateLabel>
            <div className="flex flex-col gap-2">
              <StarRating rating={5} reviewCount={1284} />
              <StarRating rating={4.5} countLabel={t('ratings', { n: 412 })} />
              <StarRating rating={3.2} reviewCount={37} />
              <StarRating rating={0} reviewCount={0} />
              <StarRating rating={4.7} size="lg" showValue />
            </div>
          </div>
        </div>
      </Section>

      {/* ── quantity + chip ────────────────────────────────────────────── */}
      <Section title="QuantityStepper & Chip" note=".qty with .bump, .chip with accent.">
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <StateLabel>Stepper — min 0, max 5</StateLabel>
            <div className="flex flex-wrap items-center gap-6">
              <QuantityStepper
                value={qty}
                onChange={setQty}
                max={5}
                decreaseLabel={tu('decreaseQty')}
                increaseLabel={tu('increaseQty')}
                label={t('qty')}
              />
              <span className="text-[13px] text-shop-muted">value: {qty}</span>
              <QuantityStepper
                value={1}
                onChange={() => undefined}
                max={1}
                decreaseLabel={tu('decreaseQty')}
                increaseLabel={tu('increaseQty')}
                label={t('qty')}
              />
              <QuantityStepper
                value={2}
                onChange={() => undefined}
                max={99}
                disabled
                decreaseLabel={tu('decreaseQty')}
                increaseLabel={tu('increaseQty')}
                label={t('qty')}
              />
            </div>
          </div>

          <div>
            <StateLabel>Chips</StateLabel>
            <div className="flex flex-wrap gap-2">
              {categories.slice(0, 5).map((c) => (
                <Chip
                  key={c.id}
                  accent={c.accentColor}
                  selected={chipOn === c.id}
                  onClick={() => setChipOn(c.id)}
                >
                  {lang === 'bn' ? c.nameBn : c.nameEn}
                </Chip>
              ))}
            </div>
          </div>
        </div>
      </Section>

      {/* ── product cards ──────────────────────────────────────────────── */}
      <Section
        title="ProductCard"
        note="In stock, low stock, out of stock, discounted, flash-sale variant with sold bar."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {inStock && (
            <ProductCard
              product={inStock}
              tint={categoryById.get(inStock.category.slug)?.lightTintColor}
              accent={categoryById.get(inStock.category.slug)?.accentColor}
            />
          )}
          {lowStock && (
            <ProductCard
              product={lowStock}
              tint={categoryById.get(lowStock.category.slug)?.lightTintColor}
            />
          )}
          {outOfStock && (
            <ProductCard
              product={outOfStock}
              tint={categoryById.get(outOfStock.category.slug)?.lightTintColor}
            />
          )}
          {discounted && (
            <ProductCard
              product={discounted}
              tint={categoryById.get(discounted.category.slug)?.lightTintColor}
            />
          )}
          {products[4] && (
            <ProductCard
              product={products[4]}
              tint={categoryById.get(products[4].category.slug)?.lightTintColor}
              soldPercent={78}
            />
          )}
        </div>
      </Section>

      {/* ── category + brand ───────────────────────────────────────────── */}
      <Section title="CategoryCard & BrandTile" note=".cc with accent border + ring, .bt with tile.">
        <StateLabel>Categories</StateLabel>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
          {categories.map((c) => (
            <CategoryCard key={c.id} category={c} />
          ))}
        </div>

        <div className="mt-6">
          <StateLabel>Brands</StateLabel>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            {brands.map((b) => (
              <BrandTile key={b.id} brand={b} />
            ))}
          </div>
        </div>
      </Section>

      {/* ── carousel ───────────────────────────────────────────────────── */}
      <Section
        title="Carousel"
        note="Scroll-snap, drag, arrows hidden when nothing overflows, auto-scroll pauses off-screen."
      >
        <StateLabel>Products — 5 per view, auto-scroll 4s</StateLabel>
        <Carousel
          preset="per-prod"
          autoScrollMs={4000}
          label="Product carousel"
          previousLabel={tu('previous')}
          nextLabel={tu('next')}
        >
          {products.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              tint={categoryById.get(p.category.slug)?.lightTintColor}
            />
          ))}
        </Carousel>

        <div className="mt-8">
          <StateLabel>Categories — 7 per view, no auto-scroll</StateLabel>
          <Carousel
            preset="per-cat"
            label="Category carousel"
            previousLabel={tu('previous')}
            nextLabel={tu('next')}
          >
            {MOCK_CATEGORIES.map((c) => (
              <CategoryCard key={c.id} category={c} />
            ))}
          </Carousel>
        </div>

        <div className="mt-8">
          <StateLabel>Non-overflowing track — arrows must be absent</StateLabel>
          <div className="max-w-[320px]">
            <Carousel
              preset="per-mini"
              label="Short carousel"
              previousLabel={tu('previous')}
              nextLabel={tu('next')}
            >
              {products.slice(0, 2).map((p) => (
                <MiniProductCard
                  key={p.id}
                  product={p}
                  tint={categoryById.get(p.category.slug)?.lightTintColor}
                />
              ))}
            </Carousel>
          </div>
        </div>
      </Section>

      {/* ── mini card ──────────────────────────────────────────────────── */}
      <Section title="MiniProductCard" note=".mini — the drawer's recommendation strip.">
        <div className="grid max-w-[620px] grid-cols-2 gap-3 sm:grid-cols-4">
          {products.slice(0, 4).map((p) => (
            <MiniProductCard
              key={p.id}
              product={p}
              tint={categoryById.get(p.category.slug)?.lightTintColor}
            />
          ))}
        </div>
      </Section>

      {/* ── search ─────────────────────────────────────────────────────── */}
      <Section
        title="SearchBar"
        note="Combobox with debounced suggestions. Type 2+ characters — try 'sha' or 'ফ্যাশন'."
      >
        <div className="max-w-[640px]">
          <SearchBar products={MOCK_PRODUCTS} categories={MOCK_CATEGORIES} />
        </div>
      </Section>

      {/* ── overlays ───────────────────────────────────────────────────── */}
      <Section title="Modal & MobileSheet" note="Escape closes, focus returns, scroll locks.">
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" onClick={() => setModalOpen(true)}>
            Open modal
          </Button>
          <Button variant="outline" onClick={() => setSheetOpen(true)}>
            Open mobile sheet
          </Button>
          <Button
            variant="plain"
            className="border border-shop-line"
            onClick={() => toast('Toast from a button')}
          >
            Fire toast
          </Button>
        </div>

        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          label="Quick view demo"
          closeLabel={tu('close')}
        >
          <h3 className="text-[20px] font-extrabold text-shop-navy">Quick view</h3>
          <p className="mt-2 text-[14px] text-shop-muted">
            The reference&apos;s <code>.mo</code> panel. Escape closes it, Tab is
            trapped, and focus returns to the button that opened it.
          </p>
          <div className="mt-5 flex gap-3">
            <Button variant="primary" onClick={() => setModalOpen(false)}>
              {tu('close')}
            </Button>
          </div>
        </Modal>

        <MobileSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          label={t('allcat')}
          closeLabel={tu('closeSheet')}
          title={t('allcat')}
        >
          <div className="grid grid-cols-3 gap-2.5">
            {MOCK_CATEGORIES.map((c) => (
              <a
                key={c.id}
                href={`/category/${c.slug}`}
                className="rounded-[16px] border-[1.5px] px-1 py-3 text-center text-[12px] font-semibold"
                style={{
                  background: c.lightTintColor,
                  borderColor: c.accentColor,
                }}
              >
                <i className="block text-[28px] not-italic" aria-hidden="true">
                  {c.iconEmoji}
                </i>
                {lang === 'bn' ? c.nameBn : c.nameEn}
              </a>
            ))}
          </div>
        </MobileSheet>
      </Section>

      {/* ── empty states ───────────────────────────────────────────────── */}
      <Section title="EmptyState" note="Empty, error (with retry), search.">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-[18px] bg-white shadow-shop">
            <EmptyState
              tone="empty"
              title={t('empty')}
              body={tu('emptyCartBody')}
              action={<Button variant="primary">{t('cont')}</Button>}
            />
          </div>
          <div className="rounded-[18px] bg-white shadow-shop">
            <EmptyState
              tone="error"
              title={tu('errorTitle')}
              body={tu('errorBody')}
              action={<Button variant="outline">{tu('retry')}</Button>}
            />
          </div>
          <div className="rounded-[18px] bg-white shadow-shop">
            <EmptyState
              tone="search"
              title={t('nores')}
              body={t('nores2')}
            />
          </div>
        </div>
      </Section>

      {/* ── skeletons ──────────────────────────────────────────────────── */}
      <Section title="Skeletons" note="Card, brand tile, category card, row.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <ProductCardSkeleton />
          <ProductCardSkeleton />
          <BrandTileSkeleton />
          <CategoryCardSkeleton />
          <div className="rounded-[18px] bg-white p-3 shadow-shop">
            <RowSkeleton />
            <RowSkeleton />
          </div>
        </div>

        <div className="mt-6">
          <StateLabel>Generic skeleton</StateLabel>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-[60%]" />
            <Skeleton className="h-4 w-[40%]" />
            <Skeleton className="h-4 w-[80%]" />
          </div>
        </div>
      </Section>

      {/* ── persistence proof ──────────────────────────────────────────── */}
      <Section
        title="Persistence"
        note="Add items, then refresh. Cart and wishlist survive; language survives; overlays do not reopen."
      >
        <div className="rounded-[16px] bg-white p-4 shadow-shop">
          <p className="text-[13.5px] text-shop-muted">
            Stored under <code>sharkmart.cart</code>, <code>sharkmart.wishlist</code>{' '}
            and <code>sharkmart.ui</code>, each with a version key. A blob from an
            older version is discarded rather than migrated — see the store
            comments.
          </p>
          <ul className="mt-3 flex flex-col gap-1 text-[13.5px]">
            {cartLines.length === 0 && (
              <li className="text-shop-muted">Cart is empty.</li>
            )}
            {cartLines.map((line) => (
              <li key={`${line.productId}-${line.variantId ?? 'base'}`}>
                {lang === 'bn' ? line.nameBn : line.nameEn} × {line.quantity}
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <footer className={cn('mt-12 pb-16 text-center text-[12px] text-shop-muted')}>
        Phase 1 gate surface — {MOCK_PRODUCTS.length} mock products,{' '}
        {MOCK_CATEGORIES.length} categories, {MOCK_BRANDS.length} brands.
      </footer>
    </main>
  );
}
