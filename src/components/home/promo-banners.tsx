'use client';

/**
 * PromoBanners — the reference's `.pb` grid (oshoppingbd.html L222-228, markup
 * L669).
 *
 * Three accent cards, each tinted and bordered by its category's colour, with a
 * giant decorative emoji bleeding off the bottom-right. The reference inlines
 * the three `[categoryId, en, bn]` triples; here they arrive as `promos` on the
 * homepage aggregate, so the component holds no copy and no category ids.
 *
 * A promo whose category is missing is skipped rather than rendered with a
 * broken accent — a card with no colour would be worse than no card.
 */

import Link from 'next/link';

import type { CategoryDto } from '@/types/catalog';
import type { HomepagePromo } from '@/lib/mock';
import { localized } from '@/types/catalog';
import { useLang } from '@/lib/hooks';

export interface PromoBannersProps {
  promos: HomepagePromo[];
  categories: CategoryDto[];
}

export function PromoBanners({ promos, categories }: PromoBannersProps) {
  const { lang, t } = useLang();

  const bySlug = new Map(categories.map((c) => [c.slug, c]));

  const cards = promos
    .map((promo) => {
      const category = bySlug.get(promo.categorySlug);
      return category ? { promo, category } : null;
    })
    .filter((entry): entry is { promo: HomepagePromo; category: CategoryDto } =>
      entry !== null,
    );

  if (cards.length === 0) return null;

  return (
    <section className="sec">
      <div className="pb">
        {cards.map(({ promo, category }) => (
          <Link
            key={promo.categorySlug}
            href={`/category/${category.slug}`}
            style={{
              ['--a' as string]: category.accentColor,
              ['--t' as string]: category.lightTintColor,
            }}
          >
            <small>{localized(lang, promo.kickerEn, promo.kickerBn)}</small>
            <h3>{localized(lang, promo.headlineEn, promo.headlineBn)}</h3>
            <span className="cta">{t('seeAll')} →</span>
            <span className="big" aria-hidden="true">
              {category.iconEmoji}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
