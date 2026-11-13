/**
 * Zod schemas for the public catalog API — security.md §7.
 *
 * Every schema is `.strict()`: an unknown query key is a 422, not a silently
 * ignored typo. `?catgory=fashion` must fail loudly rather than return the
 * whole catalog and look like it worked.
 *
 * Numbers arrive as strings on the query string, so every numeric field is
 * `coerce`d and bounded. Bounds are not decoration: `limit=100000` is a
 * denial-of-service on a public endpoint.
 */

import { z } from 'zod';

/** Page size ceiling. The storefront asks for 200 on rails; 100 is the public cap. */
export const MAX_LIMIT = 100;
export const DEFAULT_LIMIT = 20;

const page = z.coerce.number().int().min(1).default(1);
const limit = z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT);

/** A slug: lowercase, digits, hyphens. Rejects path traversal before it reaches Prisma. */
const slug = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a lowercase slug');

const sortKey = z
  .enum(['relevance', 'newest', 'popular', 'price_asc', 'price_desc', 'rating'])
  .default('relevance');

/** `?stock=1` / `?discount=true` — both spellings accepted, one meaning. */
const booleanish = z
  .union([z.literal('1'), z.literal('0'), z.literal('true'), z.literal('false')])
  .transform((value) => value === '1' || value === 'true');

export const productListQuery = z
  .object({
    page,
    limit,
    category: slug.optional(),
    brand: slug.optional(),
    q: z.string().trim().min(1).max(120).optional(),
    minPricePoisha: z.coerce.number().int().min(0).optional(),
    maxPricePoisha: z.coerce.number().int().min(0).optional(),
    inStockOnly: booleanish.optional(),
    onDiscountOnly: booleanish.optional(),
    ratingMin: z.coerce.number().min(0).max(5).optional(),
    sort: sortKey,
  })
  .strict()
  .refine(
    (value) =>
      value.minPricePoisha === undefined ||
      value.maxPricePoisha === undefined ||
      value.minPricePoisha <= value.maxPricePoisha,
    {
      message: 'minPricePoisha must be less than or equal to maxPricePoisha',
      path: ['minPricePoisha'],
    },
  );

export type ProductListQueryInput = z.infer<typeof productListQuery>;

export const slugParams = z.object({ slug }).strict();

export const searchQuery = z
  .object({
    q: z.string().trim().min(1, 'q is required').max(120),
    page,
    limit,
  })
  .strict();

export const slugsQuery = z
  .object({
    /** Bounded so `generateStaticParams` cannot ask for the whole catalog. */
    limit: z.coerce.number().int().min(1).max(500).default(200),
  })
  .strict();

export const categoryProductsQuery = z
  .object({
    page,
    limit,
    sort: sortKey,
  })
  .strict();

export const landingParams = z.object({ slug }).strict();

/**
 * The landing page's one-page order form.
 *
 * No price field on purpose: the product's current price is the price, and a
 * campaign page that could name its own would be an unaudited discount path.
 */
export const landingOrderBody = z
  .object({
    name: z.string().trim().min(2).max(120),
    phone: z
      .string()
      .trim()
      .min(6)
      .max(20)
      .regex(/^[+0-9][0-9\s-]{5,19}$/, 'phone must be digits, spaces, dashes, optional leading +'),
    address: z.string().trim().min(5).max(400),
    quantity: z.number().int().min(1).max(10).default(1),
  })
  .strict();
