/**
 * Wishlist store.
 *
 * Stores ids only — a wishlist is a set of references, not a copy of the
 * catalog. The wishlist page resolves them against the API, so a product that
 * changed price shows the current price rather than a stale snapshot.
 *
 * Persistence: `sharkmart.wishlist`, versioned, same discard-on-mismatch rule
 * as the cart.
 */

'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const WISHLIST_STORE_VERSION = 1;

interface WishlistState {
  ids: string[];
  toggle: (productId: string) => boolean;
  add: (productId: string) => void;
  remove: (productId: string) => void;
  clear: () => void;
}

export const useWishlistStore = create<WishlistState>()(
  persist(
    (set, get) => ({
      ids: [],

      /** Returns the new state so the caller can pick the right toast. */
      toggle: (productId) => {
        const has = get().ids.includes(productId);
        set((state) => ({
          ids: has
            ? state.ids.filter((id) => id !== productId)
            : [...state.ids, productId],
        }));
        return !has;
      },

      add: (productId) =>
        set((state) =>
          state.ids.includes(productId)
            ? state
            : { ids: [...state.ids, productId] },
        ),

      remove: (productId) =>
        set((state) => ({
          ids: state.ids.filter((id) => id !== productId),
        })),

      clear: () => set({ ids: [] }),
    }),
    {
      name: 'sharkmart.wishlist',
      version: WISHLIST_STORE_VERSION,
      storage: createJSONStorage(() => localStorage),
      migrate: () => undefined,

      /**
       * Same shape guard as the cart: a blob can carry the right version and
       * still hold a non-array. `ids.includes` would throw on the first render.
       */
      merge: (persisted, current) => {
        const stored = persisted as { ids?: unknown } | undefined;
        if (!stored || !Array.isArray(stored.ids)) return current;

        const ids = stored.ids.filter(
          (id): id is string => typeof id === 'string' && id.length > 0,
        );
        if (ids.length !== stored.ids.length) return current;

        return { ...current, ids };
      },
      onRehydrateStorage: () => (_state, error) => {
        if (error) {
          try {
            localStorage.removeItem('sharkmart.wishlist');
          } catch {
            // Storage unavailable — nothing to clean up.
          }
        }
      },
      partialize: (state) => ({ ids: state.ids }),
    },
  ),
);

/** Non-reactive read, for event handlers that only need the current value. */
export function isWishlisted(productId: string): boolean {
  return useWishlistStore.getState().ids.includes(productId);
}
