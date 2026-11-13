/**
 * Zod schemas for `/api/v1/admin/coupons` (Phase 10 pass A).
 *
 * The rules here mirror what `applyCoupon()` enforces at checkout — not the other
 * way round. If a coupon can be saved here but cannot be redeemed there, the
 * operator has built something that looks live and silently refuses every
 * customer. So every limit that exists in `order.service.ts` has a matching
 * validation rule here, and the two are tested together.
 *
 * Money is integer poisha, as everywhere else. `value` is the one exception: for
 * `FIXED` it is poisha, for `PERCENTAGE` it is a whole number 1-100, and for
 * `FREE_DELIVERY` it is ignored. The `.superRefine` below is what keeps those
 * three meanings from bleeding into each other.
 */

import { z } from 'zod';

/** Poisha: a non-negative integer. Floats are rejected, not rounded. */
const poishaNonNegative = z.number().int().min(0);

/**
 * A coupon code the customer will type. Upper-cased on the way in because
 * `applyCoupon()` looks up `code.toUpperCase()` — storing lower case would mean
 * the code in the admin panel is not the code the customer must enter.
 */
const code = z
  .string()
  .trim()
  .min(3, 'code must be at least 3 characters')
  .max(32, 'code must be at most 32 characters')
  .regex(/^[A-Za-z0-9_-]+$/, 'code may contain letters, digits, hyphen and underscore only')
  .transform((value) => value.toUpperCase());

const idList = z.array(z.string().uuid()).max(500).nullable().optional();

const isoDate = z.string().datetime({ offset: true });

export const couponIdParams = z.object({ id: z.string().uuid() }).strict();

export const adminCouponListQuery = z
  .object({
    q: z.string().trim().max(64).optional(),
    type: z.enum(['FIXED', 'PERCENTAGE', 'FREE_DELIVERY']).optional(),
    /**
     * `state` is derived from dates and counters, never stored:
     *   live      active, inside its window, and under its usage cap
     *   scheduled active, but the window has not opened yet
     *   expired   the window has closed
     *   exhausted the usage cap is reached
     *   inactive  isActive is false
     * Derived state cannot drift from the row the way a stored status column
     * would, and `applyCoupon()` already recomputes all of it at purchase time.
     */
    state: z.enum(['all', 'live', 'scheduled', 'expired', 'exhausted', 'inactive']).default('all'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    sort: z.enum(['newest', 'oldest', 'used', 'ending']).default('newest'),
  })
  .strict();

const couponFields = {
  code,
  type: z.enum(['FIXED', 'PERCENTAGE', 'FREE_DELIVERY']),
  value: poishaNonNegative,
  minOrderValuePoisha: poishaNonNegative.nullable().optional(),
  maxDiscountPoisha: poishaNonNegative.nullable().optional(),
  usageLimit: z.number().int().min(1).nullable().optional(),
  /**
   * Minimum 1, not 0.
   *
   * `applyCoupon()` compares `used >= perUserLimit`, so a stored 0 would block
   * every signed-in customer on their first attempt — a coupon that is valid and
   * unusable. There is no "unlimited" value here because the column's default is
   * 1; unlimited per-user use is expressed by omitting the check, which this
   * module does not offer.
   */
  perUserLimit: z.number().int().min(1).max(1000).default(1),
  startDate: isoDate,
  endDate: isoDate,
  applicableCategories: idList,
  applicableBrands: idList,
  applicableProducts: idList,
  isActive: z.boolean().default(true),
};

export const couponCreateBody = z
  .object(couponFields)
  .strict()
  .superRefine((value, ctx) => {
    if (value.type === 'PERCENTAGE') {
      if (value.value < 1 || value.value > 100) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['value'],
          message: 'a percentage coupon needs a value between 1 and 100',
        });
      }
    } else if (value.type === 'FIXED') {
      if (value.value <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['value'],
          message: 'a fixed coupon needs a value above zero',
        });
      }
    }

    if (new Date(value.endDate) <= new Date(value.startDate)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: 'endDate must be after startDate',
      });
    }
  });

/**
 * A partial update.
 *
 * The cross-field rules (percentage range, window order) cannot be checked here
 * because a patch may legitimately carry only one side of a pair — `endDate`
 * alone, for instance. They are re-checked in the service against the merged row,
 * but only for the fields the patch actually touches, which is the lesson from
 * the product-edit P0: a partial update must never be rejected by a stored value
 * the client did not send.
 */
export const couponUpdateBody = z
  .object({
    code: code.optional(),
    type: z.enum(['FIXED', 'PERCENTAGE', 'FREE_DELIVERY']).optional(),
    value: poishaNonNegative.optional(),
    minOrderValuePoisha: poishaNonNegative.nullable().optional(),
    maxDiscountPoisha: poishaNonNegative.nullable().optional(),
    usageLimit: z.number().int().min(1).nullable().optional(),
    perUserLimit: z.number().int().min(1).max(1000).optional(),
    startDate: isoDate.optional(),
    endDate: isoDate.optional(),
    applicableCategories: idList,
    applicableBrands: idList,
    applicableProducts: idList,
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one field must be provided',
  });

export const couponActiveBody = z.object({ isActive: z.boolean() }).strict();

/** The redemption report's query. One coupon, newest first. */
export const couponRedemptionQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export type CouponCreateInput = z.infer<typeof couponCreateBody>;
export type CouponUpdateInput = z.infer<typeof couponUpdateBody>;
export type CouponListQuery = z.infer<typeof adminCouponListQuery>;
