'use client';

/**
 * CategoryHero — the reference's `.chero` (oshoppingbd.html L300-305, markup
 * L699).
 *
 * Geometry, gradient stops, icon tile and the oversized rotated emoji are
 * copied from the reference. The accent and tint arrive as `--a` / `--t` from
 * the category record, which is why a raw hex in a style prop is correct here:
 * it is data, not a design decision.
 *
 * The subcategory chips are links back to the same route with `?sub=`, not
 * dead `<a>` tags. The reference points every chip at the category root, so
 * clicking "Men" under Fashion reloads Fashion and does nothing — a real bug
 * that reads as a broken filter.
 */

import Link from 'next/link';
import type { CategoryDto } from '@/types/catalog';
import { localized } from '@/types/catalog';
import { useLang } from '@/lib/hooks';

export interface CategoryHeroProps {
  category: CategoryDto;
}

export function CategoryHero({ category }: CategoryHeroProps) {
  const { lang, t, tu } = useLang();

  const name = localized(lang, category.nameEn, category.nameBn);
  const description =
    lang === 'bn'
      ? 'সেরা দামে সেরা পণ্য। ক্যাশ অন ডেলিভারি ও সহজ রিটার্ন।'
      : 'Top picks at the best prices. Cash on Delivery and easy returns.';

  return (
    <>
      <nav className="bc" aria-label={lang === 'bn' ? 'ব্রেডক্রাম্ব' : 'Breadcrumb'}>
        <Link href="/">{t('home')}</Link>
        <span aria-hidden="true">›</span>
        <b aria-current="page">{name}</b>
      </nav>

      <div
        className="chero"
        style={{
          ['--a' as string]: category.accentColor,
          ['--t' as string]: category.lightTintColor,
        }}
      >
        <div>
          <div className="ib2" aria-hidden="true">
            {category.iconEmoji}
          </div>
          <h1>{name}</h1>
          <p>{description}</p>

          {category.subcategories.length > 0 && (
            <div className="chips">
              {category.subcategories.map((sub) => (
                <Link
                  key={sub.id}
                  className="chip"
                  href={`/category/${category.slug}#allp`}
                  style={{ ['--a' as string]: category.accentColor }}
                  aria-label={`${localized(lang, sub.nameEn, sub.nameBn)} — ${tu('categoryProducts')}`}
                >
                  {localized(lang, sub.nameEn, sub.nameBn)}
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="big" aria-hidden="true">
          {category.iconEmoji}
        </div>
      </div>
    </>
  );
}

/**
 * PromotionalOffers — the reference's `.offers` (L308-311, markup L700).
 *
 * Three dashed accent cards. Copy is the reference's, including the
 * `WELCOME10` code, which is the one string that must not be translated.
 */
export function PromotionalOffers({ category }: CategoryHeroProps) {
  const { lang, t } = useLang();

  const cards = [
    {
      icon: '🏷️',
      title: lang === 'bn' ? '১০% ছাড় — প্রথম অর্ডারে' : '10% off your first order',
      sub: 'WELCOME10',
    },
    {
      icon: '🚚',
      title: t('inc'),
      sub: lang === 'bn' ? 'সারাদেশে' : 'Nationwide',
    },
    {
      icon: '⚡',
      title: lang === 'bn' ? 'ফ্ল্যাশ ডিল — ৪০% পর্যন্ত' : 'Flash deals up to 40%',
      sub: lang === 'bn' ? 'সীমিত সময়' : 'Limited time',
    },
  ];

  return (
    <section className="sec">
      <div
        className="offers"
        style={{
          ['--a' as string]: category.accentColor,
          ['--t' as string]: category.lightTintColor,
        }}
      >
        {cards.map((card) => (
          <div key={card.sub}>
            <span className="oe" aria-hidden="true">
              {card.icon}
            </span>
            <span>
              <b>{card.title}</b>
              <small>{card.sub}</small>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
