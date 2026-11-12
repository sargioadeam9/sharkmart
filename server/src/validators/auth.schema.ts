/**
 * Auth, profile, cart and checkout schemas — security.md §7.
 *
 * Every schema is `.strict()`: an unknown key is a 422, not a silently ignored
 * field. That is what stops `{ role: 'SUPER_ADMIN' }` riding along on a
 * registration body — a strict schema rejects the key before any handler sees
 * it, so mass-assignment is structurally impossible rather than a habit.
 */

import { z } from 'zod';

/**
 * Bangladesh mobile number.
 *
 * Real numbers are 11 digits starting `01`, or the same with a `+880` prefix.
 * The regex accepts the three forms a user actually types and normalises them
 * to `01XXXXXXXXX`, so the database holds one shape and a lookup by phone works
 * regardless of how it was entered.
 *
 * Deliberately not a "any 11 digits" check: `01234567890` is not a valid
 * operator prefix, and letting it through means an SMS that never arrives.
 */
export const bdPhone = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-]/g, ''))
  .refine(
    (value) => /^(?:\+?880|0)1[3-9]\d{8}$/.test(value),
    'Enter a valid Bangladesh mobile number (01XXXXXXXXX)',
  )
  .transform((value) => {
    const digits = value.replace(/^\+?880/, '');
    return digits.startsWith('0') ? digits : `0${digits}`;
  });

export const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address')
  .max(254);

/**
 * Password policy.
 *
 * 8 characters minimum, and it must contain a letter and a number. No symbol
 * requirement: forced symbols push users toward `Password1!` patterns, which
 * are weaker in practice than a longer passphrase. Length is the control that
 * actually helps, and the max of 128 is a bcrypt/DoS guard — bcrypt truncates
 * at 72 bytes, so anything beyond that is wasted work.
 */
export const passwordField = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long')
  .refine((value) => /[A-Za-z]/.test(value), 'Password must contain a letter')
  .refine((value) => /\d/.test(value), 'Password must contain a number');

export const nameField = z.string().trim().min(2, 'Name is too short').max(120);

// ─── Auth ────────────────────────────────────────────────────────────────

export const registerBody = z
  .object({
    name: nameField,
    email: emailField.optional(),
    phone: bdPhone.optional(),
    password: passwordField,
    language: z.enum(['bn', 'en']).default('bn'),
  })
  .strict()
  .refine((value) => Boolean(value.email || value.phone), {
    message: 'An email address or a phone number is required',
    path: ['email'],
  });

export const loginBody = z
  .object({
    /** Email or phone — one field, because the user thinks of it as "my login". */
    identifier: z.string().trim().min(3, 'Enter your email or phone').max(254),
    password: z.string().min(1, 'Enter your password').max(128),
  })
  .strict();

export const forgotPasswordBody = z
  .object({
    identifier: z.string().trim().min(3).max(254),
  })
  .strict();

export const resetPasswordBody = z
  .object({
    token: z.string().trim().min(16, 'Invalid reset token').max(256),
    password: passwordField,
  })
  .strict();

export const changePasswordBody = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: passwordField,
  })
  .strict();

// ─── Profile ─────────────────────────────────────────────────────────────

export const updateProfileBody = z
  .object({
    name: nameField.optional(),
    email: emailField.optional(),
    phone: bdPhone.optional(),
    language: z.enum(['bn', 'en']).optional(),
  })
  .strict();

// ─── Address ─────────────────────────────────────────────────────────────

/**
 * The eight administrative divisions of Bangladesh.
 *
 * The checkout cascade is division → district → area, and the division list is
 * closed — there are exactly eight and they have not changed since 2015. The
 * district and area lists are large and change rarely, so they are validated as
 * strings and checked against the client's cascade rather than an enum here.
 */
export const BD_DIVISIONS = [
  'Dhaka',
  'Chattogram',
  'Rajshahi',
  'Khulna',
  'Barishal',
  'Sylhet',
  'Rangpur',
  'Mymensingh',
] as const;

export const addressBody = z
  .object({
    label: z.string().trim().max(40).optional(),
    recipientName: nameField,
    phone: bdPhone,
    division: z.enum(BD_DIVISIONS),
    district: z.string().trim().min(2).max(80),
    area: z.string().trim().min(2).max(120),
    address: z.string().trim().min(5, 'Address is too short').max(500),
    postalCode: z
      .string()
      .trim()
      .regex(/^\d{4}$/, 'Postal code must be 4 digits')
      .optional(),
    isDefault: z.boolean().default(false),
  })
  .strict();

export const addressUpdateBody = addressBody.partial().strict();

export const idParams = z.object({ id: z.string().uuid('Invalid id') }).strict();

// ─── Cart ────────────────────────────────────────────────────────────────

export const cartItemBody = z
  .object({
    productId: z.string().min(1).max(64),
    variantId: z.string().min(1).max(64).nullable().optional(),
    quantity: z.number().int().min(1).max(99).default(1),
  })
  .strict();

export const cartQuantityBody = z
  .object({
    quantity: z.number().int().min(0).max(99),
  })
  .strict();

/**
 * Guest cart sync.
 *
 * The client sends what it has in localStorage. The server does not trust the
 * prices in it — only the product/variant ids and quantities — and re-resolves
 * everything from the database. A tampered local cart therefore cannot change
 * what an item costs.
 */
export const cartSyncBody = z
  .object({
    items: z
      .array(
        z
          .object({
            productId: z.string().min(1).max(64),
            variantId: z.string().min(1).max(64).nullable().optional(),
            quantity: z.number().int().min(1).max(99),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

// ─── Checkout ────────────────────────────────────────────────────────────

export const checkoutBody = z
  .object({
    /**
     * The client sends ids and quantities only. Prices, discounts, delivery and
     * the total are recomputed from the database — AGENTS.md §7.3. A `price`
     * field here would be a strict-schema rejection, which is the point.
     */
    items: z
      .array(
        z
          .object({
            productId: z.string().min(1).max(64),
            variantId: z.string().min(1).max(64).nullable().optional(),
            quantity: z.number().int().min(1).max(99),
          })
          .strict(),
      )
      .min(1, 'Your cart is empty')
      .max(100),

    /** A saved address id, or a full inline address for a guest / new address. */
    addressId: z.string().uuid().optional(),
    address: addressBody.omit({ isDefault: true }).partial().optional(),

    deliveryMethod: z.enum(['STANDARD', 'EXPRESS']).default('STANDARD'),
    paymentMethod: z.enum(['COD', 'BKASH', 'NAGAD', 'SSLCOMMERZ']).default('COD'),
    couponCode: z.string().trim().max(40).optional(),
    notes: z.string().trim().max(500).optional(),

    /** Guest checkout is legal in Bangladesh; a phone is required for it. */
    guestPhone: bdPhone.optional(),
    guestName: nameField.optional(),
  })
  .strict()
  .refine((value) => Boolean(value.addressId || value.address), {
    message: 'A delivery address is required',
    path: ['address'],
  });

export const verifyPaymentBody = z
  .object({
    orderNumber: z.string().trim().min(4).max(40),
    gateway: z.enum(['BKASH', 'NAGAD', 'SSLCOMMERZ']),
    /** The gateway's own transaction id — stored, never a card number. */
    transactionId: z.string().trim().min(1).max(120),
    status: z.enum(['SUCCESS', 'FAILED', 'CANCELLED']),
  })
  .strict();

// ─── Orders / tracking ───────────────────────────────────────────────────

export const trackParams = z
  .object({ orderNumber: z.string().trim().min(4).max(40) })
  .strict();

export const trackQuery = z
  .object({ phone: bdPhone })
  .strict();

export const orderListQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(10),
    status: z
      .enum([
        'PENDING',
        'CONFIRMED',
        'PROCESSING',
        'SHIPPED',
        'DELIVERED',
        'CANCELLED',
        'RETURNED',
        'REFUND_PENDING',
        'REFUNDED',
      ])
      .optional(),
  })
  .strict();

export const cancelOrderBody = z
  .object({ reason: z.string().trim().max(300).optional() })
  .strict();

export const returnOrderBody = z
  .object({
    reason: z.string().trim().min(5, 'Tell us why').max(500),
    itemIds: z.array(z.string().uuid()).min(1).optional(),
  })
  .strict();

// ─── Wishlist ────────────────────────────────────────────────────────────

export const wishlistBody = z
  .object({ productId: z.string().min(1).max(64) })
  .strict();

export const wishlistMergeBody = z
  .object({ productIds: z.array(z.string().min(1).max(64)).max(200) })
  .strict();
