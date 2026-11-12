/**
 * FloatingButtons — the reference's `.fl` (oshoppingbd.html L440-454, markup
 * L618).
 *
 * Two round buttons pinned bottom-right: a cart (red, with a live count) and a
 * support bubble that expands into WhatsApp / Messenger / AI assistant.
 *
 * The support popup is a disclosure, not a modal: it sits above the button,
 * closes on Escape and on an outside click, and does not lock body scroll.
 * Below 760px the whole stack moves up to `bottom: 78px` so it clears the
 * bottom nav.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useEffectiveCart } from '@/lib/hooks/use-effective-cart';
import { useUiStore } from '@/lib/store/ui-store';
import { useLang } from '@/lib/hooks';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { toast } from '@/components/shared/toast';
import { CartIcon } from '@/components/ui/icons';

/** The three support channels the reference offers. */
const SUPPORT_CHANNELS = [
  { label: 'WhatsApp', emoji: '💬', color: '#25D366' },
  { label: 'Messenger', emoji: '✉️', color: '#0084ff' },
  { label: 'AI Shopping Assistant', emoji: '✨', color: 'var(--red)' },
];

export function FloatingButtons() {
  const { lang, tu } = useLang();

  /**
   * The effective cart, not the local store.
   *
   * A signed-in shopper's cart lives on the server; the local store is cleared
   * after a successful merge. Reading `useCartStore` here meant this button sat
   * at 0 over a cart with a line in it — the same disagreement the header badge
   * had before `useEffectiveCart` existed.
   */
  const cartCount = useEffectiveCart().itemCount;
  const openCart = useUiStore((s) => s.openCart);

  const [supportOpen, setSupportOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const closeSupport = useCallback(() => setSupportOpen(false), []);

  // Escape closes the popup; an outside click does too.
  useEffect(() => {
    if (!supportOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSupport();
    };

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) closeSupport();
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [supportOpen, closeSupport]);

  return (
    <div className="fl" ref={rootRef}>
      <div className={cn('sup', supportOpen && 'open')}>
        {SUPPORT_CHANNELS.map((channel) => (
          <a
            key={channel.label}
            href="#"
            onClick={(event) => {
              event.preventDefault();
              closeSupport();
              toast(channel.label);
            }}
          >
            <i style={{ background: channel.color }} aria-hidden="true">
              {channel.emoji}
            </i>
            {channel.label}
          </a>
        ))}
      </div>

      <button
        type="button"
        className="f fm"
        aria-label={tu('support')}
        aria-expanded={supportOpen}
        onClick={() => setSupportOpen((v) => !v)}
      >
        💬
      </button>

      <button
        type="button"
        className="f fc"
        onClick={openCart}
        aria-label={tu('openCart')}
      >
        <CartIcon />
        <b className="cnt">{formatNumber(cartCount, lang)}</b>
      </button>
    </div>
  );
}
