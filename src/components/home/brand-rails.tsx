'use client';

/**
 * BrandRails — the reference's two brand carousels:
 *   "Our Brands"    `.bt` tiles, `car(OWN.map(brandTile), 'per-brand')`  L657
 *   "Shop by Brand" `.ex` tiles, `car(EXT.map(...), 'per-ext')`          L658
 *
 * Both are the same shape — a section header plus a carousel — so they share
 * one component and differ only in the tile they render. The reference's
 * external rail is a plain text tile because it has no logo assets; ours keeps
 * that, since inventing logos would be a visual delta, not a fix.
 */

import Link from 'next/link';

import type { BrandDto } from '@/types/catalog';
import { localized } from '@/types/catalog';
import { useLang } from '@/lib/hooks';
import { Carousel } from '@/components/shared/carousel';
import { BrandTile } from '@/components/product/brand-tile';
import { SectionHeader } from './section-header';

export interface OwnBrandsRailProps {
  brands: BrandDto[];
}

export function OwnBrandsRail({ brands }: OwnBrandsRailProps) {
  const { t, tu } = useLang();

  if (brands.length === 0) return null;

  return (
    <section className="sec" id="brands">
      <SectionHeader title={t('brands')} subtitle={t('own2')} />

      <Carousel
        label={t('brands')}
        previousLabel={tu('previous')}
        nextLabel={tu('next')}
        preset="per-brand"
        autoScrollMs={3500}
      >
        {brands.map((brand) => (
          <BrandTile key={brand.id} brand={brand} />
        ))}
      </Carousel>
    </section>
  );
}

export interface ExternalBrandsRailProps {
  brands: BrandDto[];
}

export function ExternalBrandsRail({ brands }: ExternalBrandsRailProps) {
  const { lang, t, tu } = useLang();

  if (brands.length === 0) return null;

  return (
    <section className="sec">
      <SectionHeader title={t('shopBrand')} subtitle={t('ext1')} />

      <Carousel
        label={t('shopBrand')}
        previousLabel={tu('previous')}
        nextLabel={tu('next')}
        preset="per-ext"
        autoScrollMs={3500}
      >
        {brands.map((brand) => (
          <Link
            key={brand.id}
            href={`/brand/${brand.slug}`}
            className="ex"
          >
            {localized(lang, brand.nameEn, brand.nameBn)}
          </Link>
        ))}
      </Carousel>
    </section>
  );
}
