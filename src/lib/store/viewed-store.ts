/**
 * Recently-viewed store.
 *
 * The reference keeps `st.viewed = [7,45,62,101,23,88]` — a hardcoded array of
 * product ids seeded at boot, so its "Recently Viewed" rail is really a demo
 * fixture. That is landmine #12 territory (seeded demo state), so this store
 * starts empty and fills as the user actually opens products.
 *
 * Ids only, newest first, capped. Same reasoning as the wishlist: a rail of
 * references, resolved against the catalog, so a price change shows the current
 * price rather than a stale snapshot.
 *
 * Persistence: `sharkmart.viewed`, versioned, same discard-on-mismatch rule and
 * the same shape guard as the cart and wishlist — a corrupt blob must not be
 * able to break the homepage.
 */

'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const VIEWED_STORE_VERSION = 1;

/** How many ids to keep. The reference shows 6; 12 gives a fuller rail. */
export const VIEWED_LIMIT = 12;

interface ViewedState {
  ids: string[];
  /** Records a view, moving an existing id to the front. */
  record: (productId: string) => void;
  clear: () => void;
}

export const useViewedStore = create<ViewedState>()(
  persist(
    (set) => ({
      ids: [],

      record: (productId) =>
        set((state) => {
          if (!productId) return state;

          const without = state.ids.filter((id) => id !== productId);
          return { ids: [productId, ...without].slice(0, VIEWED_LIMIT) };
        }),

      clear: () => set({ ids: [] }),
    }),
    {
      name: 'sharkmart.viewed',
      version: VIEWED_STORE_VERSION,
      storage: createJSONStorage(() => localStorage),
      migrate: () => undefined,

      merge: (persisted, current) => {
        const stored = persisted as { ids?: unknown } | undefined;
        if (!stored || !Array.isArray(stored.ids)) return current;

        const ids = stored.ids.filter(
          (id): id is string => typeof id === 'string' && id.length > 0,
        );
        if (ids.length !== stored.ids.length) return current;

        return { ...current, ids: ids.slice(0, VIEWED_LIMIT) };
      },
      onRehydrateStorage: () => (_state, error) => {
        if (error) {
          try {
            localStorage.removeItem('sharkmart.viewed');
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
export function recordView(productId: string): void {
  useViewedStore.getState().record(productId);
}
