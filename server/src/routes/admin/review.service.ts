/**
 * `/api/v1/admin/reviews` — the reviews module's data layer.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE RATING DECISION — option A, and why it is not option B
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The problem, measured on 2026-11-13 rather than quoted from a brief:
 *
 *   Review rows                                   0
 *   Products with reviewCount > 0                 168 of 168
 *   Sum of the claimed reviewCount                42,084
 *   Products with reviewCount > 150               119
 *   Mean stored ratingAvg                         4.40   (range 3.9 – 4.9)
 *
 * `seed.ts:698` copies `p.rating` and `p.reviewCount` straight out of the
 * reference catalog, and `seed.ts:496` says in as many words that reviews are
 * deliberately not seeded because "a fabricated customer review is not demo
 * data, it is a lie with a name on it." Both are true at once: the seed refuses
 * to invent reviews and then imports the invented *counts* of reviews. The
 * products table therefore advertises 42,084 reviews that do not exist.
 *
 * ── The three options ────────────────────────────────────────────────────────
 *
 *   A. Ratings stay as marketing copy. Moderation never recomputes the product
 *      aggregate. Documented as decoration.
 *
 *   B. Ratings are derived. Zero all 168 products and recompute from approved
 *      reviews. Honest, and consistent with the seed's own principle.
 *
 *   C. Seed real reviews. Contradicts seed.ts:496. Not without the owner.
 *
 * ── DECISION: A, with the recompute written, tested and deliberately unwired ──
 *
 * B is the honest answer and it is the one this module is built to switch to.
 * It is not applied here because it is a storefront-visible change and the brief
 * says to stop and report rather than apply it unilaterally. What B would do,
 * measured:
 *
 *   - 168 products lose their star rating (all of them, not most)
 *   - 119 products drop out of the homepage "best sellers" rail, which filters
 *     `reviewCount: { gt: 150 }` (homepage.service.ts:165) — that rail renders
 *     empty, not shorter
 *   - the "trending" rail (homepage.service.ts:144-150) sorts by ratingAvg and
 *     would reorder to an arbitrary tie
 *   - every product page shows "no reviews yet" instead of "4.2 (491)"
 *
 * That is the correct end state and the wrong thing to do in an admin phase
 * without the owner saying so. So:
 *
 *   `recomputeProductRating()` below is written, exported and tested. It is the
 *   exact function B needs. It is called by nothing in the request path — every
 *   mutation here passes `RATINGS_DERIVED = false` and skips it.
 *
 * A tested function that is deliberately unused is honest. A missing one is a
 * future bug, and the next agent would have to rediscover the whole argument.
 * To flip to B: set `RATINGS_DERIVED` to true, run the backfill in
 * `tools/reviews-backfill.mjs`, and delete the paragraph above.
 *
 * ── What "approve" means under A ─────────────────────────────────────────────
 *
 * Approving a review makes it visible on the storefront. It does not move the
 * product's stars, because the stars were never derived from reviews. The
 * drawer shows the product's current aggregate next to the review so the
 * moderator can see that for themselves rather than being told.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * STATE IS DERIVED, NOT STORED
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The schema has `isApproved`, `isFlagged` and (as of this pass) `moderatedAt`.
 * "Pending" and "rejected" are both `isApproved = false`; the only thing that
 * separates them is whether `moderatedAt` is set. That is the entire reason the
 * column was added — without it a rejected review returns to the pending queue
 * forever and the moderator sees the same item twice.
 *
 * Precedence is fixed and tested: flagged > rejected > approved > pending.
 * `reviewStateOf()` is the only place that decides it, and `reviewStateWhere()`
 * is the only place that turns it into SQL, so the list and the counts cannot
 * disagree about which rows belong to which tab.
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { HttpError, notFound } from '../../middleware/errorHandler.js';
import { withAudit } from '../../services/audit.service.js';
import type {
  AdminReviewListInput,
  ReviewBulkInput,
} from '../../validators/adminReview.schema.js';

/**
 * Whether approving a review recomputes the product's stored rating.
 *
 * FALSE is the shipped behaviour and it is a deliberate, documented choice —
 * see the header. Flipping this to true without also running the backfill
 * leaves 168 products advertising 42,084 reviews that no longer have rows
 * behind them, which is worse than either end state.
 */
export const RATINGS_DERIVED = false;

/** The acting user, for the audit row. Mirrors the inventory and orders modules. */
export interface Actor {
  userId: string;
  ipAddress: string | null;
}

/** The five tabs. `all` is the absence of a filter, not a state. */
export type ReviewState = 'pending' | 'approved' | 'rejected' | 'flagged' | 'all';

// ─── State derivation ──────────────────────────────────────────────────────

/** The three columns that decide a review's state. Nothing else is needed. */
interface StateFields {
  isApproved: boolean;
  isFlagged: boolean;
  moderatedAt: Date | null;
}

/**
 * The one definition of a review's state.
 *
 * Order matters and is the contract: a flagged review is flagged even if it was
 * approved, because the flag is the thing a moderator must act on. A rejected
 * review is rejected, not pending — that is the distinction `moderatedAt` was
 * added to make possible.
 */
export function reviewStateOf(row: StateFields): Exclude<ReviewState, 'all'> {
  if (row.isFlagged) return 'flagged';
  if (row.isApproved) return 'approved';
  if (row.moderatedAt) return 'rejected';
  return 'pending';
}

/**
 * Translates a tab into a Prisma `where` fragment.
 *
 * The single translation point. Both `listReviews` and `reviewCounts` call it,
 * so a tab and its count can never describe different row sets.
 */
export function reviewStateWhere(state: ReviewState): Prisma.ReviewWhereInput {
  switch (state) {
    case 'flagged':
      return { isFlagged: true };
    case 'approved':
      return { isApproved: true, isFlagged: false };
    case 'rejected':
      return { isApproved: false, isFlagged: false, moderatedAt: { not: null } };
    case 'pending':
      return { isApproved: false, isFlagged: false, moderatedAt: null };
    case 'all':
      return {};
  }
}

// ─── The recompute ─────────────────────────────────────────────────────────

/**
 * Recomputes `Product.ratingAvg` and `Product.reviewCount` from approved
 * reviews.
 *
 * Takes a transaction client, not the global one: the aggregate must move in the
 * same transaction as the review write that caused it, or a rollback leaves the
 * product advertising a rating for a review that was never approved.
 *
 * A product with no approved reviews is written as `ratingAvg = 0`,
 * `reviewCount = 0` — not left at its previous value. Leaving it would make the
 * function non-idempotent and would keep the fiction alive for any product whose
 * last review was rejected or deleted.
 *
 * NOT CALLED by any mutation in this file while `RATINGS_DERIVED` is false.
 * Tested directly, so the behaviour is proven and ready.
 */
export async function recomputeProductRating(
  tx: Prisma.TransactionClient,
  productId: string,
): Promise<{ ratingAvg: number; reviewCount: number }> {
  const aggregate = await tx.review.aggregate({
    where: { productId, isApproved: true },
    _avg: { rating: true },
    _count: { _all: true },
  });

  const reviewCount = aggregate._count._all;
  /**
   * Rounded to two decimals. `_avg` returns a float; storing 4.333333333333333
   * makes the storefront's own rounding the only thing standing between the
   * database and a number nobody can reproduce.
   */
  const ratingAvg = reviewCount === 0 ? 0 : Math.round((aggregate._avg.rating ?? 0) * 100) / 100;

  await tx.product.update({
    where: { id: productId },
    data: { ratingAvg, reviewCount },
  });

  return { ratingAvg, reviewCount };
}

/**
 * Applies the recompute only when the module is configured to derive ratings.
 *
 * One call site for the flag, so flipping it is a one-line change and no
 * mutation can accidentally disagree with the others.
 */
async function maybeRecompute(tx: Prisma.TransactionClient, productId: string): Promise<void> {
  if (!RATINGS_DERIVED) return;
  await recomputeProductRating(tx, productId);
}

// ─── Row shapes ────────────────────────────────────────────────────────────

export interface ReviewListItem {
  id: string;
  rating: number;
  titleEn: string | null;
  titleBn: string | null;
  /** First ~180 characters of the body, whichever language exists. */
  excerpt: string;
  product: { id: string; nameEn: string; nameBn: string };
  reviewer: { id: string; name: string };
  isVerifiedPurchase: boolean;
  isFlagged: boolean;
  state: Exclude<ReviewState, 'all'>;
  createdAt: string;
  moderatedAt: string | null;
  mediaCount: number;
}

export interface ReviewListResult {
  items: ReviewListItem[];
  total: number;
  page: number;
  limit: number;
}

export interface ReviewDetail extends Omit<ReviewListItem, 'excerpt'> {
  contentEn: string | null;
  contentBn: string | null;
  helpfulCount: number;
  moderatedBy: string | null;
  moderatedByName: string | null;
  media: Array<{ id: string; type: 'IMAGE' | 'VIDEO'; url: string }>;
  /**
   * The product's stored aggregate as it stands now, so the moderator can see
   * what approval would change. Under `RATINGS_DERIVED = false` it will not
   * change — the drawer says so in words rather than leaving the moderator to
   * discover it.
   */
  product: {
    id: string;
    nameEn: string;
    nameBn: string;
    ratingAvg: number;
    reviewCount: number;
    approvedReviewCount: number;
  };
}

export interface ReviewCounts {
  pending: number;
  approved: number;
  rejected: number;
  flagged: number;
  all: number;
}

// ─── Selects ───────────────────────────────────────────────────────────────

/**
 * The list select. Explicit fields, never `SELECT *` — AGENTS.md §7 and the
 * Phase 6 gate both require it, and `contentEn`/`contentBn` are `@db.Text`
 * columns that would drag the whole body of twenty reviews into a list payload
 * that only needs an excerpt.
 */
const REVIEW_LIST_SELECT = {
  id: true,
  rating: true,
  titleEn: true,
  titleBn: true,
  contentEn: true,
  contentBn: true,
  isVerifiedPurchase: true,
  isApproved: true,
  isFlagged: true,
  createdAt: true,
  moderatedAt: true,
  product: { select: { id: true, nameEn: true, nameBn: true } },
  user: { select: { id: true, name: true } },
  _count: { select: { media: true } },
} satisfies Prisma.ReviewSelect;

type ReviewListRow = Prisma.ReviewGetPayload<{ select: typeof REVIEW_LIST_SELECT }>;

/** Truncates on a word boundary where possible, so an excerpt reads like text. */
function excerptOf(contentEn: string | null, contentBn: string | null): string {
  const body = (contentEn ?? contentBn ?? '').replace(/\s+/g, ' ').trim();
  if (body.length <= 180) return body;

  const cut = body.slice(0, 180);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 120 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function toListItem(row: ReviewListRow): ReviewListItem {
  return {
    id: row.id,
    rating: row.rating,
    titleEn: row.titleEn,
    titleBn: row.titleBn,
    excerpt: excerptOf(row.contentEn, row.contentBn),
    product: row.product,
    reviewer: row.user,
    isVerifiedPurchase: row.isVerifiedPurchase,
    isFlagged: row.isFlagged,
    state: reviewStateOf(row),
    createdAt: row.createdAt.toISOString(),
    moderatedAt: row.moderatedAt?.toISOString() ?? null,
    mediaCount: row._count.media,
  };
}

// ─── List ──────────────────────────────────────────────────────────────────

/**
 * GET /admin/reviews
 *
 * `q` spans four columns across two tables. Prisma's `OR` handles it in one
 * query; the alternative — searching in memory — would mean fetching the whole
 * review table to filter it, which is the mistake `inventory.service.ts` had to
 * make deliberately and this module does not.
 */
export async function listReviews(input: AdminReviewListInput): Promise<ReviewListResult> {
  const where: Prisma.ReviewWhereInput = {
    ...reviewStateWhere(input.state),
    ...(input.rating !== undefined ? { rating: input.rating } : {}),
    ...(input.productId ? { productId: input.productId } : {}),
  };

  if (input.q) {
    const q = input.q;
    where.OR = [
      { titleEn: { contains: q } },
      { titleBn: { contains: q } },
      { contentEn: { contains: q } },
      { contentBn: { contains: q } },
      { user: { name: { contains: q } } },
      { product: { nameEn: { contains: q } } },
      { product: { nameBn: { contains: q } } },
    ];
  }

  const orderBy: Prisma.ReviewOrderByWithRelationInput =
    input.sort === 'oldest'
      ? { createdAt: 'asc' }
      : input.sort === 'rating_desc'
        ? { rating: 'desc' }
        : input.sort === 'rating_asc'
          ? { rating: 'asc' }
          : { createdAt: 'desc' };

  // Count and page in one round trip. `$transaction` with an array runs both on
  // the same connection, so the total cannot describe a different row set than
  // the page it accompanies.
  const [total, rows] = await prisma.$transaction([
    prisma.review.count({ where }),
    prisma.review.findMany({
      where,
      select: REVIEW_LIST_SELECT,
      orderBy,
      skip: (input.page - 1) * input.limit,
      take: input.limit,
    }),
  ]);

  return {
    items: rows.map(toListItem),
    total,
    page: input.page,
    limit: input.limit,
  };
}

// ─── Counts ────────────────────────────────────────────────────────────────

/**
 * GET /admin/reviews/counts — the five tab badges.
 *
 * One `groupBy` over the three state columns, not five `count()` calls. The
 * brief is explicit about this and it is also the only version that cannot
 * report a total that disagrees with its parts.
 *
 * `flagged` is counted independently of the other four because a flagged review
 * may also be approved — the tabs overlap by design, and `all` is the true total
 * rather than the sum of the tabs.
 */
export async function reviewCounts(): Promise<ReviewCounts> {
  const grouped = await prisma.review.groupBy({
    by: ['isApproved', 'isFlagged', 'moderatedAt'],
    _count: { _all: true },
  });

  const counts: ReviewCounts = { pending: 0, approved: 0, rejected: 0, flagged: 0, all: 0 };

  for (const row of grouped) {
    const n = row._count._all;
    counts.all += n;
    // Same derivation as `reviewStateOf`, applied to the grouped shape. Using
    // the shared function rather than re-deriving here is what keeps the badges
    // and the list in agreement.
    const state = reviewStateOf({
      isApproved: row.isApproved,
      isFlagged: row.isFlagged,
      moderatedAt: row.moderatedAt,
    });
    counts[state] += n;
  }

  return counts;
}

// ─── Detail ────────────────────────────────────────────────────────────────

export async function getReview(id: string): Promise<ReviewDetail> {
  const row = await prisma.review.findUnique({
    where: { id },
    select: {
      ...REVIEW_LIST_SELECT,
      helpfulCount: true,
      moderatedBy: true,
      media: { select: { id: true, type: true, url: true } },
    },
  });

  if (!row) throw notFound('Review');

  const [product, approvedReviewCount] = await Promise.all([
    prisma.product.findUnique({
      where: { id: row.product.id },
      select: { id: true, nameEn: true, nameBn: true, ratingAvg: true, reviewCount: true },
    }),
    prisma.review.count({ where: { productId: row.product.id, isApproved: true } }),
  ]);

  if (!product) throw notFound('Product');

  /**
   * The moderator's name, resolved separately rather than through a relation:
   * `moderatedBy` has no FK on purpose (a deleted staff account must not delete
   * the record of who moderated what), so Prisma cannot join it.
   */
  const moderator = row.moderatedBy
    ? await prisma.user.findUnique({ where: { id: row.moderatedBy }, select: { name: true } })
    : null;

  return {
    id: row.id,
    rating: row.rating,
    titleEn: row.titleEn,
    titleBn: row.titleBn,
    contentEn: row.contentEn,
    contentBn: row.contentBn,
    helpfulCount: row.helpfulCount,
    reviewer: row.user,
    isVerifiedPurchase: row.isVerifiedPurchase,
    isFlagged: row.isFlagged,
    state: reviewStateOf(row),
    createdAt: row.createdAt.toISOString(),
    moderatedAt: row.moderatedAt?.toISOString() ?? null,
    moderatedBy: row.moderatedBy,
    moderatedByName: moderator?.name ?? null,
    media: row.media,
    mediaCount: row._count.media,
    product: { ...product, approvedReviewCount },
  };
}

// ─── Mutations ─────────────────────────────────────────────────────────────

/**
 * The shared body of approve and reject.
 *
 * Both are the same write with a different boolean, so they share one function
 * and one transaction shape. Splitting them would be two places for the
 * aggregate recompute to drift out of.
 *
 * `alreadyInState` is a 409, not a silent no-op: an operator clicking Approve on
 * an approved review has a stale screen, and telling them so is more useful than
 * pretending the click did something.
 */
async function setApproval(
  id: string,
  approve: boolean,
  actor: Actor,
): Promise<ReviewDetail> {
  const existing = await prisma.review.findUnique({
    where: { id },
    select: { id: true, productId: true, isApproved: true, moderatedAt: true },
  });

  if (!existing) throw notFound('Review');

  if (existing.isApproved === approve) {
    throw new HttpError(
      409,
      'CONFLICT',
      approve
        ? 'This review is already approved.'
        : 'This review is already rejected.',
    );
  }

  await withAudit(
    {
      userId: actor.userId,
      action: approve ? 'review.approve' : 'review.reject',
      entity: 'review',
      entityId: id,
      changes: {
        isApproved: { from: existing.isApproved, to: approve },
        moderatedAt: { from: existing.moderatedAt?.toISOString() ?? null, to: 'now' },
      },
      ipAddress: actor.ipAddress,
    },
    async (tx) => {
      await tx.review.update({
        where: { id },
        data: {
          isApproved: approve,
          moderatedAt: new Date(),
          moderatedBy: actor.userId,
        },
      });

      // Same transaction as the review write. Under RATINGS_DERIVED = false this
      // is a no-op and the call is deliberately kept so the flip is one line.
      await maybeRecompute(tx, existing.productId);
    },
  );

  return getReview(id);
}

export async function approveReview(id: string, actor: Actor): Promise<ReviewDetail> {
  return setApproval(id, true, actor);
}

export async function rejectReview(id: string, actor: Actor): Promise<ReviewDetail> {
  return setApproval(id, false, actor);
}

/**
 * POST /:id/flag — toggles `isFlagged`.
 *
 * A toggle rather than a set, because the flag is the moderator's own bookmark
 * and the same button clears it. `moderatedAt`/`moderatedBy` are NOT touched:
 * flagging is not a moderation decision, and stamping it would move a pending
 * review out of the pending queue for no reason.
 */
export async function toggleFlag(id: string, actor: Actor): Promise<ReviewDetail> {
  const existing = await prisma.review.findUnique({
    where: { id },
    select: { id: true, isFlagged: true },
  });

  if (!existing) throw notFound('Review');

  const next = !existing.isFlagged;

  await withAudit(
    {
      userId: actor.userId,
      action: next ? 'review.flag' : 'review.unflag',
      entity: 'review',
      entityId: id,
      changes: { isFlagged: { from: existing.isFlagged, to: next } },
      ipAddress: actor.ipAddress,
    },
    async (tx) => {
      await tx.review.update({ where: { id }, data: { isFlagged: next } });
    },
  );

  return getReview(id);
}

/**
 * DELETE /:id — hard delete.
 *
 * The audit row is written BEFORE the delete and carries the row's content,
 * because after the delete there is nothing left to describe. `ReviewMedia`
 * cascades at the database level (`onDelete: Cascade` on the relation), so no
 * explicit media delete is needed — and adding one would be a second place that
 * has to stay in sync with the schema.
 *
 * The aggregate is recomputed in the same transaction: deleting an approved
 * review changes the average, and under RATINGS_DERIVED = false it does not —
 * but the call is here so the flip is one line, and so the test can prove the
 * recompute is correct when it is enabled.
 */
export async function deleteReview(id: string, actor: Actor): Promise<{ id: string }> {
  const existing = await prisma.review.findUnique({
    where: { id },
    select: {
      id: true,
      productId: true,
      rating: true,
      titleEn: true,
      titleBn: true,
      contentEn: true,
      contentBn: true,
      isApproved: true,
      isFlagged: true,
      userId: true,
      createdAt: true,
    },
  });

  if (!existing) throw notFound('Review');

  await withAudit(
    {
      userId: actor.userId,
      action: 'review.delete',
      entity: 'review',
      entityId: id,
      /**
       * The whole row, because this is the last moment it exists. This is the
       * one place where a full snapshot is correct rather than lazy — the audit
       * table is now the only record of what was removed.
       */
      changes: {
        deleted: {
          rating: existing.rating,
          titleEn: existing.titleEn,
          titleBn: existing.titleBn,
          contentEn: existing.contentEn,
          contentBn: existing.contentBn,
          isApproved: existing.isApproved,
          isFlagged: existing.isFlagged,
          userId: existing.userId,
          createdAt: existing.createdAt.toISOString(),
        },
      },
      ipAddress: actor.ipAddress,
    },
    async (tx) => {
      await tx.review.delete({ where: { id } });
      await maybeRecompute(tx, existing.productId);
    },
  );

  return { id };
}

/**
 * POST /bulk — approve, reject or flag many reviews.
 *
 * Same contract as the orders bulk bar: `{ updated, skipped[] }` with a reason
 * per skipped id. Never a silent partial success — if one id was already
 * approved, the caller is told which one and why, not just a smaller count.
 *
 * Each id runs through the single-row path, so the audit row, the 409 guard and
 * the recompute behave identically whether the moderator clicked one row or
 * selected twenty. The cost is N transactions; the benefit is one code path.
 */
export async function bulkModerate(
  input: ReviewBulkInput,
  actor: Actor,
): Promise<{ updated: string[]; skipped: Array<{ id: string; reason: string }> }> {
  const updated: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  for (const id of input.ids) {
    try {
      if (input.action === 'approve') await approveReview(id, actor);
      else if (input.action === 'reject') await rejectReview(id, actor);
      else await toggleFlag(id, actor);
      updated.push(id);
    } catch (error) {
      if (error instanceof HttpError) {
        skipped.push({ id, reason: error.message });
        continue;
      }
      throw error;
    }
  }

  return { updated, skipped };
}
