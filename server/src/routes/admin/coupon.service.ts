/**
 * `/api/v1/admin/coupons` — the coupon module of Phase 10 pass A.
 *
 * ── Why the derived state exists ────────────────────────────────────────────
 *
 * A coupon's "state" is not a column. It is the product of `isActive`, the
 * window (`startDate`/`endDate`) and the usage counter, and `applyCoupon()`
 * recomputes all of it at purchase time. Storing a status column would mean two
 * sources of truth that drift the moment a clock passes midnight or a counter
 * hits its cap.
 *
 * So the five states are expressed as `where` clauses, which keeps them
 * filterable *in SQL*. That matters: post-filtering in JS would make `total`
 * disagree with the number of rows the operator can actually page through.
 *
 *   inactive   isActive = false
 *   expired    isActive = true, endDate < now
 *   scheduled  isActive = true, startDate > now
 *   exhausted  isActive = true, in window, usedCount >= usageLimit
 *   live       isActive = true, in window, under cap
 *
 * The five are mutually exclusive, which is why the counts add up to the total.
 *
 * ── Why delete is restricted ────────────────────────────────────────────────
 *
 * `order.couponId` is `ON DELETE SET NULL`. Deleting a redeemed coupon would not
 * fail — it would quietly erase the record of which coupon paid for which order,
 * and the redemption report would lose its history. A coupon that has ever been
 * used is therefore deactivated, never deleted.
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { HttpError, notFound } from '../../middleware/errorHandler.js';
import { withAudit, diffChanges } from '../../services/audit.service.js';
import type {
  CouponCreateInput,
  CouponListQuery,
  CouponUpdateInput,
} from '../../validators/adminCoupon.schema.js';

export interface Actor {
  userId: string;
  ipAddress: string | null;
}

export type CouponState = 'live' | 'scheduled' | 'expired' | 'exhausted' | 'inactive';

/** Named refusals, carried in `details.reason` — same convention as the other modules. */
export type CouponRefusal = 'COUPON_IN_USE' | 'COUPON_DUPLICATE_CODE';

export interface CouponRow {
  id: string;
  code: string;
  type: 'FIXED' | 'PERCENTAGE' | 'FREE_DELIVERY';
  value: number;
  minOrderValuePoisha: number | null;
  maxDiscountPoisha: number | null;
  usageLimit: number | null;
  usedCount: number;
  perUserLimit: number;
  startDate: string;
  endDate: string;
  applicableCategories: string[] | null;
  applicableBrands: string[] | null;
  applicableProducts: string[] | null;
  isActive: boolean;
  state: CouponState;
  redemptionTotalPoisha: number;
  createdAt: string;
}

/** The columns the wire DTO is built from. Explicit, never `SELECT *`. */
const COUPON_SELECT = {
  id: true,
  code: true,
  type: true,
  value: true,
  minOrderValuePoisha: true,
  maxDiscountPoisha: true,
  usageLimit: true,
  usedCount: true,
  perUserLimit: true,
  startDate: true,
  endDate: true,
  applicableCategories: true,
  applicableBrands: true,
  applicableProducts: true,
  isActive: true,
  createdAt: true,
} satisfies Prisma.CouponSelect;

type CouponDbRow = Prisma.CouponGetPayload<{ select: typeof COUPON_SELECT }>;

/**
 * Derives the state from the row. One function, used by the list mapper, the
 * detail mapper and the tests, so the three can never disagree.
 */
export function stateOf(
  row: Pick<CouponDbRow, 'isActive' | 'startDate' | 'endDate' | 'usageLimit' | 'usedCount'>,
  now: Date = new Date(),
): CouponState {
  if (!row.isActive) return 'inactive';
  if (row.endDate < now) return 'expired';
  if (row.startDate > now) return 'scheduled';
  if (row.usageLimit !== null && row.usedCount >= row.usageLimit) return 'exhausted';
  return 'live';
}

/** The `where` clause for a state filter, kept in SQL so `total` stays honest. */
function stateWhere(state: CouponListQuery['state'], now: Date): Prisma.CouponWhereInput {
  switch (state) {
    case 'inactive':
      return { isActive: false };
    case 'expired':
      return { isActive: true, endDate: { lt: now } };
    case 'scheduled':
      return { isActive: true, startDate: { gt: now } };
    case 'exhausted':
      return {
        isActive: true,
        startDate: { lte: now },
        endDate: { gte: now },
        usageLimit: { not: null },
        usedCount: { gte: prisma.coupon.fields.usageLimit },
      };
    case 'live':
      return {
        isActive: true,
        startDate: { lte: now },
        endDate: { gte: now },
        OR: [{ usageLimit: null }, { usedCount: { lt: prisma.coupon.fields.usageLimit } }],
      };
    default:
      return {};
  }
}

function orderByFor(sort: CouponListQuery['sort']): Prisma.CouponOrderByWithRelationInput[] {
  switch (sort) {
    case 'oldest':
      return [{ createdAt: 'asc' }];
    case 'used':
      return [{ usedCount: 'desc' }, { createdAt: 'desc' }];
    case 'ending':
      // Soonest to expire first. An already-expired coupon sorts last, which is
      // what an operator watching the pipeline wants.
      return [{ endDate: 'asc' }];
    default:
      return [{ createdAt: 'desc' }];
  }
}

function toDto(row: CouponDbRow, redemptionTotalPoisha: number, now: Date): CouponRow {
  return {
    id: row.id,
    code: row.code,
    type: row.type,
    value: row.value,
    minOrderValuePoisha: row.minOrderValuePoisha,
    maxDiscountPoisha: row.maxDiscountPoisha,
    usageLimit: row.usageLimit,
    usedCount: row.usedCount,
    perUserLimit: row.perUserLimit,
    startDate: row.startDate.toISOString(),
    endDate: row.endDate.toISOString(),
    applicableCategories: (row.applicableCategories as string[] | null) ?? null,
    applicableBrands: (row.applicableBrands as string[] | null) ?? null,
    applicableProducts: (row.applicableProducts as string[] | null) ?? null,
    isActive: row.isActive,
    state: stateOf(row, now),
    redemptionTotalPoisha,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface CouponListResult {
  items: CouponRow[];
  total: number;
  page: number;
  limit: number;
}

export async function listCoupons(query: CouponListQuery): Promise<CouponListResult> {
  const now = new Date();

  const where: Prisma.CouponWhereInput = {
    ...stateWhere(query.state, now),
    ...(query.type ? { type: query.type } : {}),
    ...(query.q ? { code: { contains: query.q.toUpperCase() } } : {}),
  };

  const skip = (query.page - 1) * query.limit;

  const [rows, total] = await Promise.all([
    prisma.coupon.findMany({
      where,
      select: COUPON_SELECT,
      orderBy: orderByFor(query.sort),
      skip,
      take: query.limit,
    }),
    prisma.coupon.count({ where }),
  ]);

  // One grouped query for the whole page, not one per row.
  const sums =
    rows.length === 0
      ? []
      : await prisma.couponRedemption.groupBy({
          by: ['couponId'],
          where: { couponId: { in: rows.map((row) => row.id) } },
          _sum: { amountPoisha: true },
        });
  const sumByCoupon = new Map(sums.map((row) => [row.couponId, row._sum.amountPoisha ?? 0]));

  return {
    items: rows.map((row) => toDto(row, sumByCoupon.get(row.id) ?? 0, now)),
    total,
    page: query.page,
    limit: query.limit,
  };
}

export async function getCoupon(id: string): Promise<CouponRow & { redemptions: number }> {
  const now = new Date();
  const row = await prisma.coupon.findUnique({ where: { id }, select: COUPON_SELECT });
  if (!row) throw notFound('Coupon');

  const agg = await prisma.couponRedemption.aggregate({
    where: { couponId: id },
    _sum: { amountPoisha: true },
    _count: { _all: true },
  });

  return {
    ...toDto(row, agg._sum.amountPoisha ?? 0, now),
    redemptions: agg._count._all,
  };
}

/** Counts for the state tabs. Five counts in one round trip, not five. */
export async function couponCounts(): Promise<Record<CouponState | 'all', number>> {
  const now = new Date();

  // Written out rather than mapped over an array: a spread of `number[]` loses
  // the tuple type, and the five counts are the whole point of this function.
  const [all, live, scheduled, expired, exhausted, inactive] = await Promise.all([
    prisma.coupon.count(),
    prisma.coupon.count({ where: stateWhere('live', now) }),
    prisma.coupon.count({ where: stateWhere('scheduled', now) }),
    prisma.coupon.count({ where: stateWhere('expired', now) }),
    prisma.coupon.count({ where: stateWhere('exhausted', now) }),
    prisma.coupon.count({ where: stateWhere('inactive', now) }),
  ]);

  return { all, live, scheduled, expired, exhausted, inactive };
}

/**
 * Maps a Prisma unique violation on `code` to a 409.
 *
 * Same treatment as the product module: a duplicate slug or SKU is an operator
 * mistake with a clear remedy, not a 500. Without this the client gets a stack
 * trace instead of "that code already exists".
 */
function asDuplicateCode(error: unknown): never {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  ) {
    throw new HttpError(409, 'CONFLICT', 'A coupon with that code already exists.', {
      reason: 'COUPON_DUPLICATE_CODE' satisfies CouponRefusal,
      field: 'code',
    });
  }
  throw error;
}

export async function createCoupon(input: CouponCreateInput, actor: Actor): Promise<CouponRow> {
  const now = new Date();

  try {
    const created = await withAudit<CouponDbRow>(
      (row) => ({
        userId: actor.userId,
        action: 'coupon.create',
        entity: 'coupon',
        entityId: row.id,
        changes: { after: row as unknown as Prisma.InputJsonValue },
        ipAddress: actor.ipAddress,
      }),
      async (tx) =>
        tx.coupon.create({
          data: {
            code: input.code,
            type: input.type,
            value: input.value,
            minOrderValuePoisha: input.minOrderValuePoisha ?? null,
            maxDiscountPoisha: input.maxDiscountPoisha ?? null,
            usageLimit: input.usageLimit ?? null,
            perUserLimit: input.perUserLimit,
            startDate: new Date(input.startDate),
            endDate: new Date(input.endDate),
            applicableCategories: (input.applicableCategories ?? null) as Prisma.InputJsonValue,
            applicableBrands: (input.applicableBrands ?? null) as Prisma.InputJsonValue,
            applicableProducts: (input.applicableProducts ?? null) as Prisma.InputJsonValue,
            isActive: input.isActive,
          },
          select: COUPON_SELECT,
        }),
    );

    return toDto(created, 0, now);
  } catch (error) {
    asDuplicateCode(error);
  }
}

export async function updateCoupon(
  id: string,
  input: CouponUpdateInput,
  actor: Actor,
): Promise<CouponRow> {
  const before = await prisma.coupon.findUnique({ where: { id }, select: COUPON_SELECT });
  if (!before) throw notFound('Coupon');

  /**
   * Cross-field rules, checked only when the patch touches one of the fields
   * involved. This is deliberate: the product module shipped a P0 where a
   * partial update was rejected by a stored value the client never sent, and the
   * same shape is available here (change only `endDate`, and a stored `startDate`
   * must not be able to refuse it).
   */
  const nextType = input.type ?? before.type;
  const nextValue = input.value ?? before.value;
  const nextStart = input.startDate ? new Date(input.startDate) : before.startDate;
  const nextEnd = input.endDate ? new Date(input.endDate) : before.endDate;

  const touchesValue = input.type !== undefined || input.value !== undefined;
  if (touchesValue) {
    if (nextType === 'PERCENTAGE' && (nextValue < 1 || nextValue > 100)) {
      throw new HttpError(422, 'VALIDATION_ERROR', 'a percentage coupon needs a value between 1 and 100.', {
        field: 'value',
      });
    }
    if (nextType === 'FIXED' && nextValue <= 0) {
      throw new HttpError(422, 'VALIDATION_ERROR', 'a fixed coupon needs a value above zero.', {
        field: 'value',
      });
    }
  }

  const touchesWindow = input.startDate !== undefined || input.endDate !== undefined;
  if (touchesWindow && nextEnd <= nextStart) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'endDate must be after startDate.', {
      field: 'endDate',
    });
  }

  const data: Prisma.CouponUpdateInput = {};
  if (input.code !== undefined) data.code = input.code;
  if (input.type !== undefined) data.type = input.type;
  if (input.value !== undefined) data.value = input.value;
  if (input.minOrderValuePoisha !== undefined) data.minOrderValuePoisha = input.minOrderValuePoisha;
  if (input.maxDiscountPoisha !== undefined) data.maxDiscountPoisha = input.maxDiscountPoisha;
  if (input.usageLimit !== undefined) data.usageLimit = input.usageLimit;
  if (input.perUserLimit !== undefined) data.perUserLimit = input.perUserLimit;
  if (input.startDate !== undefined) data.startDate = new Date(input.startDate);
  if (input.endDate !== undefined) data.endDate = new Date(input.endDate);
  if (input.applicableCategories !== undefined) {
    data.applicableCategories = input.applicableCategories as Prisma.InputJsonValue;
  }
  if (input.applicableBrands !== undefined) {
    data.applicableBrands = input.applicableBrands as Prisma.InputJsonValue;
  }
  if (input.applicableProducts !== undefined) {
    data.applicableProducts = input.applicableProducts as Prisma.InputJsonValue;
  }
  if (input.isActive !== undefined) data.isActive = input.isActive;

  const changes = diffChanges(
    before as unknown as Record<string, unknown>,
    data as unknown as Record<string, unknown>,
  );

  try {
    const updated = await withAudit<CouponDbRow>(
      {
        userId: actor.userId,
        action: 'coupon.update',
        entity: 'coupon',
        entityId: id,
        changes: changes as Prisma.InputJsonValue,
        ipAddress: actor.ipAddress,
      },
      async (tx) => tx.coupon.update({ where: { id }, data, select: COUPON_SELECT }),
    );

    const sum = await prisma.couponRedemption.aggregate({
      where: { couponId: id },
      _sum: { amountPoisha: true },
    });
    return toDto(updated, sum._sum.amountPoisha ?? 0, new Date());
  } catch (error) {
    asDuplicateCode(error);
  }
}

export async function setCouponActive(
  id: string,
  isActive: boolean,
  actor: Actor,
): Promise<CouponRow> {
  const before = await prisma.coupon.findUnique({ where: { id }, select: COUPON_SELECT });
  if (!before) throw notFound('Coupon');

  const updated = await withAudit<CouponDbRow>(
    {
      userId: actor.userId,
      action: isActive ? 'coupon.activate' : 'coupon.deactivate',
      entity: 'coupon',
      entityId: id,
      changes: { isActive: { from: before.isActive, to: isActive } },
      ipAddress: actor.ipAddress,
    },
    async (tx) => tx.coupon.update({ where: { id }, data: { isActive }, select: COUPON_SELECT }),
  );

  const sum = await prisma.couponRedemption.aggregate({
    where: { couponId: id },
    _sum: { amountPoisha: true },
  });
  return toDto(updated, sum._sum.amountPoisha ?? 0, new Date());
}

/**
 * Deletes a coupon that has never been redeemed.
 *
 * `order.couponId` is SET NULL, so a delete of a used coupon would succeed and
 * quietly detach it from the orders it paid for. The guard is the point: the
 * caller gets a 409 with the counts and is told to deactivate instead.
 */
export async function deleteCoupon(id: string, actor: Actor): Promise<void> {
  const before = await prisma.coupon.findUnique({
    where: { id },
    select: { id: true, code: true, usedCount: true },
  });
  if (!before) throw notFound('Coupon');

  const [redemptions, orders] = await Promise.all([
    prisma.couponRedemption.count({ where: { couponId: id } }),
    prisma.order.count({ where: { couponId: id } }),
  ]);

  if (redemptions > 0 || orders > 0 || before.usedCount > 0) {
    throw new HttpError(
      409,
      'CONFLICT',
      'This coupon has been used. Deactivate it instead of deleting it.',
      {
        reason: 'COUPON_IN_USE' satisfies CouponRefusal,
        redemptions,
        orders,
        usedCount: before.usedCount,
      },
    );
  }

  await withAudit(
    {
      userId: actor.userId,
      action: 'coupon.delete',
      entity: 'coupon',
      entityId: id,
      changes: { before: before as unknown as Prisma.InputJsonValue },
      ipAddress: actor.ipAddress,
    },
    async (tx) => {
      await tx.coupon.delete({ where: { id } });
    },
  );
}

export interface RedemptionRow {
  id: string;
  orderId: string | null;
  orderNumber: string | null;
  userId: string;
  userName: string;
  amountPoisha: number;
  createdAt: string;
}

/** The redemption report for one coupon: who used it, on which order, for how much. */
export async function couponRedemptions(
  id: string,
  page: number,
  limit: number,
): Promise<{ items: RedemptionRow[]; total: number; page: number; limit: number }> {
  const exists = await prisma.coupon.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw notFound('Coupon');

  const skip = (page - 1) * limit;

  const [rows, total] = await Promise.all([
    prisma.couponRedemption.findMany({
      where: { couponId: id },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      select: {
        id: true,
        orderId: true,
        userId: true,
        amountPoisha: true,
        createdAt: true,
        user: { select: { name: true } },
        coupon: { select: { code: true } },
      },
    }),
    prisma.couponRedemption.count({ where: { couponId: id } }),
  ]);

  // The order number lives on Order, keyed by id. One batched lookup, not one
  // per row, and only for the ids on this page.
  const orderIds = rows.map((row) => row.orderId).filter((value): value is string => Boolean(value));
  const orders =
    orderIds.length === 0
      ? []
      : await prisma.order.findMany({
          where: { id: { in: orderIds } },
          select: { id: true, orderNumber: true },
        });
  const numberById = new Map(orders.map((order) => [order.id, order.orderNumber]));

  return {
    items: rows.map((row) => ({
      id: row.id,
      orderId: row.orderId,
      orderNumber: row.orderId ? (numberById.get(row.orderId) ?? null) : null,
      userId: row.userId,
      userName: row.user.name,
      amountPoisha: row.amountPoisha,
      createdAt: row.createdAt.toISOString(),
    })),
    total,
    page,
    limit,
  };
}
