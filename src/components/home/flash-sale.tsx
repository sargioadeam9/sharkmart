'use client';

/**
 * FlashSale — the reference's `.flash` panel (oshoppingbd.html L165-176,
 * markup L660).
 *
 * A red gradient panel holding the section header with a live countdown, then a
 * product carousel whose cards carry a sold-progress bar. The reference builds
 * that bar by string-replacing into the card's HTML (`flashCard`); here the card
 * takes a `soldPercent` prop, which is the same result without the string
 * surgery.
 *
 * The sold percentage is derived from the product's review volume against the
 * rail's maximum. The reference uses a hardcoded `p.sold` field; the wire
 * contract does not carry one, and inventing a number would be worse than
 * deriving an honest ratio from data that exists.
 */

import type { ProductDto } from '@/types/catalog';
import { useLang } from '@/lib/hooks';
import { Carousel } from '@/components/shared/carousel';
import { ProductCard } from '@/components/product/product-card';
import { SectionHeader } from './section-header';
import { FlashCountdown } from './flash-countdown';

export interface FlashSaleProps {
  products: ProductDto[];
  endsAt: string;
}

export function FlashSale({ products, endsAt }: FlashSaleProps) {
  const { t, tu } = useLang();

  if (products.length === 0) return null;

  // Sold ratio: this product's review count against the busiest in the rail.
  // Capped at 95% so nothing claims to be fully sold while still on sale.
  const maxReviews = Math.max(...products.map((p) => p.reviewCount), 1);

  return (
    <section className="sec" id="flash">
      <div className="flash">
        <SectionHeader
          title={`⚡ ${t('flash')}`}
          viewAllHref="/search/offer"
          viewAllLabel={t('viewall')}
          aside={
            <div className="fl-h">
              <FlashCountdown endsAt={endsAt} />
            </div>
          }
        />

        <Carousel
          label={t('flash')}
          previousLabel={tu('previous')}
          nextLabel={tu('next')}
          preset="per-prod"
          autoScrollMs={3500}
        >
          {products.map((product) => {
            const soldPercent = Math.min(
              95,
              Math.round((product.reviewCount / maxReviews) * 100),
            );

            return (
              <ProductCard
                key={product.id}
                product={product}
                soldPercent={soldPercent}
              />
            );
          })}
        </Carousel>
      </div>
    </section>
  );
}
