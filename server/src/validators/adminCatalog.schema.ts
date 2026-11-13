/**
 * Zod schemas for the admin catalog API — categories and brands.
 *
 * Styled like `adminReview.schema.ts`: every object is `.strict()`, so an
 * unknown key is a 422 rather than a silently ignored typo, and every body that
 * could not change anything is rejected at the edge.
 *
 * ── Three rules specific to this surface ─────────────────────────────────────
 *
 *   1. **`nameEn` is NOT unique and must not be validated as if it were.**
 *      The seed has three categories called "Accessories" and two each called
 *      "Footwear", "Stationery", "Tools" and "Toys". They are different
 *      categories under different parents. Only `slug` is unique, so only
 *      `slug` gets a conflict check. A "duplicate name" error here would be
 *      rejecting valid data.
 *
 *   2. **`sortOrder` is not accepted from the client on create or update.**
 *      It is assigned by the service (append to the end of the parent) and
 *      changed only through `/reorder`, which renumbers a whole sibling group
 *      in one transaction. Letting a PATCH set `sortOrder` directly is how the
 *      current data got 15 rows sharing `sortOrder = 0`.
 *
 *   3. **`parentId` accepts `null` explicitly.** `null` means "make this a root
 *      category", which is a real operation, and `.optional()` alone would make
 *      it impossible to express. The service still rejects a cycle.
 */

import { z } from 'zod';

export const ADMIN_CATALOG_MAX_REORDER = 200;

/** `all` is a filter, not a stored value. Mirrors the screen's segmented control. */
export const ACTIVE_FILTER = z.enum(['all', 'true', 'false']);

export const CATEGORY_VIEW = z.enum(['tree', 'flat']);

export const BRAND_SORT = z.enum(['sortOrder', 'name', 'products']);

/** A hex colour, or `null` to clear it. The 84 NULLs are legitimate data. */
const hexColor = z
  .string()
  .trim()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'must be a hex colour like #C51F4B');

const slug = z
  .string()
  .trim()
  .min(2, 'a slug needs at least 2 characters')
  .max(80, 'a slug is at most 80 characters')
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase letters, numbers and single hyphens only');

const name = z.string().trim().min(1, 'required').max(120, 'at most 120 characters');

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `at most ${max} characters`)
    .nullish()
    .transform((value) => (value === '' ? null : (value ?? null)));

// ─── Categories ─────────────────────────────────────────────────────────────

/**
 * GET /admin/categories
 *
 * `view=tree` is the default because the screen is a tree. `flat` exists for
 * the picker and for the duplicate-name check: three "Accessories" rows are
 * only visible side by side in a flat list.
 */
export const adminCategoryListQuery = z
  .object({
    view: CATEGORY_VIEW.default('tree'),
    q: z.string().trim().min(1).max(120).optional(),
    active: ACTIVE_FILTER.default('all'),
  })
  .strict();

export type AdminCategoryListInput = z.infer<typeof adminCategoryListQuery>;

export const categoryIdParams = z
  .object({ id: z.string().uuid('must be a category id') })
  .strict();

/**
 * POST /admin/categories
 *
 * `parentId` is nullable: `null` creates a root. The service refuses a parent
 * that does not exist, and refuses a third level — the storefront's mega menu
 * renders exactly two (`CategoryDto.subcategories`), so a grandchild would be
 * created and then never shown anywhere. That is a data decision, not a UI one,
 * and it is documented in the service header.
 */
export const categoryCreateBody = z
  .object({
    slug,
    nameEn: name,
    nameBn: name,
    parentId: z.string().uuid('must be a category id').nullable().default(null),
    iconEmoji: optionalText(16),
    bannerImage: optionalText(500),
    accentColor: hexColor.nullish().transform((value) => value ?? null),
    lightTintColor: hexColor.nullish().transform((value) => value ?? null),
    isActive: z.boolean().default(true),
    metaTitleEn: optionalText(200),
    metaTitleBn: optionalText(200),
    metaDescEn: optionalText(400),
    metaDescBn: optionalText(400),
  })
  .strict();

export type CategoryCreateInput = z.infer<typeof categoryCreateBody>;

/**
 * PATCH /admin/categories/:id
 *
 * Every field optional; at least one required, because a PATCH that changes
 * nothing should not write an audit row claiming it did.
 *
 * `parentId` is `.nullable().optional()` — absent means "leave the parent
 * alone", `null` means "promote to root". Those are different requests and
 * collapsing them is how a rename silently re-roots a subtree.
 */
export const categoryUpdateBody = z
  .object({
    slug: slug.optional(),
    nameEn: name.optional(),
    nameBn: name.optional(),
    parentId: z.string().uuid('must be a category id').nullable().optional(),
    iconEmoji: optionalText(16).optional(),
    bannerImage: optionalText(500).optional(),
    accentColor: hexColor.nullish().optional(),
    lightTintColor: hexColor.nullish().optional(),
    isActive: z.boolean().optional(),
    metaTitleEn: optionalText(200).optional(),
    metaTitleBn: optionalText(200).optional(),
    metaDescEn: optionalText(400).optional(),
    metaDescBn: optionalText(400).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'send at least one field to change',
  });

export type CategoryUpdateInput = z.infer<typeof categoryUpdateBody>;

// ─── Brands ─────────────────────────────────────────────────────────────────

export const adminBrandListQuery = z
  .object({
    q: z.string().trim().min(1).max(120).optional(),
    active: ACTIVE_FILTER.default('all'),
    sort: BRAND_SORT.default('sortOrder'),
  })
  .strict();

export type AdminBrandListInput = z.infer<typeof adminBrandListQuery>;

export const brandIdParams = z.object({ id: z.string().uuid('must be a brand id') }).strict();

export const brandCreateBody = z
  .object({
    slug,
    nameEn: name,
    nameBn: name,
    logo: optionalText(500),
    taglineEn: optionalText(160),
    taglineBn: optionalText(160),
    color: hexColor.nullish().transform((value) => value ?? null),
    isOwnBrand: z.boolean().default(false),
    isActive: z.boolean().default(true),
  })
  .strict();

export type BrandCreateInput = z.infer<typeof brandCreateBody>;

export const brandUpdateBody = z
  .object({
    slug: slug.optional(),
    nameEn: name.optional(),
    nameBn: name.optional(),
    logo: optionalText(500).optional(),
    taglineEn: optionalText(160).optional(),
    taglineBn: optionalText(160).optional(),
    color: hexColor.nullish().optional(),
    isOwnBrand: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'send at least one field to change',
  });

export type BrandUpdateInput = z.infer<typeof brandUpdateBody>;

// ─── Shared: reorder and active toggle ──────────────────────────────────────

/**
 * POST /admin/{categories,brands}/:id/reorder
 *
 * `orderedIds` is the complete sibling group in its new order, not a pair of
 * swapped ids. A whole-group renumber is idempotent: sending the same list
 * twice writes the same `sortOrder` values, so a retried request cannot leave
 * the group half-renumbered. A swap endpoint cannot make that promise.
 *
 * The service verifies every id belongs to the same parent as `:id`, so a
 * crafted list cannot renumber another parent's children.
 */
export const reorderBody = z
  .object({
    orderedIds: z
      .array(z.string().uuid('every id must be a uuid'))
      .min(1, 'send at least one id')
      .max(ADMIN_CATALOG_MAX_REORDER, `at most ${ADMIN_CATALOG_MAX_REORDER} ids per request`)
      .refine((ids) => new Set(ids).size === ids.length, 'the list contains a duplicate id'),
  })
  .strict();

export type ReorderInput = z.infer<typeof reorderBody>;

/** POST /admin/{categories,brands}/:id/active — explicit, not a toggle. */
export const activeBody = z.object({ isActive: z.boolean() }).strict();

export type ActiveInput = z.infer<typeof activeBody>;

/**
 * DELETE query for brands.
 *
 * `detach=true` is the operator explicitly accepting that the brand's products
 * lose their brand. Without it, a brand with products is a 409. The flag is a
 * query parameter rather than a body because DELETE bodies are not reliably
 * forwarded by proxies.
 */
export const brandDeleteQuery = z
  .object({ detach: z.enum(['true', 'false']).default('false') })
  .strict();

/**
 * DELETE query for categories.
 *
 * `reparent=true` promotes a parent's children to root instead of refusing.
 * Same reasoning as `detach`: the destructive path must be asked for by name.
 */
export const categoryDeleteQuery = z
  .object({ reparent: z.enum(['true', 'false']).default('false') })
  .strict();
