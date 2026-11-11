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
 */

import { useEffect, useMemo, useState } from 'react';

import type { BrandDto, CategoryDto, ProductDto } from '@/types/catalog';
import { getCategory, listBrands } from '@/lib/api/categories';
import { listProducts } from '@/lib/api/products';
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
}

interface CategoryData {
  category: CategoryDto;
  products: ProductDto[];
  brands: BrandDto[];
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

export function CategoryPage({ slug }: CategoryPageProps) {
  const { t, tu } = useLang();

  const [state, setState] = useState<FetchState>({ slug, status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    const forSlug = slug;

    Promise.all([
      getCategory(forSlug),
      listProducts({ category: forSlug, limit: 200 }),
      listBrands(),
    ])
      .then(([categoryResponse, productsResponse, brandsResponse]) => {
        if (cancelled) return;

        const products = productsResponse.data;

        // The authoritative brand records, keyed by slug. The product DTO only
        // carries a `BrandRef` (id/slug/names/colour), which has no
        // `isOwnBrand`, so the flag has to come from the brand list — not from
        // a hardcoded `false`. That hardcode made every brand render as a `.bt`
        // tile; the reference renders the house brand as a `.bt` tile and
        // partners as `.ex` chips (oshoppingbd.html L700).
        const brandRecords = new Map(brandsResponse.data.map((b) => [b.slug, b]));

        // Brands are derived from the products actually in this category, not
        // from the whole catalog. The reference does the same
        // (`[...new Set(ps.map(p => p.b))]`), which is why its filter list
        // never offers a brand with zero results.
        const seen = new Map<string, BrandDto>();
        for (const product of products) {
          const brand = product.brand;
          if (!brand || seen.has(brand.slug)) continue;

          const record = brandRecords.get(brand.slug);
          seen.set(brand.slug, {
            id: brand.id,
            slug: brand.slug,
            nameEn: brand.nameEn,
            nameBn: brand.nameBn,
            logo: record?.logo ?? null,
            taglineEn: record?.taglineEn ?? null,
            taglineBn: record?.taglineBn ?? null,
            color: brand.color,
            isOwnBrand: record?.isOwnBrand ?? false,
            sortOrder: seen.size,
            productCount: products.filter((p) => p.brand?.slug === brand.slug).length,
          });
        }

        setState({
          slug: forSlug,
          status: 'ready',
          data: {
            category: categoryResponse.data,
            products,
            brands: [...seen.values()].sort((a, b) => a.nameEn.localeCompare(b.nameEn)),
          },
        });
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
      <CategoryListing
        products={products}
        brands={brands}
        accent={accent}
        tint={tint}
      />
    </div>
  );
}
