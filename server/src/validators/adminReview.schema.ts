/**
 * Zod schemas for the admin reviews API — security.md §7.
 *
 * Styled like `adminInventory.schema.ts`: every object is `.strict()`, numeric
 * query fields are coerced and bounded, and a body that cannot change anything
 * is rejected at the edge.
 *
 * Three rules specific to this surface:
 *
 *   1. **`state` is a filter, not a stored column.** The database has
 *      `isApproved`, `isFlagged` and `moderatedAt`; "pending" and "rejected"
 *      are derived from those three. The enum here is the vocabulary the screen
 *      speaks, and `reviewStateWhere()` in the service is the single place that
 *      translates it into SQL. Duplicating that translation here is how the
 *      counts endpoint and the list endpoint start disagreeing.
 *
 *   2. **`limit` is capped at 100.** A moderation queue is read in pages; an
 *      unbounded limit is a table scan dressed as a request.
 *
 *   3. **Bulk ids are capped at 100.** The bulk bar selects a page, and a page
 *      is at most 100 rows. A larger payload is a client bug, not a feature.
 */

import { z } from 'zod';

export const ADMIN_REVIEW_MAX_LIMIT = 100;
export const ADMIN_REVIEW_DEFAULT_LIMIT = 20;
export const ADMIN_REVIEW_MAX_BULK = 100;

const page = z.coerce.number().int().min(1).default(1);
const limit = z.coerce
  .number()
  .int()
  .min(1)
  .max(ADMIN_REVIEW_MAX_LIMIT)
  .default(ADMIN_REVIEW_DEFAULT_LIMIT);

/**
 * The five tabs, plus `all`.
 *
 * `pending` is the default because the screen opens on the queue, not the
 * archive — an operator arriving here has work to do, and defaulting to `all`
 * would bury it under approved history.
 */
export const REVIEW_STATE = z.enum(['pending', 'approved', 'rejected', 'flagged', 'all']);

export const REVIEW_SORT = z.enum(['newest', 'oldest', 'rating_desc', 'rating_asc']);

// ─── List ──────────────────────────────────────────────────────────────────

/**
 * GET /admin/reviews
 *
 * `q` matches the reviewer's name, the review title and the review body, plus
 * the product name — one box, because a moderator looking for "the one about
 * the stitching" does not know which field that lives in.
 */
export const adminReviewListQuery = z
  .object({
    page,
    limit,
    q: z.string().trim().min(1).max(120).optional(),
    state: REVIEW_STATE.default('pending'),
    rating: z.coerce.number().int().min(1).max(5).optional(),
    productId: z.string().uuid('must be a product id').optional(),
    sort: REVIEW_SORT.default('newest'),
  })
  .strict();

export type AdminReviewListInput = z.infer<typeof adminReviewListQuery>;

// ─── Params ────────────────────────────────────────────────────────────────

export const reviewIdParams = z.object({ id: z.string().uuid('must be a review id') }).strict();

// ─── Bulk ──────────────────────────────────────────────────────────────────

/**
 * POST /admin/reviews/bulk
 *
 * `action` deliberately excludes `delete`. A bulk delete of reviews is a
 * destructive action with no undo, and the audit row for it would have to carry
 * the content of every deleted row to be useful — which is a payload nobody
 * reads. Bulk moderation is reversible; deletion stays a single-row action.
 */
export const reviewBulkBody = z
  .object({
    ids: z
      .array(z.string().uuid('every id must be a review id'))
      .min(1, 'select at least one review')
      .max(ADMIN_REVIEW_MAX_BULK, `at most ${ADMIN_REVIEW_MAX_BULK} reviews per request`),
    action: z.enum(['approve', 'reject', 'flag']),
  })
  .strict();

export type ReviewBulkInput = z.infer<typeof reviewBulkBody>;
