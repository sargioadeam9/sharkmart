/**
 * CategoryCard — the reference's `.cc` (oshoppingbd.html L215-219, markup
 * L666).
 *
 * The accent border-bottom and the double ring around the icon
 * (`inset 0 0 0 3px #fff, 0 0 0 2px accent`) are what make this card read as
 * the reference rather than a generic tile. Both come from the category record.
 */

import Link from 'next/link';
import type { CategoryDto } from '@/types/catalog';
import { localized } from '@/types/catalog';
import { cn } from '@/lib/utils';
import { useLang } from '@/lib/hooks';

export interface CategoryCardProps {
  category: CategoryDto;
  /** Overrides `category.productCount` when the caller has a fresher count. */
  count?: number;
  className?: string;
}

export function CategoryCard({ category, count, className }: CategoryCardProps) {
  const { lang, tu } = useLang();

  const name = localized(lang, category.nameEn, category.nameBn);
  const total = count ?? category.productCount;

  return (
    <Link
      href={`/category/${category.slug}`}
      className={cn('cc', className)}
      style={{
        ['--a' as string]: category.accentColor,
        ['--t' as string]: category.lightTintColor,
      }}
    >
      <div className="ci" aria-hidden="true">
        {category.iconEmoji}
      </div>
      <b>{name}</b>
      <small>
        {total.toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-US')}+ {tu('items')}
      </small>
    </Link>
  );
}
