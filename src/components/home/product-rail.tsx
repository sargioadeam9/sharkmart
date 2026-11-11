'use client';

/**
 * ProductRail — one section header plus one product carousel.
 *
 * The reference repeats this block eight times (`prodCar(pick(...))` for new
 * arrivals, best sellers, only-for-you, trending, featured, recommended,
 * recently viewed, popular). One component, eight call sites, so a change to
 * the rail's behaviour lands everywhere at once.
 *
 * The `viewAllHref` is optional because the reference only links some rails
 * (`head(t('only'), '', '#/search/only')` vs `head(t('feat'), '')`).
 */

import type { ProductDto } from '@/types/catalog';
import { useLang } from '@/lib/hooks';
import { Carousel } from '@/components/shared/carousel';
import { ProductCard } from '@/components/product/product-card';
import { EmptyState } from '@/components/shared/empty-state';
import { SectionHeader } from './section-header';

export interface ProductRailProps {
  title: string;
  subtitle?: string;
  viewAllHref?: string;
  products: ProductDto[];
  /** Section id, for anchor links. */
  id?: string;
  /** Shown instead of the carousel when `products` is empty. */
  emptyTitle?: string;
  emptyBody?: string;
}

export function ProductRail({
  title,
  subtitle,
  viewAllHref,
  products,
  id,
  emptyTitle,
  emptyBody,
}: ProductRailProps) {
  const { t, tu } = useLang();

  return (
    <section className="sec" id={id}>
      <SectionHeader
        title={title}
        subtitle={subtitle}
        viewAllHref={viewAllHref}
        viewAllLabel={t('viewall')}
      />

      {products.length === 0 ? (
        <EmptyState
          title={emptyTitle ?? tu('emptyProducts')}
          body={emptyBody ?? tu('emptyProductsBody')}
        />
      ) : (
        <Carousel
          label={title}
          previousLabel={tu('previous')}
          nextLabel={tu('next')}
          preset="per-prod"
          autoScrollMs={3500}
        >
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </Carousel>
      )}
    </section>
  );
}
