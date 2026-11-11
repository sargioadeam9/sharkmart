'use client';

/**
 * Homepage — the reference's `home()` (oshoppingbd.html L654-673), section for
 * section, in the reference's order.
 *
 * Order (frontend.md §6.1): hero → trust → our brands → shop by brand → flash
 * sale → all categories → new arrivals → best sellers → only for you →
 * trending → promo banners → featured → recommended → recently viewed →
 * popular → newsletter.
 *
 * Why this is a client component: the whole storefront shell is client-side
 * (language lives in a persisted Zustand store, and the Phase 2 shell is a
 * client component wrapping every page), so a server component here would
 * render in English and never re-render on a language toggle. The gate for this
 * phase requires the toggle to update the page in one click, so the page reads
 * `useLang` like the shell does. Data still comes from the API layer, not from
 * inline arrays.
 *
 * The reference's preview strip is not part of this page: it lives in the shell
 * (`components/layout/preview-strip.tsx`) and renders only when
 * `NEXT_PUBLIC_SHOW_PREVIEW_STRIP === "true"`, so it never reaches a customer.
 */

import { useEffect, useState } from 'react';

import { getHomepage, type HomepageAggregate } from '@/lib/api/homepage';
import { useLang } from '@/lib/hooks';
import { EmptyState } from '@/components/shared/empty-state';
import { Skeleton } from '@/components/ui/skeleton';

import { HeroSlider } from '@/components/home/hero-slider';
import { TrustBadges } from '@/components/home/trust-badges';
import { OwnBrandsRail, ExternalBrandsRail } from '@/components/home/brand-rails';
import { FlashSale } from '@/components/home/flash-sale';
import { CategoryRail } from '@/components/home/category-rail';
import { ProductRail } from '@/components/home/product-rail';
import { PromoBanners } from '@/components/home/promo-banners';
import { RecentlyViewed } from '@/components/home/recently-viewed';
import { Newsletter } from '@/components/home/newsletter';

export interface HomePageProps {
  /**
   * Loaded by the route on the server. When present the homepage paints every
   * section in the first HTML response instead of an empty skeleton, which is
   * what makes the page indexable and keeps LCP honest.
   */
  initialData?: HomepageAggregate;
}

export function HomePage({ initialData }: HomePageProps) {
  const { t, tu } = useLang();

  const [data, setData] = useState<HomepageAggregate | null>(initialData ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // The server already handed us the payload — do not refetch, and do not
    // paint the skeleton we were trying to get rid of.
    if (initialData) return;

    let cancelled = false;

    getHomepage()
      .then((response) => {
        if (cancelled) return;
        setData(response.data);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [initialData]);

  if (failed) {
    return (
      <div className="wrap">
        <EmptyState
          tone="error"
          title={tu('errorTitle')}
          body={tu('errorBody')}
        />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="wrap">
        <div className="hero" aria-busy="true">
          <Skeleton className="h-full w-full" />
        </div>
        <div className="trust">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[70px] w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="wrap">
      <HeroSlider />
      <TrustBadges />

      <OwnBrandsRail brands={data.ownBrands} />
      <ExternalBrandsRail brands={data.externalBrands} />

      <FlashSale products={data.flashSale} endsAt={data.flashSaleEndsAt} />

      <CategoryRail categories={data.categories} />

      <ProductRail
        id="new"
        title={t('newa')}
        viewAllHref="/search/new"
        products={data.newArrivals}
      />

      <ProductRail
        id="best"
        title={t('best')}
        viewAllHref="/search/best"
        products={data.bestSellers}
      />

      <ProductRail
        title={t('only')}
        viewAllHref="/search/only"
        products={data.onlyForYou}
      />

      <ProductRail
        title={t('trend')}
        viewAllHref="/search/trend"
        products={data.trending}
      />

      <PromoBanners promos={data.promos} categories={data.categories} />

      <ProductRail title={t('feat')} products={data.featured} />

      <ProductRail title={t('rec')} products={data.recommended} />

      <RecentlyViewed products={data.catalog} />

      <ProductRail
        title={t('pop')}
        viewAllHref="/search/best"
        products={data.popular}
      />

      <Newsletter />
    </div>
  );
}
