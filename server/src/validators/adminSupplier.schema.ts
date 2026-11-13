/**
 * Zod schemas for `/api/v1/admin/suppliers` (Phase 10 pass D).
 *
 * ── What this module owns ──────────────────────────────────────────────────
 *
 * A supplier directory, the products each supplier sells to us, and purchase
 * orders with receiving. The receiving half is the point: it is the only place in
 * the system that records "stock arrived", and without it the warehouse figure in
 * the inventory module has no upstream explanation.
 *
 * ── What it deliberately does not do yet ───────────────────────────────────
 *
 * Receiving records the movement but does not change stock. Stock is per
 * warehouse (`WarehouseStock`), there is exactly one warehouse today, and the
 * warehouse module (pass E) is where a receipt becomes a stock change. Writing
 * `ProductVariant.stock` here would be a second, conflicting way to do it.
 */

import { z } from 'zod';

const poisha = z.number().int().min(0);

/** BD mobile, tolerant of +880 / 01 prefixes — the shape the rest of the app uses. */
const phone = z
  .string()
  .trim()
  .min(6)
  .max(20)
  .regex(/^[+0-9][0-9\s-]{5,19}$/, 'phone must be digits, spaces, dashes, optional leading +');

export const supplierIdParams = z.object({ id: z.string().uuid() }).strict();
export const purchaseOrderIdParams = z.object({ id: z.string().uuid() }).strict();

export const adminSupplierListQuery = z
  .object({
    q: z.string().trim().max(120).optional(),
    active: z.enum(['all', 'true', 'false']).default('all'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    sort: z.enum(['newest', 'name', 'orders']).default('newest'),
  })
  .strict();

const supplierFields = {
  name: z.string().trim().min(1, 'name is required').max(120),
  contactPerson: z.string().trim().max(120).nullable().optional(),
  phone,
  email: z
    .string()
    .trim()
    .max(160)
    .refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v), 'must be a valid email')
    .nullable()
    .optional(),
  address: z.string().trim().max(400).nullable().optional(),
  isActive: z.boolean().default(true),
};

export const supplierCreateBody = z.object(supplierFields).strict();

export const supplierUpdateBody = z
  .object({
    name: supplierFields.name.optional(),
    contactPerson: supplierFields.contactPerson,
    phone: supplierFields.phone.optional(),
    email: supplierFields.email,
    address: supplierFields.address,
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one field must be provided',
  });

export const supplierActiveBody = z.object({ isActive: z.boolean() }).strict();

// ─── Supplier products ─────────────────────────────────────────────────────

export const supplierProductBody = z
  .object({
    productId: z.string().uuid(),
    costPricePoisha: poisha,
    leadDays: z.number().int().min(0).max(365).nullable().optional(),
  })
  .strict();

export const supplierProductParams = z
  .object({ id: z.string().uuid(), productId: z.string().uuid() })
  .strict();

// ─── Purchase orders ───────────────────────────────────────────────────────

export const adminPurchaseOrderListQuery = z
  .object({
    supplierId: z.string().uuid().optional(),
    status: z.enum(['all', 'DRAFT', 'ORDERED', 'PARTIAL', 'RECEIVED', 'CANCELLED']).default('all'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

const poItem = z
  .object({
    productId: z.string().uuid(),
    variantId: z.string().uuid().nullable().optional(),
    quantity: z.number().int().min(1),
    costPricePoisha: poisha,
  })
  .strict();

export const purchaseOrderCreateBody = z
  .object({
    supplierId: z.string().uuid(),
    notes: z.string().trim().max(1000).nullable().optional(),
    items: z.array(poItem).min(1, 'a purchase order needs at least one line').max(200),
  })
  .strict();

/**
 * Receiving one or more lines.
 *
 * `receivedQuantity` is a **delta** ("5 more arrived"), not a new total. A total
 * would make two people receiving the same shipment sequentially overwrite each
 * other; a delta composes, and the service clamps it so a line can never exceed
 * what was ordered.
 */
export const purchaseOrderReceiveBody = z
  .object({
    lines: z
      .array(
        z
          .object({
            itemId: z.string().uuid(),
            receivedQuantity: z.number().int().min(1),
          })
          .strict(),
      )
      .min(1)
      .max(200),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();

export const purchaseOrderCancelBody = z
  .object({ reason: z.string().trim().min(3, 'a reason is required').max(500) })
  .strict();

export type SupplierCreateInput = z.infer<typeof supplierCreateBody>;
export type SupplierUpdateInput = z.infer<typeof supplierUpdateBody>;
export type PurchaseOrderCreateInput = z.infer<typeof purchaseOrderCreateBody>;
