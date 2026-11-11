/**
 * Shared client hooks.
 *
 * Kept in one file on purpose: each is under 30 lines, and splitting them into
 * five files would add five imports to every component for no gain.
 */

'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useUiStore } from '@/lib/store/ui-store';
import { t as translate, translator, type TranslationKey, type TranslationVars } from '@/lib/i18n';
import { tUi, type UiKey } from '@/lib/i18n/ui';
import type { Lang } from '@/lib/format';

/**
 * The active language, plus a bound translator.
 *
 * `lang` starts as the persisted value. Because the store rehydrates on the
 * client, a Bangla user sees one frame of English before the swap; the
 * alternative (reading localStorage during render) is a hydration mismatch,
 * which is worse. Phase 2's layout will set the initial language server-side
 * from a cookie and this becomes exact.
 */
export function useLang(): {
  lang: Lang;
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
  t: (key: TranslationKey, vars?: TranslationVars) => string;
  tu: (key: UiKey, vars?: Record<string, string | number>) => string;
} {
  const lang = useUiStore((s) => s.lang);
  const setLang = useUiStore((s) => s.setLang);
  const toggleLang = useUiStore((s) => s.toggleLang);

  const t = useCallback(
    (key: TranslationKey, vars?: TranslationVars) => translate(lang, key, vars),
    [lang],
  );
  const tu = useCallback(
    (key: UiKey, vars?: Record<string, string | number>) => tUi(lang, key, vars),
    [lang],
  );

  return { lang, setLang, toggleLang, t, tu };
}

/** Server-safe translator for a known language — no hook, no store. */
export function boundTranslator(lang: Lang) {
  return translator(lang);
}

/**
 * Locks body scroll while `locked` is true, and compensates for the scrollbar
 * width so the page does not jump when it disappears.
 *
 * Reference count: two overlays can be mounted at once during a transition
 * (drawer closing while a modal opens). A naive boolean would unlock on the
 * first unmount and leave the page scrollable behind a modal.
 */
let lockCount = 0;
let savedOverflow = '';
let savedPaddingRight = '';

export function useBodyScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked) return;

    const body = document.body;

    if (lockCount === 0) {
      savedOverflow = body.style.overflow;
      savedPaddingRight = body.style.paddingRight;
      const gap = window.innerWidth - document.documentElement.clientWidth;
      body.style.overflow = 'hidden';
      if (gap > 0) body.style.paddingRight = `${gap}px`;
    }
    lockCount += 1;

    return () => {
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount === 0) {
        body.style.overflow = savedOverflow;
        body.style.paddingRight = savedPaddingRight;
      }
    };
  }, [locked]);
}

/**
 * Calls `onEscape` on Escape. Only the topmost overlay should own the key, so
 * pass `active` — an overlay that is mounted but closed must not listen.
 */
export function useEscapeKey(onEscape: () => void, active = true): void {
  useEffect(() => {
    if (!active) return;

    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onEscape();
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onEscape, active]);
}

/**
 * Returns focus to whatever was focused before the overlay opened.
 * Call `capture()` when opening, and the returned restore on close.
 */
export function useFocusReturn(): {
  capture: () => void;
  restore: () => void;
} {
  const previous = useRef<HTMLElement | null>(null);

  const capture = useCallback(() => {
    previous.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  }, []);

  const restore = useCallback(() => {
    const node = previous.current;
    previous.current = null;
    if (node && document.contains(node)) node.focus();
  }, []);

  return { capture, restore };
}

/** `prefers-reduced-motion: reduce`, live. */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

/**
 * Generic media query hook — used for the mobile breakpoint (760px).
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`: the media query
 * list IS an external store, and this is the pattern React documents for it. It
 * also gives the correct server snapshot (false) with no hydration mismatch,
 * which the effect version could not.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );

  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);
  const getServerSnapshot = useCallback(() => false, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** The reference's mobile breakpoint. */
export const MOBILE_QUERY = '(max-width: 760px)';

export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY);
}

/**
 * Has a persisted Zustand store finished rehydrating from localStorage?
 *
 * The persist middleware rehydrates in an effect after mount. Rendering real
 * persisted values before that is a hydration mismatch, so callers gate on this
 * and paint the server snapshot (empty) until it flips.
 *
 * Why the optional chaining: during Next's prerender the store module is
 * evaluated without a browser, and `store.persist` is not attached. Reading
 * `store.persist.onFinishHydration` there throws `Cannot read properties of
 * undefined` and fails the build. A missing persist API means "never hydrated",
 * which is exactly the correct server answer.
 */
export function useStoreHydrated(store: {
  persist?: {
    onFinishHydration: (fn: () => void) => () => void;
    hasHydrated: () => boolean;
  };
}): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const persistApi = store.persist;
      if (!persistApi) return () => {};
      return persistApi.onFinishHydration(onChange);
    },
    [store],
  );

  const getSnapshot = useCallback(
    () => store.persist?.hasHydrated() ?? false,
    [store],
  );

  const getServerSnapshot = useCallback(() => false, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Runs `callback` once the user has stopped typing for `delay` ms.
 * Used by the search bar so a keystroke does not fire a request.
 */
export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);

  return debounced;
}
