/**
 * Zod schemas for `/api/v1/admin/pos` (Phase 10 pass M).
 *
 * ── The money rule, again ──────────────────────────────────────────────────
 *
 * Every amount on the wire is an integer number of poisha. The till's keypad
 * works in taka because that is what a cashier reads off a note, but the
 * conversion happens in the screen, not here — `Math.round(taka * 100)` in
 * `toPoisha()`. A float reaching this file is rejected by `.int()` rather than
 * silently rounded, because a rounding bug in a till is a drawer that never
 * balances.
 *
 * ── Why `clientRef` is required ────────────────────────────────────────────
 *
 * A till is a touchscreen operated at speed. "Complete sale" gets double-tapped,
 * and the network on a shop counter is often a phone hotspot. Without a
 * client-generated reference, the retry rings the goods up a second time, the
 * drawer is short by one basket, and nobody can prove which sale was the
 * phantom. `clientRef` is a uuid the screen makes once per basket; the API
 * stores it on the order with a unique index and returns the first sale on a
 * replay. It is required, not optional, because an optional idempotency key is
 * an idempotency key that will be forgotten.
 */

import { z } from 'zod';
import { bdPhone } from './auth.schema.js';

/**
 * A poisha amount on the till.
 *
 * The ceiling is 10 lakh taka (৳10,00,000) per line or per drawer count. It is
 * not a business rule about what a shop may sell — it is a typo guard: a
 * cashier who types a price into the quantity field should get a validation
 * error, not a ৳4,00,000 sale that has to be refunded and explained.
 */
const poishaAmount = z.number().int().min(0).max(100_000_000);

export const posSessionIdParams = z.object({ id: z.string().uuid() }).strict();

export const posSaleIdParams = z.object({ id: z.string().uuid() }).strict();

// ─── Shift ─────────────────────────────────────────────────────────────────

export const posSessionOpenBody = z
  .object({
    /** The float already in the drawer. Zero is a legitimate answer. */
    openingCashPoisha: poishaAmount.default(0),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const posSessionCloseBody = z
  .object({
    /**
     * What the cashier physically counted. Required — a shift cannot be closed
     * on an assumption, or the variance column means nothing.
     */
    countedCashPoisha: poishaAmount,
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const posSessionListQuery = z
  .object({
    status: z.enum(['all', 'open', 'closed']).default('all'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

// ─── Catalog search for the till ───────────────────────────────────────────

export const posCatalogQuery = z
  .object({
    /**
     * Free text: product name in either language, product SKU, or a variant SKU
     * (which is what a barcode scanner types — see `src/lib/barcode.ts`).
     */
    q: z.string().trim().max(120).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

// ─── A sale ────────────────────────────────────────────────────────────────

const saleItem = z
  .object({
    productId: z.string().uuid(),
    variantId: z.string().uuid().nullable().optional(),
    quantity: z.number().int().min(1).max(999),
  })
  .strict();

export const posSaleBody = z
  .object({
    clientRef: z.string().uuid(),
    items: z.array(saleItem).min(1, 'A sale needs at least one item').max(50),
    paymentMethod: z.enum(['CASH', 'CARD', 'BKASH', 'NAGAD']),
    /**
     * Cash handed over. Required for CASH, ignored for the rest (the API sets it
     * to the total). Not defaulted, because "0 tendered" and "not asked" are
     * different mistakes and the error message should say which one happened.
     */
    cashReceivedPoisha: poishaAmount.optional(),
    /** A manual counter discount. Capped in the service, not here. */
    discountPoisha: poishaAmount.default(0),
    customerName: z.string().trim().max(120).optional(),
    customerPhone: bdPhone.optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const posSaleListQuery = z
  .object({
    sessionId: z.string().uuid().optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export type PosSessionOpenInput = z.infer<typeof posSessionOpenBody>;
export type PosSessionCloseInput = z.infer<typeof posSessionCloseBody>;
export type PosCatalogQuery = z.infer<typeof posCatalogQuery>;
export type PosSaleInput = z.infer<typeof posSaleBody>;
