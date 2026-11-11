/**
 * BrandTile — the reference's `.bt` (oshoppingbd.html L156-161, markup L649).
 *
 * The reference renders the brand name as text on a coloured tile because it
 * has no logo assets. When `logo` is present we show the image instead and keep
 * the tile as the frame, so a real logo drops in without a layout change.
 */

import Link from 'next/link';
import type { BrandDto } from '@/types/catalog';
import { localized } from '@/types/catalog';
import { cn } from '@/lib/utils';
import { useLang } from '@/lib/hooks';

export interface BrandTileProps {
  brand: BrandDto;
  className?: string;
}

/** The reference's default tile colour when a brand has none. */
const FALLBACK_COLOR = '#253858';

export function BrandTile({ brand, className }: BrandTileProps) {
  const { lang } = useLang();

  const name = localized(lang, brand.nameEn, brand.nameBn);
  const tagline = localized(lang, brand.taglineEn, brand.taglineBn);
  const color = brand.color ?? FALLBACK_COLOR;

  return (
    <Link
      href={`/brand/${brand.slug}`}
      className={cn('bt', className)}
      style={{ ['--bc' as string]: color }}
    >
      <div className="lg">
        {brand.logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- brand logos are not yet in the asset pipeline; next/image in Phase 6.
          <img
            src={brand.logo}
            alt={name}
            className="max-h-[44px] w-auto object-contain"
            loading="lazy"
          />
        ) : (
          name
        )}
      </div>
      <b>{name}</b>
      {tagline && <small>{tagline}</small>}
    </Link>
  );
}
