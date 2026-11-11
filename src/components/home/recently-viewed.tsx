'use client';

/**
 * RecentlyViewed — the reference's `#rv` rail, `prodCar(st.viewed.map(...))`
 * (oshoppingbd.html L671).
 *
 * The reference seeds six ids at boot, so its rail is never empty and never
 * reflects the user. This one reads the real store, which means it starts empty
 * — so the empty state is not an edge case here, it is the first-run experience
 * and has to look deliberate.
 *
 * Hydration: the store is persisted in localStorage, so the server render and
 * the first client render both see `[]`. Rendering the rail only after
 * hydration avoids a mismatch warning and avoids flashing an empty state at a
 * user who does have history.
 */

import { useMemo } from 'react';

import type { ProductDto } from '@/types/catalog';
import { useLang, useStoreHydrated } from '@/lib/hooks';
import { useViewedStore } from '@/lib/store/viewed-store';
import { Carousel } from '@/components/shared/carousel';
import { ProductCard } from '@/components/product/product-card';
import { EmptyState } from '@/components/shared/empty-state';
import { SectionHeader } from './section-header';

export interface RecentlyViewedProps {
  /** Catalog to resolve the stored ids against. */
  products: ProductDto[];
}

export function RecentlyViewed({ products }: RecentlyViewedProps) {
  const { t, tu } = useLang();
  const hydrated = useStoreHydrated(useViewedStore);
  const ids = useViewedStore((state) => state.ids);

  const resolved = useMemo(() => {
    if (ids.length === 0) return [];

    const byId = new Map(products.map((p) => [p.id, p]));
    return ids
      .map((id) => byId.get(id))
      .filter((product): product is ProductDto => product !== undefined);
  }, [ids, products]);

  // Nothing to show until the persisted store has been read.
  if (!hydrated) return null;

  return (
    <section className="sec" id="rv">
      <SectionHeader title={t('rv')} />

      {resolved.length === 0 ? (
        <EmptyState
          icon="👀"
          title={tu('recentlyViewedEmpty')}
          body={tu('recentlyViewedEmptyBody')}
        />
      ) : (
        <Carousel
          label={t('rv')}
          previousLabel={tu('previous')}
          nextLabel={tu('next')}
          preset="per-prod"
          autoScrollMs={3500}
        >
          {resolved.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </Carousel>
      )}
    </section>
  );
}
