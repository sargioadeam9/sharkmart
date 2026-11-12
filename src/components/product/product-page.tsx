'use client';

/**
 * ProductPage — the reference's `product(id)` (oshoppingbd.html L720-771).
 *
 * Section order is copied from the reference and is load-bearing:
 *   breadcrumb → gallery + info → tabs → reviews → FBT → 5 rails
 *
 * State discipline (the thing that matters more than the visuals):
 *   - `selection: number[]` is the ONLY variant state. `resolveVariant()` turns
 *     it into price, stock, swatch and the cart payload in one place, so a
 *     variant change cannot update the price and leave the stock stale.
 *   - `quantity` is clamped to the resolved variant's stock, not the product's.
 *   - Recently-viewed is recorded once per mount, after hydration, because the
 *     store is localStorage-backed.
 *
 * Price never comes from the client: `pricePoisha` is the server DTO's value
 * plus the DTO's own option deltas. Checkout recomputes it again server-side
 * (AGENTS.md §7.3).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

import { cn } from '@/lib/utils';
import { useLang } from '@/lib/hooks';
import { formatMoney, formatNumber } from '@/lib/format';
import { localized } from '@/types/catalog';
import type { ProductDetailDto, ProductDto } from '@/types/catalog';
import type { ProductRails } from '@/lib/product-data';

import { useCartStore, type CartLine } from '@/lib/store/cart-store';
import { useWishlistStore } from '@/lib/store/wishlist-store';
import { recordView } from '@/lib/store/viewed-store';

import { Button, useAddToCartState } from '@/components/ui/button';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { StarRating } from '@/components/ui/star-rating';
import { toast } from '@/components/shared/toast';
import { ProductRail } from '@/components/home/product-rail';

import { ProductGallery } from './product-gallery';
import { ProductReviews } from './product-reviews';
import { VariantSelector, initialSelection, resolveVariant } from './variant-selector';
import { ProductTabs } from './product-tabs';
import { FrequentlyBoughtTogether } from './frequently-bought-together';

export interface ProductPageProps {
  product: ProductDetailDto;
  rails: ProductRails;
}

/** Districts the reference offers, with its charge and ETA strings. */
const DISTRICTS = [
  { id: 'dhaka', en: 'Dhaka', bn: 'ঢাকা', chargePoisha: 6000, etaEn: '24–48 hrs', etaBn: '২৪–৪৮ ঘণ্টা' },
  { id: 'chattogram', en: 'Chattogram', bn: 'চট্টগ্রাম', chargePoisha: 10000, etaEn: '2–3 days', etaBn: '২–৩ দিন' },
  { id: 'sylhet', en: 'Sylhet', bn: 'সিলেট', chargePoisha: 11000, etaEn: '3–4 days', etaBn: '৩–৪ দিন' },
  { id: 'rajshahi', en: 'Rajshahi', bn: 'রাজশাহী', chargePoisha: 12000, etaEn: '3–5 days', etaBn: '৩–৫ দিন' },
  { id: 'khulna', en: 'Khulna', bn: 'খুলনা', chargePoisha: 13000, etaEn: '3–5 days', etaBn: '৩–৫ দিন' },
] as const;

/** The reference's two coupon cards. */
const COUPONS = [
  { code: 'WELCOME10', en: '10% off first order', bn: 'প্রথম অর্ডারে ১০%' },
  { code: 'FREEDEL', en: 'Free delivery ৳2,000+', bn: '৳২,০০০+ ফ্রি ডেলিভারি' },
] as const;

export function ProductPage({ product, rails }: ProductPageProps) {
  const { lang, t, tu } = useLang();

  const addLine = useCartStore((s) => s.addLine);
  const wishlisted = useWishlistStore((s) => s.ids.includes(product.id));
  const toggleWishlist = useWishlistStore((s) => s.toggle);

  const [selection, setSelection] = useState<number[]>(() =>
    initialSelection(product),
  );
  const [quantity, setQuantity] = useState(1);
  const [district, setDistrict] = useState<string>('');
  const [addState, runAdd] = useAddToCartState();
  const [stickyVisible, setStickyVisible] = useState(false);

  const actionsRef = useRef<HTMLDivElement | null>(null);

  /**
   * The one derivation. Everything below reads from `variant`.
   */
  const variant = useMemo(
    () => resolveVariant(product, selection),
    [product, selection],
  );

  const name = localized(lang, product.nameEn, product.nameBn);
  const brandName = product.brand
    ? localized(lang, product.brand.nameEn, product.brand.nameBn)
    : null;
  const categoryName = localized(
    lang,
    product.category.nameEn,
    product.category.nameBn,
  );

  /**
   * Quantity is clamped at read time, not in an effect.
   *
   * The reference clamps on every variant change. Doing that with
   * `setQuantity` inside an effect is a cascading render (and the lint rule is
   * right to flag it). Deriving the effective quantity instead means the
   * stepper, the cart payload and the button label can never disagree with the
   * selected variant's stock — there is no window where the state is stale.
   */
  const effectiveQuantity = Math.min(quantity, Math.max(1, variant.stock));

  /** Recently viewed — once per product, after hydration. */
  useEffect(() => {
    recordView(product.id);
  }, [product.id]);

  /**
   * Sticky mobile bar: show it once the inline action row has scrolled out of
   * view. An IntersectionObserver is cheaper and more accurate than a scroll
   * listener, and it does not fire on every pixel.
   */
  useEffect(() => {
    const node = actionsRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) setStickyVisible(!entry.isIntersecting);
      },
      { rootMargin: '-80px 0px 0px 0px' },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const stockLabel = variant.isOutOfStock
    ? t('out')
    : variant.stock <= 5
      ? t('left', { n: variant.stock })
      : t('inst');

  const stockClass = variant.isOutOfStock
    ? 'stk out'
    : variant.stock <= 5
      ? 'stk low'
      : 'stk';

  /** Builds the persisted cart line from the current variant. */
  const buildLine = useCallback((): CartLine => {
    const main = product.images.find((image) => image.isMain) ?? product.images[0];

    return {
      productId: product.id,
      slug: product.slug,
      sku: product.sku,
      nameEn: product.nameEn,
      nameBn: product.nameBn,
      imageUrl: main?.url ?? null,
      emoji: null,
      tint: product.tintColor,
      unitPricePoisha: variant.pricePoisha,
      originalUnitPricePoisha: variant.originalPricePoisha,
      // The real ProductVariant.id, resolved from the selection. It used to be
      // `variant.labelEn` — a display string like "XL · Crimson" — which the
      // server could never match to a variant, so every synced line was skipped.
      variantId: variant.variantId,
      variantNameEn: variant.labelEn || null,
      variantNameBn: variant.labelBn || null,
      quantity: 1,
      stockQuantity: variant.stock,
    };
  }, [product, variant]);

  const handleAdd = useCallback(() => {
    if (variant.isOutOfStock) return;

    runAdd(() => {
      addLine(buildLine(), effectiveQuantity);
      toast(`${name} — ${t('addedT')}`);
    });
  }, [variant.isOutOfStock, runAdd, addLine, buildLine, effectiveQuantity, name, t]);

  const handleBuyNow = useCallback(() => {
    if (variant.isOutOfStock) return;
    addLine(buildLine(), effectiveQuantity);
    toast(`${name} — ${t('addedT')}`);
  }, [variant.isOutOfStock, addLine, buildLine, effectiveQuantity, name, t]);

  const handleWishlist = useCallback(() => {
    toggleWishlist(product.id);
    toast(wishlisted ? t('wRem') : t('wAdded'));
  }, [toggleWishlist, product.id, wishlisted, t]);

  const handleCopyLink = useCallback(() => {
    const url = typeof window === 'undefined' ? '' : window.location.href;
    if (!url) return;

    // Clipboard is unavailable on insecure origins and in some in-app browsers.
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(url).then(
        () => toast(tu('linkCopied')),
        () => toast(t('copy'), 'info'),
      );
    } else {
      toast(t('copy'), 'info');
    }
  }, [t, tu]);

  const handleShare = useCallback(() => {
    const url = typeof window === 'undefined' ? '' : window.location.href;
    if (navigator.share && url) {
      void navigator.share({ title: name, url }).catch(() => undefined);
    } else {
      handleCopyLink();
    }
  }, [name, handleCopyLink]);

  const selectedDistrict = DISTRICTS.find((d) => d.id === district);

  return (
    <div className="wrap" style={{ ['--a' as string]: product.accentColor }}>
      <nav className="bc" aria-label="Breadcrumb">
        <Link href="/">{t('home')}</Link>
        <span aria-hidden="true">›</span>
        <Link href={`/category/${product.category.slug}`}>{categoryName}</Link>
        <span aria-hidden="true">›</span>
        <b>{name}</b>
      </nav>

      <div className="pp">
        <div>
          <ProductGallery
            images={product.images}
            emoji={product.images.length === 0 ? '🛍️' : '🛍️'}
            tint={product.tintColor}
            swatch={variant.swatch}
            productName={name}
            lang={lang}
            labels={{
              zoomIn: tu('galleryZoomIn'),
              zoomOut: tu('galleryZoomOut'),
              fullscreen: tu('galleryFullscreen'),
              close: tu('close'),
              previous: tu('galleryPrevious'),
              next: tu('galleryNext'),
              video: t('video'),
              videoSub: t('videoS'),
            }}
          />
        </div>

        <div className="pi">
          {brandName ? (
            <div className="br">
              {product.brand ? (
                <Link href={`/brand/${product.brand.slug}`}>{brandName}</Link>
              ) : (
                brandName
              )}
            </div>
          ) : null}

          <h1>{name}</h1>

          <div className="meta">
            <StarRating
              rating={product.rating}
              lang={lang}
              showValue
              size="sm"
            />
            <a href="#rv" style={{ textDecoration: 'underline' }}>
              {t('ratings', { n: product.reviewCount })}
            </a>
            <span className="sku">SKU: {product.sku}</span>
            <span className={stockClass}>{stockLabel}</span>
          </div>

          <div className="price">
            <b>{formatMoney(variant.pricePoisha, lang)}</b>
            {variant.originalPricePoisha > 0 ? (
              <s>{formatMoney(variant.originalPricePoisha, lang)}</s>
            ) : null}
            {product.discountPercent > 0 ? (
              <em>
                -{formatNumber(product.discountPercent, lang)}% {t('off')}
              </em>
            ) : null}
          </div>

          <VariantSelector
            product={product}
            selection={selection}
            onChange={setSelection}
          />

          <div className="acts" ref={actionsRef}>
            <QuantityStepper
              value={effectiveQuantity}
              onChange={setQuantity}
              min={1}
              max={Math.max(1, variant.stock)}
              decreaseLabel={tu('decreaseQty')}
              increaseLabel={tu('increaseQty')}
              label={tu('quantity')}
              disabled={variant.isOutOfStock}
            />

            <Button
              variant="addOutline"
              loading={addState === 'loading'}
              success={addState === 'success'}
              disabled={variant.isOutOfStock}
              onClick={handleAdd}
            >
              {t('add')}
            </Button>

            <Button
              variant="primary"
              disabled={variant.isOutOfStock}
              onClick={handleBuyNow}
            >
              {t('buy')}
            </Button>
          </div>

          <div className="sq">
            <button
              type="button"
              onClick={handleWishlist}
              className={cn(wishlisted && 'on')}
              aria-pressed={wishlisted}
            >
              ♥ {t('wish')}
            </button>
            <button type="button" onClick={handleShare}>
              ↗ {t('share')}
            </button>
            <button type="button" onClick={handleCopyLink}>
              🔗 {t('copy')}
            </button>
          </div>

          <div className="box">
            <h4>🚚 {t('dlv')}</h4>
            <div className="dl">
              <select
                className="sel"
                value={district}
                onChange={(event) => setDistrict(event.target.value)}
                aria-label={tu('deliverySelectDistrict')}
              >
                <option value="">{t('district')}</option>
                {DISTRICTS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {localized(lang, option.en, option.bn)}
                  </option>
                ))}
              </select>

              <div className="res">
                {selectedDistrict
                  ? `${tu('deliveryCharge')}: ${formatMoney(selectedDistrict.chargePoisha, lang)} · ${localized(lang, selectedDistrict.etaEn, selectedDistrict.etaBn)}`
                  : t('inc')}
              </div>
            </div>
          </div>

          <div className="box">
            <h4>🏷️ {t('offersT')}</h4>
            <div className="cp">
              {COUPONS.map((coupon) => (
                <button
                  key={coupon.code}
                  type="button"
                  onClick={() => {
                    if (navigator.clipboard?.writeText) {
                      void navigator.clipboard
                        .writeText(coupon.code)
                        .then(() => toast(tu('couponCopied')))
                        .catch(() => toast(coupon.code, 'info'));
                    } else {
                      toast(coupon.code, 'info');
                    }
                  }}
                  aria-label={`${tu('copyCoupon')} ${coupon.code}`}
                >
                  {coupon.code}
                  <small>{localized(lang, coupon.en, coupon.bn)}</small>
                </button>
              ))}
            </div>
          </div>

          <div className="pol">
            <div>
              <i aria-hidden="true">↩️</i>
              {t('pol1')}
            </div>
            <div>
              <i aria-hidden="true">✅</i>
              {t('pol2')}
            </div>
            <div>
              <i aria-hidden="true">💵</i>
              {t('pol3')}
            </div>
          </div>
        </div>
      </div>

      <ProductTabs product={product} />

      <ProductReviews
        reviews={product.reviews}
        rating={product.rating}
        reviewCount={product.reviewCount}
        breakdown={product.ratingBreakdown}
      />

      <FrequentlyBoughtTogether
        product={product}
        candidates={rails.related.slice(0, 2)}
      />

      <ProductRail title={t('relP')} products={rails.related} />
      <ProductRail title={t('similar')} products={rails.similar} />
      <ProductRail title={t('alsoV')} products={rails.alsoViewed} />
      <ProductRail title={t('moreB')} products={rails.fromBrand} />
      <RecentlyViewedRail excludeId={product.id} />

      {/* Sticky mobile action bar — sits above the bottom nav. */}
      <div className={cn('pdbar', stickyVisible && 'show')}>
        <span className="p">{formatMoney(variant.pricePoisha, lang)}</span>
        <Button
          variant="addOutline"
          disabled={variant.isOutOfStock}
          onClick={handleAdd}
        >
          {tu('stickyAddToCart')}
        </Button>
        <Button
          variant="primary"
          disabled={variant.isOutOfStock}
          onClick={handleBuyNow}
        >
          {tu('stickyBuyNow')}
        </Button>
      </div>
    </div>
  );
}

/**
 * Recently viewed rail.
 *
 * Reads the store, so it must be a client component and it must render nothing
 * on the server. The store is empty until hydration, which is correct: an empty
 * rail is honest, a fabricated one is not (landmine #12).
 */
function RecentlyViewedRail({ excludeId }: { excludeId: string }) {
  const { t } = useLang();
  const [products, setProducts] = useState<ProductDto[]>([]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const { useViewedStore } = await import('@/lib/store/viewed-store');
      const { MOCK_PRODUCTS } = await import('@/lib/mock');

      const ids = useViewedStore.getState().ids.filter((id) => id !== excludeId);
      if (ids.length === 0) return;

      const byId = new Map(MOCK_PRODUCTS.map((p) => [p.id, p]));
      const resolved = ids
        .map((id) => byId.get(id))
        .filter((p): p is ProductDto => Boolean(p));

      if (!cancelled) setProducts(resolved);
    })();

    return () => {
      cancelled = true;
    };
  }, [excludeId]);

  if (products.length === 0) return null;

  return <ProductRail title={t('rv')} products={products} />;
}
