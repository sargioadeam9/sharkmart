/**
 * Cart store.
 *
 * Money is integer poisha everywhere. The store never formats — the edge does,
 * via `formatMoney()`.
 *
 * Why a line carries display fields (name, image, tint) instead of just a
 * productId: the cart drawer must render instantly after a refresh, on a cold
 * page, with no catalog fetch in flight. A line that only held an id would make
 * the drawer depend on a network round-trip to show a product name it already
 * knew when the item was added. The trade-off is that a renamed product shows
 * its old name until the line is re-added — acceptable, and the server
 * re-resolves price and name at checkout anyway (AGENTS.md §7.3: never trust
 * client money).
 *
 * Persistence: localStorage under `sharkmart.cart`, with a `version`. A stored
 * blob from an older or corrupt shape is dropped, not merged — a half-parsed
 * cart is worse than an empty one.
 */

'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/** Bump when `CartLine` changes shape. Old blobs are discarded on mismatch. */
export const CART_STORE_VERSION = 1;

export interface CartLine {
  /** Product id — `prd_osb-1001`. */
  productId: string;
  slug: string;
  sku: string;
  nameEn: string;
  nameBn: string;
  /** Main image URL, or null when the product has no image. */
  imageUrl: string | null;
  /** Emoji fallback the reference renders when there is no photo. */
  emoji: string | null;
  /** Category light tint — the card's radial-gradient stop. */
  tint: string;

  /** What this line costs per unit, in poisha, variant delta already applied. */
  unitPricePoisha: number;
  /** Struck-through per-unit price, 0 when there is no discount. */
  originalUnitPricePoisha: number;

  variantId: string | null;
  variantNameEn: string | null;
  variantNameBn: string | null;

  quantity: number;
  /** Stock at the time it was added — the stepper's ceiling. */
  stockQuantity: number;
}

export interface CartTotals {
  subtotalPoisha: number;
  discountPoisha: number;
  deliveryFeePoisha: number;
  totalPoisha: number;
  itemCount: number;
  lineCount: number;
}

interface CartState {
  lines: CartLine[];

  addLine: (line: CartLine, quantity?: number) => void;
  removeLine: (productId: string, variantId: string | null) => void;
  setQuantity: (productId: string, variantId: string | null, quantity: number) => void;
  increment: (productId: string, variantId: string | null) => void;
  decrement: (productId: string, variantId: string | null) => void;
  clear: () => void;
}

/** Two lines are the same line when product AND variant match. */
function sameLine(
  line: CartLine,
  productId: string,
  variantId: string | null,
): boolean {
  return line.productId === productId && line.variantId === variantId;
}

function clampQuantity(quantity: number, stockQuantity: number): number {
  const ceiling = stockQuantity > 0 ? stockQuantity : 0;
  return Math.max(0, Math.min(Math.floor(quantity), ceiling));
}

/**
 * A stored line is only trusted if every field it needs at render time is the
 * right type. Anything else and the drawer would throw on `formatMoney(undefined)`.
 */
function isCartLine(value: unknown): value is CartLine {
  if (typeof value !== 'object' || value === null) return false;
  const line = value as Record<string, unknown>;

  return (
    typeof line.productId === 'string' &&
    typeof line.slug === 'string' &&
    typeof line.sku === 'string' &&
    typeof line.nameEn === 'string' &&
    typeof line.nameBn === 'string' &&
    (line.imageUrl === null || typeof line.imageUrl === 'string') &&
    (line.emoji === null || typeof line.emoji === 'string') &&
    typeof line.tint === 'string' &&
    typeof line.unitPricePoisha === 'number' &&
    Number.isFinite(line.unitPricePoisha) &&
    typeof line.originalUnitPricePoisha === 'number' &&
    Number.isFinite(line.originalUnitPricePoisha) &&
    typeof line.quantity === 'number' &&
    Number.isFinite(line.quantity) &&
    line.quantity > 0 &&
    typeof line.stockQuantity === 'number' &&
    Number.isFinite(line.stockQuantity)
  );
}

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      lines: [],

      addLine: (line, quantity = 1) =>
        set((state) => {
          const existing = state.lines.find((l) =>
            sameLine(l, line.productId, line.variantId),
          );

          if (existing) {
            return {
              lines: state.lines.map((l) =>
                sameLine(l, line.productId, line.variantId)
                  ? {
                      ...l,
                      quantity: clampQuantity(
                        l.quantity + quantity,
                        l.stockQuantity,
                      ),
                    }
                  : l,
              ),
            };
          }

          const nextQuantity = clampQuantity(quantity, line.stockQuantity);
          if (nextQuantity <= 0) return state;

          return { lines: [...state.lines, { ...line, quantity: nextQuantity }] };
        }),

      removeLine: (productId, variantId) =>
        set((state) => ({
          lines: state.lines.filter((l) => !sameLine(l, productId, variantId)),
        })),

      /** Quantity 0 removes the line — the reference's behaviour (drawer spec). */
      setQuantity: (productId, variantId, quantity) =>
        set((state) => {
          const target = state.lines.find((l) =>
            sameLine(l, productId, variantId),
          );
          if (!target) return state;

          const next = clampQuantity(quantity, target.stockQuantity);
          if (next <= 0) {
            return {
              lines: state.lines.filter(
                (l) => !sameLine(l, productId, variantId),
              ),
            };
          }

          return {
            lines: state.lines.map((l) =>
              sameLine(l, productId, variantId) ? { ...l, quantity: next } : l,
            ),
          };
        }),

      increment: (productId, variantId) =>
        set((state) => ({
          lines: state.lines.map((l) =>
            sameLine(l, productId, variantId)
              ? { ...l, quantity: clampQuantity(l.quantity + 1, l.stockQuantity) }
              : l,
          ),
        })),

      decrement: (productId, variantId) =>
        set((state) => ({
          lines: state.lines
            .map((l) =>
              sameLine(l, productId, variantId)
                ? { ...l, quantity: l.quantity - 1 }
                : l,
            )
            .filter((l) => l.quantity > 0),
        })),

      clear: () => set({ lines: [] }),
    }),
    {
      name: 'sharkmart.cart',
      version: CART_STORE_VERSION,
      storage: createJSONStorage(() => localStorage),

      /**
       * Runs when the stored version differs from the current one. Returning
       * `undefined` discards the blob. We deliberately do not attempt to
       * migrate a cart: prices and stock are stale by definition, and a
       * resurrected cart with last month's prices is a support ticket, not a
       * feature.
       */
      migrate: () => undefined,

      /**
       * Shape validation. A blob can carry the right `version` and still hold
       * garbage — a half-written value, a hand-edited entry, a payload from a
       * build where `lines` was a different type. `migrate` never runs in that
       * case, so without this the store rehydrates `lines: "NOT_AN_ARRAY"` and
       * the first `.reduce()` throws during render.
       *
       * Anything that is not an array of well-formed lines is dropped whole.
       * A lost cart is recoverable; a white screen is not.
       */
      merge: (persisted, current) => {
        const stored = persisted as { lines?: unknown } | undefined;
        if (!stored || !Array.isArray(stored.lines)) return current;

        const lines = stored.lines.filter(isCartLine);
        if (lines.length !== stored.lines.length) return current;

        return { ...current, lines };
      },

      /** A corrupt blob throws inside `getItem`; swallow it and start clean. */
      onRehydrateStorage: () => (_state, error) => {
        if (error) {
          try {
            localStorage.removeItem('sharkmart.cart');
          } catch {
            // Private mode / storage disabled — nothing to clean up.
          }
        }
      },

      /** Only the lines are worth persisting. */
      partialize: (state) => ({ lines: state.lines }),
    },
  ),
);

/** Total quantity across all lines — the header badge. */
export function cartItemCount(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}
