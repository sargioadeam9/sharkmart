'use client';

/**
 * Toast store + `<Toaster />`.
 *
 * The reference has exactly one toast element (`#toast`, oshoppingbd.html
 * L452-454) and one `toast()` function that replaces its text and restarts a
 * 2.2s timer. That is the right model for this storefront: a queue of toasts
 * stacking up the screen is noise on a shop, and the reference never does it.
 *
 * So: one visible toast at a time, a new one replaces the old, and the timer
 * restarts. The store holds the message; `<Toaster />` owns the animation.
 */

import { create } from 'zustand';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export const TOAST_DURATION_MS = 2200;

export interface ToastMessage {
  id: number;
  text: string;
  tone: 'success' | 'info' | 'error';
}

interface ToastState {
  current: ToastMessage | null;
  show: (text: string, tone?: ToastMessage['tone']) => void;
  hide: () => void;
}

let nextId = 1;

export const useToastStore = create<ToastState>((set) => ({
  current: null,
  show: (text, tone = 'success') =>
    set({ current: { id: nextId++, text, tone } }),
  hide: () => set({ current: null }),
}));

/** Imperative helper — callable from any event handler, no hook needed. */
export function toast(text: string, tone: ToastMessage['tone'] = 'success'): void {
  useToastStore.getState().show(text, tone);
}

/**
 * Mount once, near the root. Renders the reference's `.toast` element and
 * manages the show/hide transition and the auto-dismiss timer.
 */
export function Toaster() {
  const current = useToastStore((s) => s.current);
  const hide = useToastStore((s) => s.hide);

  // Keep the last message mounted through the exit transition.
  const [visible, setVisible] = useState<ToastMessage | null>(null);
  const timer = useRef<number | null>(null);

  // Adjust during render instead of in an effect: a new message must appear in
  // the same paint that set it, otherwise the toast flashes the previous text.
  const [lastId, setLastId] = useState<number | null>(null);
  if ((current?.id ?? null) !== lastId) {
    setLastId(current?.id ?? null);
    if (current) setVisible(current);
  }

  useEffect(() => {
    if (!current) return;

    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      hide();
      timer.current = null;
    }, TOAST_DURATION_MS);

    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [current, hide]);

  // Clear the rendered text only after the fade-out finishes.
  useEffect(() => {
    if (current) return;
    const id = window.setTimeout(() => setVisible(null), 320);
    return () => window.clearTimeout(id);
  }, [current]);

  if (!visible) return null;

  const isShown = current !== null;

  return (
    <div
      className={cn('toast', isShown && 'show')}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <i aria-hidden="true">
        {visible.tone === 'error' ? '!' : visible.tone === 'info' ? 'i' : '✓'}
      </i>
      {visible.text}
    </div>
  );
}
