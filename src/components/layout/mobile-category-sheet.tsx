/**
 * MobileCategorySheet — the reference's `.msheet` + `#msheet` (oshoppingbd.html
 * L512-520, markup L617).
 *
 * A three-column grid of accent tiles, opened from the bottom nav's Categories
 * item. Slides up from the bottom, closes on Escape, on the overlay, or on the
 * close button.
 *
 * The reference toggles a class on a pre-rendered element. Here the sheet is
 * always mounted (so the slide transition works) and `inert` keeps it out of
 * the tab order while closed.
 */

'use client';

import Link from 'next/link';

import type { CategoryDto } from '@/types/catalog';
import { localized } from '@/types/catalog';
import { useUiStore } from '@/lib/store/ui-store';
import { useLang, useBodyScrollLock, useEscapeKey } from '@/lib/hooks';
import { cn } from '@/lib/utils';

export interface MobileCategorySheetProps {
  categories: CategoryDto[];
}

export function MobileCategorySheet({ categories }: MobileCategorySheetProps) {
  const { lang, t, tu } = useLang();

  const open = useUiStore((s) => s.sheetOpen);
  const closeSheet = useUiStore((s) => s.closeSheet);

  useBodyScrollLock(open);
  useEscapeKey(closeSheet, open);

  return (
    <>
      <div
        className={cn('ov', open && 'open')}
        onClick={closeSheet}
        aria-hidden="true"
      />

      <div
        className={cn('msheet', open && 'open')}
        role="dialog"
        aria-modal="true"
        aria-label={t('allcat')}
        inert={!open}
      >
        <h3>
          <b style={{ fontSize: 18 }}>{t('allcat')}</b>
          <button
            type="button"
            className="x"
            onClick={closeSheet}
            aria-label={tu('close')}
          >
            ✕
          </button>
        </h3>

        <div className="mg">
          {categories.map((category) => (
            <Link
              key={category.id}
              href={`/category/${category.slug}`}
              onClick={closeSheet}
              style={{
                ['--a' as string]: category.accentColor,
                ['--t' as string]: category.lightTintColor,
              }}
            >
              <i aria-hidden="true">{category.iconEmoji}</i>
              {localized(lang, category.nameEn, category.nameBn)}
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
