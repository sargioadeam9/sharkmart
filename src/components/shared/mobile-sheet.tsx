'use client';

/**
 * MobileSheet — the reference's `.msheet` (oshoppingbd.html L512-517).
 *
 * Same a11y contract as Modal, but it slides from the bottom and is only
 * mounted below the 760px breakpoint. It is a `dialog` element in spirit but not
 * in tag: the reference's sheet is a plain div, and `role="dialog"` with
 * `aria-modal` gives the same semantics without fighting the browser's default
 * dialog styling.
 */

import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { useBodyScrollLock, useEscapeKey, useFocusReturn } from '@/lib/hooks';

export interface MobileSheetProps {
  open: boolean;
  onClose: () => void;
  label: string;
  closeLabel: string;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function MobileSheet({
  open,
  onClose,
  label,
  closeLabel,
  title,
  children,
  className,
}: MobileSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { capture, restore } = useFocusReturn();

  useBodyScrollLock(open);
  useEscapeKey(onClose, open);

  useEffect(() => {
    if (!open) return;
    capture();

    const id = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const first = panel.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? panel).focus();
    }, 0);

    return () => {
      window.clearTimeout(id);
      restore();
    };
  }, [open, capture, restore]);

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;

    const panel = panelRef.current;
    if (!panel) return;

    const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (node) => node.offsetParent !== null,
    );
    if (nodes.length === 0) return;

    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (!first || !last) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  // Keep the sheet mounted through the slide-out transition.
  if (!open) return null;

  return createPortal(
    <>
      <button
        type="button"
        className="fixed inset-0 z-[124] bg-[rgba(17,27,46,0.55)]"
        onClick={onClose}
        aria-label={closeLabel}
        tabIndex={-1}
      />
      <div
        ref={panelRef}
        className={cn('msheet open', className)}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        {title !== undefined ? (
          <h3>
            <b className="text-[18px]">{title}</b>
            <button
              type="button"
              onClick={onClose}
              aria-label={closeLabel}
              className="grid h-8 w-8 place-items-center rounded-full text-[16px] text-shop-muted hover:bg-shop-pink hover:text-shop-red"
            >
              ✕
            </button>
          </h3>
        ) : (
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full text-[16px] text-shop-muted hover:bg-shop-pink hover:text-shop-red"
          >
            ✕
          </button>
        )}
        {children}
      </div>
    </>,
    document.body,
  );
}
