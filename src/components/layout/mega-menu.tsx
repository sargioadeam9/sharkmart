/**
 * MegaMenu — the reference's `#mega` + `mega(i)` (oshoppingbd.html L85-98,
 * markup L614, behaviour L800).
 *
 * Two panes: a scrollable category list on the left (accent icon tile + name),
 * and on the right the selected category's subcategory grid plus an accent
 * promo panel.
 *
 * Interaction rules:
 * - Desktop: hover-intent. Opening on `mouseenter` of the "All Categories"
 *   button, closing on `mouseleave` of the whole panel — the reference's
 *   click-only version feels broken on a mouse.
 * - The click that follows a hover-open must not toggle the panel shut (the
 *   pointer entered, opened it, and the user is now aiming at the panel). A
 *   hover-origin flag consumes that one click; a later click still closes.
 * - Keyboard: the button toggles with Enter/Space, Escape closes and returns
 *   focus to the button, and the category list is a real list of links so Tab
 *   walks it.
 * - Mobile: this component is not rendered at all (the mobile category sheet
 *   replaces it), so there is no click-vs-hover conflict to resolve.
 */

'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';

import type { CategoryDto } from '@/types/catalog';
import { localized } from '@/types/catalog';
import { useLang, useMediaQuery } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { MenuIcon } from '@/components/ui/icons';

export interface MegaMenuProps {
  categories: CategoryDto[];
  /** Close the menu (e.g. after navigation). */
  onNavigate?: () => void;
}

export function MegaMenu({ categories, onNavigate }: MegaMenuProps) {
  const { lang, t } = useLang();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  /**
   * Does this device have a real pointer? On a mouse, hovering the trigger
   * opens the menu — so a click must not *toggle* it shut again, which is what
   * a naive `setOpen(v => !v)` does (the pointer enters, opens, then the click
   * closes it and the button appears dead). On a touch device there is no
   * hover, so the click is the only way in and must toggle.
   */
  const canHover = useMediaQuery('(hover: hover)');

  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);

  /**
   * Was the current open state produced by hover rather than by a click or a
   * keypress? If so, the click that follows must not toggle it shut — the
   * pointer entered, the menu opened, and the user is now aiming at the panel.
   */
  const openedByHover = useRef(false);

  const active = categories[activeIndex] ?? categories[0];

  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  /**
   * A short delay before closing, so moving the pointer from the button down
   * into the panel does not dismiss it. 120ms is enough for a diagonal move
   * and short enough not to feel sticky.
   */
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      openedByHover.current = false;
      setOpen(false);
    }, 120);
  }, [cancelClose]);

  useEffect(() => cancelClose, [cancelClose]);

  // Escape closes and returns focus to the trigger.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      openedByHover.current = false;
      setOpen(false);
      buttonRef.current?.focus();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <div
      ref={rootRef}
      onMouseEnter={() => {
        cancelClose();
        openedByHover.current = true;
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
    >
      <button
        ref={buttonRef}
        type="button"
        className="allcat"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          // On a hover device the pointer has already opened the menu, so this
          // click is the user reaching for the panel, not asking to close it.
          // Consume the hover origin and leave the menu open.
          if (canHover && openedByHover.current) {
            openedByHover.current = false;
            return;
          }
          setOpen((v) => !v);
        }}
      >
        <MenuIcon />
        {t('allcat')}
      </button>

      <div
        id={panelId}
        className={cn('mega', open && 'open')}
        // Hidden from assistive tech and the tab order while collapsed.
        inert={!open}
      >
        <div className="in">
          <ul>
            {categories.map((category, index) => (
              <li key={category.id}>
                <Link
                  href={`/category/${category.slug}`}
                  className={cn(index === activeIndex && 'on')}
                  onMouseEnter={() => setActiveIndex(index)}
                  onFocus={() => setActiveIndex(index)}
                  onClick={onNavigate}
                >
                  <span
                    className="ic"
                    style={{ background: category.lightTintColor }}
                    aria-hidden="true"
                  >
                    {category.iconEmoji}
                  </span>
                  {localized(lang, category.nameEn, category.nameBn)}
                </Link>
              </li>
            ))}
          </ul>

          {active && (
            <div className="pn">
              <h3>
                <span
                  className="ic"
                  style={{
                    background: active.lightTintColor,
                    width: 32,
                    height: 32,
                    borderRadius: 9,
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 17,
                  }}
                  aria-hidden="true"
                >
                  {active.iconEmoji}
                </span>
                {localized(lang, active.nameEn, active.nameBn)}
              </h3>

              <div className="sg">
                {active.subcategories.map((sub) => (
                  <Link
                    key={sub.id}
                    href={`/category/${active.slug}?sub=${sub.slug}`}
                    onClick={onNavigate}
                  >
                    {localized(lang, sub.nameEn, sub.nameBn)}
                  </Link>
                ))}
              </div>

              <div
                className="ft"
                style={{ background: active.lightTintColor }}
              >
                <div>
                  <b>{localized(lang, active.nameEn, active.nameBn)}</b>
                  <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                    {active.productCount} {t('inst')}
                  </div>
                </div>
                <Link
                  href={`/category/${active.slug}`}
                  className="btn red"
                  style={{ padding: '9px 18px', fontSize: 13.5 }}
                  onClick={onNavigate}
                >
                  {t('shopBrand')}
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
