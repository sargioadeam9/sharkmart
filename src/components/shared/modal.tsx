'use client';

/**
 * Modal — the reference's `.mo` (oshoppingbd.html L425-430).
 *
 * Behaviour the reference gets wrong and we do not:
 *   - Escape closes it.
 *   - Focus moves into the dialog on open and returns to the trigger on close.
 *   - Tab is trapped inside the dialog while it is open.
 *   - Body scroll is locked.
 *   - The backdrop is a real button, so a click outside is keyboard-reachable
 *     rather than a div with an onClick.
 */

import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { useBodyScrollLock, useEscapeKey, useFocusReturn } from '@/lib/hooks';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name — required, since the reference's modal has no heading id. */
  label: string;
  /** Accessible name for the close button. */
  closeLabel: string;
  children: ReactNode;
  /** Max width override; the reference uses 860px. */
  maxWidth?: string;
  className?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  label,
  closeLabel,
  children,
  maxWidth,
  className,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { capture, restore } = useFocusReturn();

  useBodyScrollLock(open);
  useEscapeKey(onClose, open);

  // Capture the trigger before the dialog takes focus, restore it on close.
  useEffect(() => {
    if (!open) return;
    capture();

    // Move focus to the first focusable element inside the panel.
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

  if (!open) return null;

  return createPortal(
    <div className="mo open">
      <button
        type="button"
        className="bg"
        onClick={onClose}
        aria-label={closeLabel}
        tabIndex={-1}
      />
      <div
        ref={panelRef}
        className={cn('cd2', className)}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        style={maxWidth ? { maxWidth } : undefined}
        onKeyDown={onKeyDown}
      >
        <button
          type="button"
          className="x grid h-9 w-9 place-items-center rounded-full bg-white text-[18px] text-shop-navy shadow-[0_2px_8px_rgba(0,0,0,0.12)]"
          onClick={onClose}
          aria-label={closeLabel}
        >
          ✕
        </button>
        {children}
      </div>
    </div>,
    document.body,
  );
}
