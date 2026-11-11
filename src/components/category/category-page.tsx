'use client';

/**
 * CategoryPage — one template, fourteen instances.
 *
 * The reference's `category(id)` (oshoppingbd.html L696-705) is a single
 * function that reads a `CATS` record and emits the whole page. This keeps that
 * shape: the route passes a slug, this component resolves the category record
 * and renders the same sections in the same order for all fourteen.
 *
 * Order, from the reference:
 *   breadcrumb → hero (+ chips) → featured brands → offers →
 *   popular → new arrivals → top rated → listing (filters + grid)
 *
 * Section order is load-bearing: the reference puts the three carousels BEFORE
 * the listing block, so a customer sees merchandised picks before the filter
 * wall. Reordering it would be a visual delta, not an improvement.
 *
 * Unknown slug: the route calls `notFound()` before this renders, so this
 * component can assume a valid category. The guard below is a belt-and-braces
 * for a category record that exists in `CATEGORIES` but has no DTO.
 *
 * SSR: the route loads `CategoryData` on the server and passes it as
 * `initialData`, so the first HTML response already contains the hero, the
 * rails and the product grid. Before this, the server emitted a skeleton and
 * the crawler saw an empty page.
 */

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';

import { loadCategoryData, type CategoryData } from '@/lib/category-data';
import { useLang } from '@/lib/hooks';
import { EmptyState } from '@/components/shared/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { ProductRail } from '@/components/home/product-rail';
import { SectionHeader } from '@/components/home/section-header';
import { Carousel } from '@/components/shared/carousel';
import { BrandTile, ExternalBrandChip } from '@/components/product/brand-tile';

import { CategoryHero, PromotionalOffers } from './category-hero';
import { CategoryListing } from './category-listing';

export interface CategoryPageProps {
  slug: string;
  /**
   * Loaded during the server render by the route. When present the page paints
   * real content in the first HTML response instead of a skeleton, which is
   * what makes these fourteen pages indexable.
   */
  initialData?: CategoryData;
}

/**
 * Fetch state is keyed by slug.
 *
 * Storing the slug alongside the payload means a slug change is handled by
 * derivation — the stored slug no longer matches, so the component renders its
 * skeleton — instead of by `setData(null)` inside an effect, which triggers a
 * cascading render and briefly shows the previous category's products under the
 * new category's hero.
 */
type FetchState =
  | { slug: string; status: 'loading' }
  | { slug: string; status: 'failed' }
  | { slug: string; status: 'ready'; data: CategoryData };

export function CategoryPage({ slug, initialData }: CategoryPageProps) {
  const { t, tu } = useLang();

  const [state, setState] = useState<FetchState>(() =>
    initialData
      ? { slug, status: 'ready', data: initialData }
      : { slug, status: 'loading' },
  );

  /**
   * The slug whose data arrived from the server. Consumed once, so a later
   * slug change (client navigation) still triggers a fetch.
   */
  const seeded = useRef<string | null>(initialData ? slug : null);

  useEffect(() => {
    if (seeded.current === slug) {
      seeded.current = null;
      return;
    }

    let cancelled = false;
    const forSlug = slug;

    loadCategoryData(forSlug)
      .then((data) => {
        if (cancelled) return;
        setState({ slug: forSlug, status: 'ready', data });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ slug: forSlug, status: 'failed' });
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  // A stale slug renders the skeleton, never the previous category's data.
  const current = state.slug === slug ? state : ({ slug, status: 'loading' } as const);
  const data = current.status === 'ready' ? current.data : null;
  const failed = current.status === 'failed';

  // The three merchandising rails, in the reference's order and sort.
  const rails = useMemo(() => {
    if (!data) return null;
    const { products } = data;

    return {
      popular: [...products].sort((a, b) => b.reviewCount - a.reviewCount).slice(0, 10),
      newest: [...products]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 10),
      topRated: [...products].sort((a, b) => b.rating - a.rating).slice(0, 10),
    };
  }, [data]);

  if (failed) {
    return (
      <div className="wrap">
        <EmptyState tone="error" title={tu('errorTitle')} body={tu('errorBody')} />
      </div>
    );
  }

  if (!data || !rails) {
    return (
      <div className="wrap" aria-busy="true">
        <Skeleton className="mb-4 h-[230px] w-full rounded-3xl" />
        <div className="cat-grid">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-[320px] w-full" />
          ))}
        </div>
      </div>
    );
  }

  const { category, products, brands } = data;
  const accent = category.accentColor;
  const tint = category.lightTintColor;

  return (
    <div
      className="wrap"
      style={{ ['--a' as string]: accent, ['--t' as string]: tint }}
    >
      <CategoryHero category={category} />

      {/* ── featured brands ───────────────────────────────────────────── */}
      {brands.length > 0 && (
        <section className="sec">
          <SectionHeader title={t('fb')} />
          <Carousel
            label={t('fb')}
            previousLabel={tu('previous')}
            nextLabel={tu('next')}
            preset="per-ext"
            autoScrollMs={3500}
          >
            {brands.map((brand) =>
              // The reference renders the category's house brand as a `.bt`
              // tile and every partner as a plain `.ex` text chip
              // (oshoppingbd.html L700). Mixing the two is the design, not an
              // inconsistency — the house brand gets the logo treatment.
              brand.isOwnBrand ? (
                <BrandTile key={brand.id} brand={brand} />
              ) : (
                <ExternalBrandChip key={brand.id} brand={brand} />
              ),
            )}
          </Carousel>
        </section>
      )}

      <PromotionalOffers category={category} />

      {/* ── merchandising rails ───────────────────────────────────────── */}
      <div id="popular">
        <ProductRail title={t('pop')} products={rails.popular} />
      </div>
      <ProductRail title={t('newa')} products={rails.newest} />
      <ProductRail title={t('best')} products={rails.topRated} />

      {/* ── listing ───────────────────────────────────────────────────── */}
      {/*
        The listing reads the active filters from `useSearchParams`, which
        cannot run while the page is being prerendered. Without this boundary
        the whole route bails out of static generation and `next build` fails
        with "useSearchParams() should be wrapped in a suspense boundary".

        Scoping the boundary to the listing keeps the hero, the breadcrumb and
        all three product rails server-rendered — that is where the crawlable
        product content lives — while the filterable grid hydrates on the
        client.
      */}
      <Suspense
        fallback={
          <div className="wrap" aria-busy="true">
            <div className="cat-grid">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-[320px] w-full" />
              ))}
            </div>
          </div>
        }
      >
        <CategoryListing
          products={products}
          brands={brands}
          accent={accent}
          tint={tint}
        />
      </Suspense>
    </div>
  );
}
