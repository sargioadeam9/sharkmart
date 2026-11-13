/**
 * Zod schemas for the admin inventory API — security.md §7.
 *
 * Styled like `adminOrder.schema.ts`: every object is `.strict()`, numeric query
 * fields are coerced and bounded, and a body that cannot change anything is
 * rejected at the edge rather than writing a movement row that claims it did.
 *
 * Three rules specific to this surface:
 *
 *   1. **`reason` is mandatory and at least 5 characters.** An adjustment with
 *      no reason is untraceable: six months later the movement log says the
 *      count moved and nobody can say why. Optional would mean most rows have
 *      none, so it is required.
 *   2. **`mode` is explicit.** `delta` means "+5 on top of what is there",
 *      `set` means "the count is now 5". Inferring the mode from the sign of the
 *      number is how an operator who means "set to 5" silently adds 5.
 *   3. **No money, no cost.** `Product` has no cost field, so no schema here
 *      accepts or derives a stock value. A valuation column would be invented
 *      data.
 */

import { z } from 'zod';

export const ADMIN_INVENTORY_MAX_LIMIT = 100;
export const ADMIN_INVENTORY_DEFAULT_LIMIT = 20;

const page = z.coerce.number().int().min(1).default(1);
const limit = z.coerce
  .number()
  .int()
  .min(1)
  .max(ADMIN_INVENTORY_MAX_LIMIT)
  .default(ADMIN_INVENTORY_DEFAULT_LIMIT);

/**
 * The four stock buckets the screen filters by.
 *
 * Mirrors `stockStatusOf()` in mappers.ts:263 — `in`/`low`/`out` are the three
 * statuses, `all` is the absence of a filter. The thresholds are not repeated
 * here; the service derives the status and filters on it, so there is exactly
 * one definition of "low".
 */
export const INVENTORY_STOCK_FILTER = z.enum(['all', 'in', 'low', 'out']);

export const INVENTORY_SORT = z.enum([
  'stock_asc',
  'stock_desc',
  'name_asc',
  'name_desc',
  'updated',
]);

// ─── List ──────────────────────────────────────────────────────────────────

/**
 * The inventory list query.
 *
 * `q` matches product name (both languages) and SKU — the two things an
 * operator has in hand when they are reconciling a shelf. One box, because a
 * stock check never starts with "which field is this in".
 */
export const adminInventoryListQuery = z
  .object({
    page,
    limit,
    q: z.string().trim().min(1).max(120).optional(),
    categoryId: z.string().uuid('must be a category id').optional(),
    stock: INVENTORY_STOCK_FILTER.default('all'),
    sort: INVENTORY_SORT.default('name_asc'),
  })
  .strict();

export type AdminInventoryListInput = z.infer<typeof adminInventoryListQuery>;

// ─── Params ────────────────────────────────────────────────────────────────

export const inventoryProductParams = z
  .object({ productId: z.string().uuid('must be a product id') })
  .strict();

// ─── Adjust ────────────────────────────────────────────────────────────────

/**
 * POST /:productId/adjust — the single stock-write endpoint.
 *
 * One endpoint, not four. "Receive", "damage", "correction" and "return" are all
 * the same operation with a different reason string, and four endpoints would be
 * four places for the negative-stock guard to drift out of.
 *
 * `quantity` is an integer and may be negative in `delta` mode (a write-off) or
 * in `set` mode it must be >= 0 (you cannot set a count to -3). The service
 * enforces the result, not the input: `set` to 0 is legal, `delta` to a negative
 * result is a 422.
 */
export const inventoryAdjustBody = z
  .object({
    /** The amount. Signed only in `delta` mode; see the service. */
    quantity: z.number().int('must be a whole number of units'),
    mode: z.enum(['delta', 'set']),
    /** Why the count moved. Untraceable without it, so it is required. */
    reason: z
      .string()
      .trim()
      .min(5, 'a reason of at least 5 characters is required')
      .max(500),
    /**
     * Which variant. Required when the product has variants, forbidden when it
     * has none — the service decides, because only it knows the product.
     */
    variantId: z.string().uuid('must be a variant id').optional(),
    /**
     * Which warehouse. Only meaningful for a variant-less product, whose stock
     * lives in `WarehouseStock`. The service rejects it for a variant
     * adjustment, where the count is not per-warehouse.
     */
    warehouseId: z.string().uuid('must be a warehouse id').optional(),
  })
  .strict();

export type InventoryAdjustInput = z.infer<typeof inventoryAdjustBody>;

// ─── Movements ─────────────────────────────────────────────────────────────

/** Mirrors `enum MovementType` in schema.prisma. Read, not invented. */
export const MOVEMENT_TYPE = z.enum(['IN', 'OUT', 'ADJUSTMENT', 'TRANSFER', 'RETURN']);

/**
 * GET /movements — the stock movement log.
 *
 * `from`/`to` are ISO dates on `createdAt`, both inclusive of the day. Resolved
 * in the service, because "to" means end of day and a bare date is midnight.
 */
export const adminMovementsQuery = z
  .object({
    page,
    limit,
    productId: z.string().uuid('must be a product id').optional(),
    type: z.union([MOVEMENT_TYPE, z.literal('all')]).default('all'),
    from: z.string().date('must be a YYYY-MM-DD date').optional(),
    to: z.string().date('must be a YYYY-MM-DD date').optional(),
  })
  .strict()
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'from must be on or before to',
    path: ['from'],
  });

export type AdminMovementsInput = z.infer<typeof adminMovementsQuery>;
