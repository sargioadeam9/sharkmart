/**
 * `/api/v1/admin/pos` — counter sales (Phase 10 pass M).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE CENTRAL DECISION: A TILL SALE IS AN ORDER
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The obvious schema for a POS module is `PosSale` + `PosSaleItem`, a tidy
 * parallel world next to `Order` + `OrderItem`. It is the wrong schema, and the
 * reason is money.
 *
 * Every revenue figure in this project is a query over `Order`: the dashboard
 * KPIs, the reports module's sales summary, the daily CSV export, the customer's
 * lifetime value, the coupon ledger. A parallel sales table means each of those
 * queries needs a UNION to stay true, and the first one that is written without
 * it silently under-reports by whatever the shop sold at the counter. That is
 * not a bug someone notices — it is a number that is quietly wrong forever.
 *
 * So a counter sale writes a real `Order` with `channel = 'POS'`:
 *
 *   - revenue reports, the order list and the dashboard work untouched
 *   - stock is decremented by the same field checkout decrements
 *   - an order that came from the till is visible to support when the customer
 *     calls about it
 *
 * `PosSession` then holds only what an order genuinely cannot: which shift the
 * sale belonged to, the drawer float, and the cash count at close.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE THREE THINGS THAT GO WRONG IN A POS MODULE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 1. STOCK. A till sale hands the goods over immediately, so `reservedStock`
 *    must NOT move — nothing is being held for a courier. Checkout's
 *    `reserveVariantStock` increments both columns; reusing it here would leave
 *    the shop showing phantom reservations for goods already in a bag. This file
 *    decrements `stock` alone, conditionally (`AND stock >= qty`) so two tills
 *    cannot both sell the last unit.
 *
 *    For a product with no variants, the stock of record is `WarehouseStock`
 *    (inventory.service.ts states the rule; this file follows it). Checkout
 *    currently skips those lines entirely — see README "Known limitations".
 *
 * 2. THE SHIFT. A sale with no open shift cannot be reconciled against a drawer,
 *    so it is refused with 409 rather than being allowed to float. The session
 *    is per-cashier, not per-shop: two tills run two drawers.
 *
 * 3. THE DOUBLE TAP. See `createSale` and the `clientRef` note in the validator.
 *
 * ── What this module deliberately does NOT do ──────────────────────────────
 *
 * No refunds or voids from the till. A counter refund is an order refund, and
 * the orders module already owns that path with its own permission
 * (`orders:refund`) and its own audit trail. A second refund button here would
 * be a second way to move money, which is the thing to avoid.
 */

import { Prisma } from '@prisma/client';

import { prisma } from '../../config/database.js';
import { HttpError } from '../../middleware/errorHandler.js';
import { withAudit } from '../../services/audit.service.js';
import { effectivePrice, generateOrderNumber } from '../../services/order.service.js';
import { getStoreProfile } from '../../services/settings.service.js';
import { stockStatusOf, type StockStatus } from '../../services/mappers.js';
import type {
  PosCatalogQuery,
  PosSaleInput,
  PosSessionCloseInput,
  PosSessionOpenInput,
} from '../../validators/adminPos.schema.js';
import { defaultWarehouseId } from './inventory.service.js';

/** The acting cashier and their IP, for the audit row. */
export interface Actor {
  userId: string;
  ipAddress: string | null;
}

/**
 * The largest manual discount a cashier may give, as a percentage of the bill.
 *
 * Not a tax rule and not a guess at the shop's margins — a guard against the
 * expensive mistake. A till discount is typed at speed by a person under a
 * queue; "500" instead of "50" is a ৳450 gift. Anything above half the bill is
 * a pricing decision, and pricing decisions belong in the coupon module where
 * they are deliberate, dated and auditable.
 */
const MAX_MANUAL_DISCOUNT_PERCENT = 50;

// ─── Types ─────────────────────────────────────────────────────────────────

export interface PosSessionDto {
  id: string;
  status: 'OPEN' | 'CLOSED';
  openedBy: string;
  openedByName: string;
  openedAt: string;
  closedBy: string | null;
  closedByName: string | null;
  closedAt: string | null;
  openingCashPoisha: number;
  countedCashPoisha: number | null;
  /**
   * Float + cash sales. For a closed shift this is the snapshot taken at close;
   * for an open one it is derived live. Never both — a number that is sometimes
   * a snapshot and sometimes a live sum, without saying which, is how a Z-report
   * ends up not matching the drawer.
   */
  expectedCashPoisha: number;
  /** counted - expected. Null while the shift is open. Negative = short. */
  variancePoisha: number | null;
  saleCount: number;
  cashSalesPoisha: number;
  cardSalesPoisha: number;
  otherSalesPoisha: number;
  totalSalesPoisha: number;
  note: string | null;
  /** True when the figures above are the close-time snapshot, not live. */
  snapshot: boolean;
}

export interface PosSaleItemDto {
  nameEn: string;
  nameBn: string;
  sku: string;
  quantity: number;
  unitPricePoisha: number;
  lineTotalPoisha: number;
}

export interface PosSaleDto {
  orderId: string;
  orderNumber: string;
  createdAt: string;
  sessionId: string | null;
  cashierName: string;
  items: PosSaleItemDto[];
  subtotalPoisha: number;
  discountPoisha: number;
  totalPoisha: number;
  paymentMethod: string;
  cashReceivedPoisha: number;
  changePoisha: number;
  customerName: string | null;
  customerPhone: string | null;
  /** The receipt header, from settings — a white-labelled shop prints its own name. */
  shop: { name: string; phone: string; address: string };
}

export interface PosSaleSummary {
  orderId: string;
  orderNumber: string;
  createdAt: string;
  totalPoisha: number;
  paymentMethod: string;
  itemCount: number;
  customerName: string | null;
}

export interface PosCatalogItem {
  productId: string;
  nameEn: string;
  nameBn: string;
  sku: string;
  pricePoisha: number;
  imageUrl: string | null;
  hasVariants: boolean;
  /** The stock of record for a variant-less product; null when it has variants. */
  stock: number | null;
  stockStatus: StockStatus;
  variants: Array<{
    id: string;
    sku: string;
    nameEn: string;
    nameBn: string;
    pricePoisha: number;
    stock: number;
    stockStatus: StockStatus;
    isActive: boolean;
  }>;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

async function userName(id: string | null): Promise<string> {
  if (!id) return '';
  const user = await prisma.user.findUnique({ where: { id }, select: { name: true } });
  return user?.name ?? '';
}

/** Display names for a set of user ids, in one query. */
async function userNames(ids: Array<string | null>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();

  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  return new Map(users.map((user) => [user.id, user.name]));
}

/**
 * The live figures for a shift, derived from the orders that belong to it.
 *
 * Derived, not stored, while the shift is open: a running counter drifts the
 * first time anything is corrected, and then the Z-report disagrees with the
 * drawer and nobody can say why. See the `PosSession` comment in schema.prisma.
 */
async function liveTotals(sessionId: string): Promise<{
  saleCount: number;
  cashSalesPoisha: number;
  cardSalesPoisha: number;
  otherSalesPoisha: number;
  totalSalesPoisha: number;
}> {
  const grouped = await prisma.order.groupBy({
    by: ['paymentMethod'],
    where: { posSessionId: sessionId, channel: 'POS' },
    _sum: { totalAmountPoisha: true },
    _count: { _all: true },
  });

  const totals = {
    saleCount: 0,
    cashSalesPoisha: 0,
    cardSalesPoisha: 0,
    otherSalesPoisha: 0,
    totalSalesPoisha: 0,
  };

  for (const row of grouped) {
    const amount = row._sum.totalAmountPoisha ?? 0;
    totals.saleCount += row._count._all;
    totals.totalSalesPoisha += amount;

    if (row.paymentMethod === 'CASH') totals.cashSalesPoisha += amount;
    else if (row.paymentMethod === 'CARD') totals.cardSalesPoisha += amount;
    else totals.otherSalesPoisha += amount;
  }

  return totals;
}

function toSessionDto(
  session: {
    id: string;
    status: string;
    openedBy: string;
    openedAt: Date;
    closedBy: string | null;
    closedAt: Date | null;
    openingCashPoisha: number;
    countedCashPoisha: number | null;
    expectedCashPoisha: number | null;
    variancePoisha: number | null;
    saleCount: number | null;
    cashSalesPoisha: number | null;
    cardSalesPoisha: number | null;
    otherSalesPoisha: number | null;
    note: string | null;
  },
  live: Awaited<ReturnType<typeof liveTotals>> | null,
  names: Map<string, string>,
): PosSessionDto {
  const closed = session.status === 'CLOSED';

  /**
   * A closed shift reports its snapshot. Falling back to the live sum when a
   * snapshot is missing would hide a half-closed row behind plausible numbers;
   * the `??` chain here is only for a row written before this code existed.
   */
  const totals = closed
    ? {
        saleCount: session.saleCount ?? 0,
        cashSalesPoisha: session.cashSalesPoisha ?? 0,
        cardSalesPoisha: session.cardSalesPoisha ?? 0,
        otherSalesPoisha: session.otherSalesPoisha ?? 0,
        totalSalesPoisha:
          (session.cashSalesPoisha ?? 0) +
          (session.cardSalesPoisha ?? 0) +
          (session.otherSalesPoisha ?? 0),
      }
    : (live ?? { saleCount: 0, cashSalesPoisha: 0, cardSalesPoisha: 0, otherSalesPoisha: 0, totalSalesPoisha: 0 });

  const expectedCashPoisha = closed
    ? (session.expectedCashPoisha ?? session.openingCashPoisha + totals.cashSalesPoisha)
    : session.openingCashPoisha + totals.cashSalesPoisha;

  return {
    id: session.id,
    status: closed ? 'CLOSED' : 'OPEN',
    openedBy: session.openedBy,
    openedByName: names.get(session.openedBy) ?? '',
    openedAt: session.openedAt.toISOString(),
    closedBy: session.closedBy,
    closedByName: session.closedBy ? (names.get(session.closedBy) ?? '') : null,
    closedAt: session.closedAt ? session.closedAt.toISOString() : null,
    openingCashPoisha: session.openingCashPoisha,
    countedCashPoisha: session.countedCashPoisha,
    expectedCashPoisha,
    variancePoisha: session.variancePoisha,
    saleCount: totals.saleCount,
    cashSalesPoisha: totals.cashSalesPoisha,
    cardSalesPoisha: totals.cardSalesPoisha,
    otherSalesPoisha: totals.otherSalesPoisha,
    totalSalesPoisha: totals.totalSalesPoisha,
    note: session.note,
    snapshot: closed,
  };
}

// ─── Shift: read ───────────────────────────────────────────────────────────

/** The caller's open shift, or null. The till screen calls this on mount. */
export async function currentSession(userId: string): Promise<PosSessionDto | null> {
  const session = await prisma.posSession.findFirst({
    where: { openedBy: userId, status: 'OPEN' },
    orderBy: { openedAt: 'desc' },
  });

  if (!session) return null;

  const [live, names] = await Promise.all([
    liveTotals(session.id),
    userNames([session.openedBy]),
  ]);

  return toSessionDto(session, live, names);
}

export async function getSession(id: string): Promise<PosSessionDto> {
  const session = await prisma.posSession.findUnique({ where: { id } });
  if (!session) throw new HttpError(404, 'NOT_FOUND', 'Shift not found.');

  const [live, names] = await Promise.all([
    session.status === 'OPEN' ? liveTotals(session.id) : Promise.resolve(null),
    userNames([session.openedBy, session.closedBy]),
  ]);

  return toSessionDto(session, live, names);
}

export async function listSessions(query: {
  status: 'all' | 'open' | 'closed';
  page: number;
  limit: number;
}): Promise<{ items: PosSessionDto[]; total: number; page: number; limit: number }> {
  const where: Prisma.PosSessionWhereInput = {};
  if (query.status !== 'all') where.status = query.status === 'open' ? 'OPEN' : 'CLOSED';

  const [rows, total] = await Promise.all([
    prisma.posSession.findMany({
      where,
      orderBy: { openedAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.posSession.count({ where }),
  ]);

  const names = await userNames(rows.flatMap((row) => [row.openedBy, row.closedBy]));

  // Live totals only for the open rows on this page — a closed row already has
  // its snapshot and must not be recomputed.
  const items = await Promise.all(
    rows.map(async (row) =>
      toSessionDto(row, row.status === 'OPEN' ? await liveTotals(row.id) : null, names),
    ),
  );

  return { items, total, page: query.page, limit: query.limit };
}

// ─── Shift: open / close ───────────────────────────────────────────────────

/**
 * Opens a shift for the caller.
 *
 * Per-cashier, and a second open shift is a 409 rather than a silent close of
 * the first: closing someone's drawer without counting it is the one action that
 * makes the variance column meaningless.
 */
export async function openSession(input: PosSessionOpenInput, actor: Actor): Promise<PosSessionDto> {
  const existing = await prisma.posSession.findFirst({
    where: { openedBy: actor.userId, status: 'OPEN' },
    select: { id: true, openedAt: true },
  });

  if (existing) {
    throw new HttpError(
      409,
      'CONFLICT',
      `You already have a shift open since ${existing.openedAt.toISOString().slice(0, 16).replace('T', ' ')}. Close it before opening another.`,
    );
  }

  const created = await withAudit<{ id: string }>(
    (result) => ({
      userId: actor.userId,
      action: 'pos.session_open',
      entity: 'pos_session',
      entityId: result.id,
      changes: { openingCashPoisha: input.openingCashPoisha, note: input.note ?? null },
      ipAddress: actor.ipAddress,
    }),
    async (tx) => {
      const session = await tx.posSession.create({
        data: {
          openedBy: actor.userId,
          openingCashPoisha: input.openingCashPoisha,
          note: input.note ?? null,
        },
        select: { id: true },
      });
      return session;
    },
  );

  return getSession(created.id);
}

/**
 * Closes the caller's shift and records the cash count.
 *
 * Owner-only. A manager who needs to close a shift someone abandoned can do it
 * by asking that person to sign in — which is annoying on purpose: the count is
 * the cashier's statement that the drawer is what it is, and a manager closing
 * it from an office is a signature on a document they did not read.
 *
 * The snapshot is written from a fresh `liveTotals()` inside the transaction, so
 * the numbers on the Z-report are the numbers that were true at the moment the
 * drawer was counted.
 */
export async function closeSession(
  id: string,
  input: PosSessionCloseInput,
  actor: Actor,
): Promise<PosSessionDto> {
  const session = await prisma.posSession.findUnique({
    where: { id },
    select: { id: true, status: true, openedBy: true, openingCashPoisha: true },
  });

  if (!session) throw new HttpError(404, 'NOT_FOUND', 'Shift not found.');

  if (session.openedBy !== actor.userId) {
    throw new HttpError(403, 'FORBIDDEN', 'Only the cashier who opened this shift can close it.');
  }

  if (session.status === 'CLOSED') {
    throw new HttpError(409, 'CONFLICT', 'This shift is already closed.');
  }

  await withAudit<{ variance: number }>(
    (result) => ({
      userId: actor.userId,
      action: 'pos.session_close',
      entity: 'pos_session',
      entityId: id,
      changes: {
        openingCashPoisha: session.openingCashPoisha,
        countedCashPoisha: input.countedCashPoisha,
        expectedCashPoisha: input.countedCashPoisha - result.variance,
        variancePoisha: result.variance,
        note: input.note ?? null,
      },
      ipAddress: actor.ipAddress,
    }),
    async (tx) => {
      // Recomputed here rather than read from the caller: a sale can land
      // between the screen loading and the button being pressed.
      const grouped = await tx.order.groupBy({
        by: ['paymentMethod'],
        where: { posSessionId: id, channel: 'POS' },
        _sum: { totalAmountPoisha: true },
        _count: { _all: true },
      });

      let saleCount = 0;
      let cash = 0;
      let card = 0;
      let other = 0;

      for (const row of grouped) {
        const amount = row._sum.totalAmountPoisha ?? 0;
        saleCount += row._count._all;
        if (row.paymentMethod === 'CASH') cash += amount;
        else if (row.paymentMethod === 'CARD') card += amount;
        else other += amount;
      }

      const expected = session.openingCashPoisha + cash;
      const variance = input.countedCashPoisha - expected;

      await tx.posSession.update({
        where: { id },
        data: {
          status: 'CLOSED',
          closedBy: actor.userId,
          closedAt: new Date(),
          countedCashPoisha: input.countedCashPoisha,
          expectedCashPoisha: expected,
          variancePoisha: variance,
          saleCount,
          cashSalesPoisha: cash,
          cardSalesPoisha: card,
          otherSalesPoisha: other,
          ...(input.note ? { note: input.note } : {}),
        },
      });

      return { variance };
    },
  );

  return getSession(id);
}

// ─── Catalog search ────────────────────────────────────────────────────────

/**
 * Products for the till.
 *
 * Searches name (both languages), product SKU and variant SKU. The last one
 * matters most: a barcode scanner is a keyboard that types a SKU and presses
 * Enter, so "scan to sell" is this query.
 *
 * An empty `q` returns the first N products by name rather than an empty list —
 * a shop without a scanner has to be able to tap its way to a product, and a
 * blank screen with "type to search" is a dead end for them.
 */
export async function searchCatalog(query: PosCatalogQuery): Promise<PosCatalogItem[]> {
  const q = query.q?.trim();

  const where: Prisma.ProductWhereInput = q
    ? {
        OR: [
          { nameEn: { contains: q } },
          { nameBn: { contains: q } },
          { sku: { contains: q } },
          { variants: { some: { sku: { contains: q } } } },
        ],
      }
    : {};

  const rows = await prisma.product.findMany({
    where,
    orderBy: { nameEn: 'asc' },
    take: query.limit,
    select: {
      id: true,
      sku: true,
      nameEn: true,
      nameBn: true,
      basePricePoisha: true,
      discountPricePoisha: true,
      flashSalePricePoisha: true,
      isFlashSale: true,
      images: { select: { url: true }, orderBy: { sortOrder: 'asc' }, take: 1 },
      variants: {
        where: { isActive: true },
        orderBy: { sku: 'asc' },
        select: {
          id: true,
          sku: true,
          nameEn: true,
          nameBn: true,
          pricePoisha: true,
          stock: true,
          isActive: true,
        },
      },
    },
  });

  const variantlessIds = rows.filter((row) => row.variants.length === 0).map((row) => row.id);

  const warehouseQty = new Map<string, number>();
  if (variantlessIds.length > 0) {
    const grouped = await prisma.warehouseStock.groupBy({
      by: ['productId'],
      where: { productId: { in: variantlessIds }, variantId: null },
      _sum: { quantity: true },
    });
    for (const row of grouped) warehouseQty.set(row.productId, row._sum.quantity ?? 0);
  }

  return rows.map((row) => {
    const hasVariants = row.variants.length > 0;
    const stock = hasVariants
      ? row.variants.reduce((sum, variant) => sum + variant.stock, 0)
      : (warehouseQty.get(row.id) ?? 0);

    return {
      productId: row.id,
      nameEn: row.nameEn,
      nameBn: row.nameBn,
      sku: row.sku,
      pricePoisha: effectivePrice(row),
      imageUrl: row.images[0]?.url ?? null,
      hasVariants,
      stock: hasVariants ? null : stock,
      stockStatus: stockStatusOf(stock),
      variants: row.variants.map((variant) => ({
        id: variant.id,
        sku: variant.sku,
        nameEn: variant.nameEn,
        nameBn: variant.nameBn,
        pricePoisha: variant.pricePoisha,
        stock: variant.stock,
        stockStatus: stockStatusOf(variant.stock),
        isActive: variant.isActive,
      })),
    };
  });
}

// ─── Sell ──────────────────────────────────────────────────────────────────

interface ResolvedLine {
  productId: string;
  variantId: string | null;
  nameEn: string;
  nameBn: string;
  sku: string;
  quantity: number;
  unitPricePoisha: number;
  lineTotalPoisha: number;
}

/**
 * Rings up a basket.
 *
 * Prices are re-derived from the database — the till sends ids and quantities,
 * never amounts. A client that sends a price is a client that can be edited in
 * devtools, and a till is a device sitting on a counter in a room full of
 * people.
 *
 * The whole sale is one transaction: stock, order, movement rows and the audit
 * entry commit together or not at all. A partial sale is worse than a failed
 * one — it means goods left the shop with no record, or a record with no stock
 * behind it.
 */
export async function createSale(
  input: PosSaleInput,
  actor: Actor,
): Promise<{ sale: PosSaleDto; replayed: boolean }> {
  /**
   * ── Replay check, before anything else ──────────────────────────────────
   *
   * The unique index on `posClientRef` is the real guard (two concurrent
   * requests: one wins, one gets P2002 and is translated below). This read is
   * the fast path for the common case — the screen retried a request that had
   * already succeeded.
   */
  const existing = await prisma.order.findUnique({
    where: { posClientRef: input.clientRef },
    select: { id: true },
  });

  if (existing) {
    return { sale: await getSale(existing.id), replayed: true };
  }

  const session = await prisma.posSession.findFirst({
    where: { openedBy: actor.userId, status: 'OPEN' },
    select: { id: true },
  });

  if (!session) {
    throw new HttpError(
      409,
      'CONFLICT',
      'Open a shift before selling. A sale with no shift cannot be reconciled against the drawer.',
    );
  }

  // ── Resolve every line from the database ────────────────────────────────
  const productIds = [...new Set(input.items.map((item) => item.productId))];

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true,
      sku: true,
      nameEn: true,
      nameBn: true,
      basePricePoisha: true,
      discountPricePoisha: true,
      flashSalePricePoisha: true,
      isFlashSale: true,
      variants: {
        select: {
          id: true,
          sku: true,
          nameEn: true,
          nameBn: true,
          pricePoisha: true,
          stock: true,
          isActive: true,
        },
      },
    },
  });

  const byId = new Map(products.map((product) => [product.id, product]));
  const lines: ResolvedLine[] = [];

  for (const item of input.items) {
    const product = byId.get(item.productId);
    if (!product) {
      throw new HttpError(
        422,
        'VALIDATION_ERROR',
        'A line refers to a product that no longer exists. Remove it and search again.',
      );
    }

    /**
     * Publish state is deliberately not checked. A shop can have a product on
     * the shelf that is not on the website yet (photographs pending, price not
     * finalised), and refusing to sell it would mean the operator has to publish
     * it to the internet to sell it at the counter. Stock is what matters here,
     * and stock is checked below.
     */

    if (item.variantId) {
      const variant = product.variants.find((candidate) => candidate.id === item.variantId);
      if (!variant) {
        throw new HttpError(
          422,
          'VALIDATION_ERROR',
          `That variant does not belong to "${product.nameEn}".`,
        );
      }
      if (!variant.isActive) {
        throw new HttpError(
          409,
          'CONFLICT',
          `"${product.nameEn} — ${variant.nameEn}" is inactive and cannot be sold.`,
        );
      }

      lines.push({
        productId: product.id,
        variantId: variant.id,
        nameEn: product.nameEn,
        nameBn: product.nameBn,
        sku: variant.sku,
        quantity: item.quantity,
        unitPricePoisha: variant.pricePoisha,
        lineTotalPoisha: variant.pricePoisha * item.quantity,
      });
      continue;
    }

    if (product.variants.length > 0) {
      throw new HttpError(
        422,
        'VALIDATION_ERROR',
        `"${product.nameEn}" has variants. Choose which one is being sold.`,
      );
    }

    const price = effectivePrice(product);
    lines.push({
      productId: product.id,
      variantId: null,
      nameEn: product.nameEn,
      nameBn: product.nameBn,
      sku: product.sku,
      quantity: item.quantity,
      unitPricePoisha: price,
      lineTotalPoisha: price * item.quantity,
    });
  }

  // ── Money, recomputed ───────────────────────────────────────────────────
  const subtotalPoisha = lines.reduce((sum, line) => sum + line.lineTotalPoisha, 0);

  const discountCap = Math.floor((subtotalPoisha * MAX_MANUAL_DISCOUNT_PERCENT) / 100);

  if (input.discountPoisha > discountCap) {
    throw new HttpError(
      422,
      'VALIDATION_ERROR',
      `A manual discount of ${input.discountPoisha / 100} is more than ${MAX_MANUAL_DISCOUNT_PERCENT}% of the bill (${discountCap / 100}). Use a coupon for a larger offer.`,
    );
  }

  const discountPoisha = input.discountPoisha;
  const totalPoisha = subtotalPoisha - discountPoisha;

  if (totalPoisha <= 0) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'A sale must total more than zero.');
  }

  // ── Payment ─────────────────────────────────────────────────────────────
  let cashReceivedPoisha: number;
  let changePoisha: number;

  if (input.paymentMethod === 'CASH') {
    if (input.cashReceivedPoisha === undefined) {
      throw new HttpError(422, 'VALIDATION_ERROR', 'Enter the cash received.');
    }
    if (input.cashReceivedPoisha < totalPoisha) {
      throw new HttpError(
        422,
        'VALIDATION_ERROR',
        `Cash received (${input.cashReceivedPoisha / 100}) is less than the total (${totalPoisha / 100}).`,
      );
    }
    cashReceivedPoisha = input.cashReceivedPoisha;
    changePoisha = cashReceivedPoisha - totalPoisha;
  } else {
    // A card or mobile wallet settles the exact amount; there is no change to
    // give and no float to reconcile.
    cashReceivedPoisha = totalPoisha;
    changePoisha = 0;
  }

  // Resolved once, outside the transaction, and only when it is needed.
  const needsWarehouse = lines.some((line) => line.variantId === null);
  const warehouseId = needsWarehouse ? await defaultWarehouseId() : null;

  let created: { id: string; orderNumber: string };

  try {
    created = await withAudit<{ id: string; orderNumber: string }>(
      (result) => ({
        userId: actor.userId,
        action: 'pos.sale',
        entity: 'order',
        entityId: result.id,
        changes: {
          orderNumber: result.orderNumber,
          channel: 'POS',
          posSessionId: session.id,
          itemCount: lines.length,
          subtotalPoisha,
          discountPoisha,
          totalPoisha,
          paymentMethod: input.paymentMethod,
          cashReceivedPoisha,
          changePoisha,
          clientRef: input.clientRef,
        },
        ipAddress: actor.ipAddress,
      }),
      async (tx) => {
        /**
         * Movement ids, collected as they are written.
         *
         * The alternative — creating the movements and then updating "rows with
         * a null referenceId for this user" — would sweep up a concurrent sale
         * by the same cashier, because a till is one person and two tabs is the
         * normal way to serve a queue.
         */
        const movementIds: string[] = [];

        // ── Stock, then the order ─────────────────────────────────────────
        for (const line of lines) {
          if (line.variantId) {
            /**
             * `stock` only — NOT `reservedStock`. The goods are in a bag, not
             * waiting for a courier; reserving them would leave the shop showing
             * units it has already sold as committed-but-unshipped forever.
             */
            const affected = await tx.$executeRaw`
              UPDATE ProductVariant
              SET stock = stock - ${line.quantity}
              WHERE id = ${line.variantId} AND stock >= ${line.quantity}
            `;

            if (affected !== 1) {
              const current = await tx.productVariant.findUnique({
                where: { id: line.variantId },
                select: { stock: true },
              });
              throw new HttpError(
                409,
                'OUT_OF_STOCK',
                `${line.nameEn} (${line.sku}) has ${current?.stock ?? 0} left, and the basket wants ${line.quantity}.`,
              );
            }
          } else {
            /**
             * Resolved above whenever the basket contains a variant-less line,
             * so this cannot be null. Stated as a check rather than a `!` so a
             * future change to `needsWarehouse` fails loudly instead of
             * decrementing `warehouseId = undefined`.
             */
            if (!warehouseId) {
              throw new HttpError(
                500,
                'INTERNAL_ERROR',
                'No warehouse resolved for a variant-less counter sale.',
              );
            }

            // Variant-less product: `WarehouseStock` is the stock of record
            // (inventory.service.ts). The `quantity >= ?` guard makes the
            // decrement atomic, exactly like the variant path.
            const affected = await tx.$executeRaw`
              UPDATE WarehouseStock
              SET quantity = quantity - ${line.quantity}
              WHERE warehouseId = ${warehouseId}
                AND productId = ${line.productId}
                AND variantId IS NULL
                AND quantity >= ${line.quantity}
            `;

            if (affected !== 1) {
              const current = await tx.warehouseStock.findFirst({
                where: { warehouseId, productId: line.productId, variantId: null },
                select: { quantity: true },
              });
              throw new HttpError(
                409,
                'OUT_OF_STOCK',
                `${line.nameEn} has ${current?.quantity ?? 0} left, and the basket wants ${line.quantity}.`,
              );
            }
          }

          /**
           * A movement row per line, so the inventory log can answer "where did
           * this go?" — `type: OUT`, positive quantity, referenceType ORDER.
           *
           * Checkout does not write movement rows today, which means an online
           * sale is invisible in the movement log. That is a gap in the checkout
           * path, not a reason to leave the till blind as well.
           */
          const movement = await tx.stockMovement.create({
            data: {
              productId: line.productId,
              variantId: line.variantId,
              warehouseId: line.variantId ? null : warehouseId,
              type: 'OUT',
              quantity: line.quantity,
              reason: 'Counter sale',
              referenceType: 'ORDER',
              referenceId: null, // filled below, once the order has an id
              createdBy: actor.userId,
            },
            select: { id: true },
          });

          movementIds.push(movement.id);
        }

        const order = await tx.order.create({
          data: {
            orderNumber: generateOrderNumber(),
            channel: 'POS',
            posSessionId: session.id,
            posClientRef: input.clientRef,
            userId: null,
            guestName: input.customerName ?? null,
            guestPhone: input.customerPhone ?? null,
            /**
             * DELIVERED at creation, because it was: the customer is holding the
             * bag. Anything else would put every counter sale into the "to ship"
             * queue and make the fulfilment board useless.
             */
            currentStatus: 'DELIVERED',
            subtotalPoisha,
            discountAmountPoisha: discountPoisha,
            couponId: null,
            deliveryChargePoisha: 0,
            totalAmountPoisha: totalPoisha,
            paymentMethod: input.paymentMethod,
            paymentStatus: 'PAID',
            paidAmountPoisha: totalPoisha,
            cashReceivedPoisha,
            changePoisha,
            notes: input.note ?? null,
            items: {
              create: lines.map((line) => ({
                productId: line.productId,
                variantId: line.variantId,
                nameEn: line.nameEn,
                nameBn: line.nameBn,
                sku: line.sku,
                quantity: line.quantity,
                unitPricePoisha: line.unitPricePoisha,
                lineTotalPoisha: line.lineTotalPoisha,
              })),
            },
            statusHistory: {
              create: {
                status: 'DELIVERED',
                note: 'Sold at the counter',
                changedBy: actor.userId,
              },
            },
          },
          select: { id: true, orderNumber: true },
        });

        // Now that the order exists, point its movements at it — by id, so a
        // concurrent sale by the same cashier cannot be swept up.
        await tx.stockMovement.updateMany({
          where: { id: { in: movementIds } },
          data: { referenceId: order.id },
        });

        return order;
      },
    );
  } catch (error) {
    /**
     * Two taps that arrive close enough together both pass the replay read
     * above; the unique index on `posClientRef` lets exactly one of them
     * through, and the loser lands here. Returning the winner's sale is the
     * correct answer for the loser — the goods were rung up once.
     */
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const raced = await prisma.order.findUnique({
        where: { posClientRef: input.clientRef },
        select: { id: true },
      });
      if (raced) return { sale: await getSale(raced.id), replayed: true };
    }
    throw error;
  }

  return { sale: await getSale(created.id), replayed: false };
}

/**
 * The receipt.
 *
 * Reads the shop's identity from settings, so a white-labelled deployment prints
 * its own name on the paper — the same source the storefront header uses.
 */
export async function getSale(orderId: string): Promise<PosSaleDto> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      createdAt: true,
      channel: true,
      posSessionId: true,
      posClientRef: true,
      guestName: true,
      guestPhone: true,
      subtotalPoisha: true,
      discountAmountPoisha: true,
      totalAmountPoisha: true,
      paymentMethod: true,
      cashReceivedPoisha: true,
      changePoisha: true,
      /**
       * The first history row is the sale itself — ordered by time rather than
       * matched on the note string, because a note is prose and prose gets
       * edited. Later rows (a refund, a status correction) are later.
       */
      statusHistory: {
        orderBy: { createdAt: 'asc' },
        select: { changedBy: true },
        take: 1,
      },
      items: {
        select: {
          nameEn: true,
          nameBn: true,
          sku: true,
          quantity: true,
          unitPricePoisha: true,
          lineTotalPoisha: true,
        },
      },
    },
  });

  if (!order || order.channel !== 'POS') {
    throw new HttpError(404, 'NOT_FOUND', 'Sale not found.');
  }

  const [cashier, shop] = await Promise.all([
    userName(order.statusHistory[0]?.changedBy ?? null),
    getStoreProfile(),
  ]);

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    createdAt: order.createdAt.toISOString(),
    sessionId: order.posSessionId,
    cashierName: cashier,
    items: order.items.map((item) => ({
      nameEn: item.nameEn,
      nameBn: item.nameBn,
      sku: item.sku,
      quantity: item.quantity,
      unitPricePoisha: item.unitPricePoisha,
      lineTotalPoisha: item.lineTotalPoisha,
    })),
    subtotalPoisha: order.subtotalPoisha,
    discountPoisha: order.discountAmountPoisha,
    totalPoisha: order.totalAmountPoisha,
    paymentMethod: order.paymentMethod,
    cashReceivedPoisha: order.cashReceivedPoisha ?? order.totalAmountPoisha,
    changePoisha: order.changePoisha ?? 0,
    customerName: order.guestName,
    customerPhone: order.guestPhone,
    shop: { name: shop.name, phone: shop.phone, address: shop.address },
  };
}

// ─── Sale history ──────────────────────────────────────────────────────────

export async function listSales(query: {
  sessionId?: string;
  page: number;
  limit: number;
}): Promise<{ items: PosSaleSummary[]; total: number; page: number; limit: number }> {
  const where: Prisma.OrderWhereInput = { channel: 'POS' };
  if (query.sessionId) where.posSessionId = query.sessionId;

  const [rows, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: {
        id: true,
        orderNumber: true,
        createdAt: true,
        totalAmountPoisha: true,
        paymentMethod: true,
        guestName: true,
        _count: { select: { items: true } },
      },
    }),
    prisma.order.count({ where }),
  ]);

  return {
    items: rows.map((row) => ({
      orderId: row.id,
      orderNumber: row.orderNumber,
      createdAt: row.createdAt.toISOString(),
      totalPoisha: row.totalAmountPoisha,
      paymentMethod: row.paymentMethod,
      itemCount: row._count.items,
      customerName: row.guestName,
    })),
    total,
    page: query.page,
    limit: query.limit,
  };
}
