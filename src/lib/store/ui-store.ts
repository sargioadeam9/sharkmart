/**
 * UI store — overlays and language.
 *
 * One store owns "what is open" so two overlays can never fight over the body
 * scroll lock or the Escape key. The rule: at most one of `drawer`, `sheet`,
 * `search` and `modal` is open at a time; opening one closes the others.
 *
 * Language is here rather than in a React context because it must be readable
 * from a client component without a provider, and it must survive a refresh.
 */

'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { DEFAULT_LANG, isLang } from '@/lib/i18n';
import type { Lang } from '@/lib/format';

export const UI_STORE_VERSION = 1;

export type ModalId = string | null;

interface UiState {
  lang: Lang;

  cartOpen: boolean;
  sheetOpen: boolean;
  searchOpen: boolean;
  modalId: ModalId;

  setLang: (lang: Lang) => void;
  toggleLang: () => void;

  openCart: () => void;
  closeCart: () => void;
  toggleCart: () => void;

  openSheet: () => void;
  closeSheet: () => void;

  openSearch: () => void;
  closeSearch: () => void;

  openModal: (id: string) => void;
  closeModal: () => void;

  closeAll: () => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      lang: DEFAULT_LANG,

      cartOpen: false,
      sheetOpen: false,
      searchOpen: false,
      modalId: null,

      setLang: (lang) => set({ lang }),

      toggleLang: () => set({ lang: get().lang === 'en' ? 'bn' : 'en' }),

      openCart: () =>
        set({ cartOpen: true, sheetOpen: false, searchOpen: false, modalId: null }),
      closeCart: () => set({ cartOpen: false }),
      toggleCart: () =>
        get().cartOpen ? set({ cartOpen: false }) : get().openCart(),

      openSheet: () =>
        set({ sheetOpen: true, cartOpen: false, searchOpen: false, modalId: null }),
      closeSheet: () => set({ sheetOpen: false }),

      openSearch: () =>
        set({ searchOpen: true, cartOpen: false, sheetOpen: false, modalId: null }),
      closeSearch: () => set({ searchOpen: false }),

      openModal: (id) =>
        set({ modalId: id, cartOpen: false, sheetOpen: false, searchOpen: false }),
      closeModal: () => set({ modalId: null }),

      closeAll: () =>
        set({ cartOpen: false, sheetOpen: false, searchOpen: false, modalId: null }),
    }),
    {
      name: 'sharkmart.ui',
      version: UI_STORE_VERSION,
      storage: createJSONStorage(() => localStorage),

      /**
       * Overlay state is transient — it must never come back open after a
       * refresh. Only the language is persisted.
       */
      partialize: (state) => ({ lang: state.lang }),

      merge: (persisted, current) => {
        const stored = persisted as { lang?: unknown } | undefined;
        return {
          ...current,
          lang: isLang(stored?.lang) ? stored.lang : current.lang,
        };
      },

      migrate: () => undefined,
      onRehydrateStorage: () => (_state, error) => {
        if (error) {
          try {
            localStorage.removeItem('sharkmart.ui');
          } catch {
            // Storage unavailable — nothing to clean up.
          }
        }
      },
    },
  ),
);
