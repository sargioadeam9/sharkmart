'use client';

/**
 * CategoryRail — the reference's `#cats` section (oshoppingbd.html L666).
 *
 * `car(CATS.map(c => <a class="cc" ...>), 'per-cat')` — all 14 categories in a
 * carousel of accent-bordered cards. The card itself is the Phase 1
 * `CategoryCard`, which already ports `.cc` including the double ring around
 * the icon.
 *
 * The reference multiplies the product count by 24 (`P.filter(...).length*24`)
 * to make the numbers look like a real catalogue. That is a demo fiction; here
 * the card shows the count the data actually carries.
 */

import type { CategoryDto } from '@/types/catalog';
import { useLang } from '@/lib/hooks';
import { Carousel } from '@/components/shared/carousel';
import { CategoryCard } from '@/components/product/category-card';
import { SectionHeader } from './section-header';

export interface CategoryRailProps {
  categories: CategoryDto[];
}

export function CategoryRail({ categories }: CategoryRailProps) {
  const { t, tu } = useLang();

  if (categories.length === 0) return null;

  return (
    <section className="sec" id="cats">
      <SectionHeader title={t('cats')} />

      <Carousel
        label={t('cats')}
        previousLabel={tu('previous')}
        nextLabel={tu('next')}
        preset="per-cat"
        autoScrollMs={3500}
      >
        {categories.map((category) => (
          <CategoryCard key={category.id} category={category} />
        ))}
      </Carousel>
    </section>
  );
}
