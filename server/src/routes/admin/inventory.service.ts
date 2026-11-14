/**
 * `/api/v1/admin/inventory` — the inventory module's data layer.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE STOCK-OF-RECORD DECISION
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Two stock numbers exist in this schema and they do not agree:
 *
 *   ProductVariant.stock        sums to 4,999 across 744 rows
 *   WarehouseStock.quantity     sums to 5,183 across 168 rows
 *
 * They disagree because they are written by different code paths. Checkout
 * decrements `ProductVariant.stock` (order.service.ts:282). Nothing writes
 * `WarehouseStock` at all today. The 184-unit gap is seed drift, not a bug in
 * either path, and this module does not try to reconcile it — it picks one
 * number to be authoritative and says which.
 *
 * THE RULE, and it is not new:
 *
 *   A product WITH variants  ->  `ProductVariant.stock` is the stock of record.
 *   A product WITHOUT       ->  `WarehouseStock.quantity` is the stock of record.
 *
 * That is exactly the rule `cart.service.ts:191-200` already applies when it
 * decides whether a line is buyable, and exactly the rule `totalStock()` in
 * `mappers.ts:277-282` already applies when it builds the storefront badge.
 * Adopting it here therefore changes no public contract: the number this admin
 * screen calls "stock of record" is already the number the storefront
 * advertises and the number checkout decrements. Verified by reading both call
 * sites, not assumed.
 *
 * An adjustment consequently writes:
 *   - variant present  ->  `ProductVariant.stock`
 *   - no variants      ->  `WarehouseStock.quantity` (the product's row in the
 *                          chosen or default warehouse)
 * and always one `StockMovement` row, so the count has a history.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why the list filters in memory ──────────────────────────────────────────
 *
 * `stockStatus` is derived from a rule that spans two tables (`variants` vs
 * `WarehouseStock`) and depends on whether the product has variants at all.
 * Expressing that in one SQL `WHERE` would mean writing the rule a second time
 * in SQL, and the two copies would drift — which is the exact class of bug this
 * file's header exists to prevent. The catalog is 168 products, so the service
 * fetches the filtered set, derives the status once in TypeScript, then filters,
 * sorts and paginates. Two queries, no N+1, one definition of "low".
 *
 * If the catalog grows past a few thousand products this becomes a materialised
 * `stockOfRecord` column maintained on write. That is a schema change and a
 * migration, not something to smuggle into this pass.
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { HttpError } from '../../middleware/errorHandler.js';
import { withAudit } from '../../services/audit.service.js';
import { stockStatusOf, type StockStatus } from '../../services/mappers.js';
import type {
  AdminInventoryListInput,
  AdminMovementsInput,
  InventoryAdjustInput,
} from '../../validators/adminInventory.schema.js';

/** The acting user and their IP, for the audit row. */
export interface Actor {
  userId: string;
  ipAddress: string | null;
}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface InventoryListItem {
  productId: string;
  slug: string;
  nameEn: string;
  nameBn: string;
  sku: string;
  categoryNameEn: string;
  categoryNameBn: string;
  imageUrl: string | null;
  variantCount: number;
  /**
   * SUM(WarehouseStock.quantity) for this product — the quantity recorded at
   * INTAKE, not availability.
   *
   * Nothing maintains this field. Checkout decrements `ProductVariant.stock`
   * and never touches the warehouse row, so this number is frozen at whatever
   * was received while the real count falls with every order. It is kept in the
   * response because the field is real and a receiving flow will need it, but
   * it must never be presented as "how many we have" — see `stockOfRecord`.
   *
   * At the time of writing: warehouse sum 5,183 vs variant sum 4,736, a 447-unit
   * gap that widens per checkout. Do not "fix" it with a one-time sync; without
   * a receiving flow it drifts again by the next order.
   */
  warehouseQty: number;
  /** SUM(ProductVariant.stock) for this product. */
  variantStock: number;
  /** The number the rule above chose. This is what the operator acts on. */
  stockOfRecord: number;
  /** Which field `stockOfRecord` came from, so the UI can be honest about it. */
  stockSource: 'variant' | 'warehouse';
  stockStatus: StockStatus;
  updatedAt: string;
}

export interface InventoryListResult {
  items: InventoryListItem[];
  total: number;
  page: number;
  limit: number;
}

export interface InventoryDetail {
  product: {
    productId: string;
    slug: string;
    nameEn: string;
    nameBn: string;
    sku: string;
    categoryNameEn: string;
    categoryNameBn: string;
  };
  stockOfRecord: number;
  stockSource: 'variant' | 'warehouse';
  stockStatus: StockStatus;
  /** One row per warehouse. Empty for a product whose stock is in variants. */
  warehouses: Array<{
    warehouseId: string;
    warehouseName: string;
    isDefault: boolean;
    quantity: number;
  }>;
  variants: Array<{
    id: string;
    sku: string;
    nameEn: string;
    nameBn: string;
    stock: number;
    reservedStock: number;
    isActive: boolean;
    stockStatus: StockStatus;
  }>;
  movements: MovementRow[];
}

export interface MovementRow {
  id: string;
  productId: string;
  productNameEn: string | null;
  productSku: string | null;
  variantId: string | null;
  warehouseId: string | null;
  type: string;
  quantity: number;
  reason: string | null;
  referenceType: string | null;
  referenceId: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface InventoryAlerts {
  out: number;
  low: number;
  in: number;
  total: number;
  /** Total units across every product's stock of record. */
  units: number;
  /** Distinct products tracked — the "SKUs tracked" KPI. */
  skus: number;
}

// ─── Selects ───────────────────────────────────────────────────────────────

/**
 * One row per product, with both stock sources and nothing else.
 *
 * `variants` is selected as ids + stock only: the list needs the sum and the
 * count, not the variant detail. The detail endpoint fetches the full variant
 * rows.
 */
const INVENTORY_LIST_SELECT = {
  id: true,
  slug: true,
  sku: true,
  nameEn: true,
  nameBn: true,
  updatedAt: true,
  category: { select: { nameEn: true, nameBn: true } },
  images: { select: { url: true }, orderBy: { sortOrder: 'asc' }, take: 1 },
  variants: { select: { id: true, stock: true } },
} as const;

type InventoryListRow = Prisma.ProductGetPayload<{ select: typeof INVENTORY_LIST_SELECT }>;

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Warehouse quantity for a set of products, in one query.
 *
 * `variantId: null` because every `WarehouseStock` row today has a null
 * `variantId` (verified: 168 of 168). A row keyed to a variant would be a
 * per-variant warehouse count, which is a different concept and is not what
 * this column means in this schema.
 */
async function warehouseQtyFor(productIds: string[]): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();

  const grouped = await prisma.warehouseStock.groupBy({
    by: ['productId'],
    where: { productId: { in: productIds }, variantId: null },
    _sum: { quantity: true },
  });

  return new Map(grouped.map((row) => [row.productId, row._sum.quantity ?? 0]));
}

/** The rule, written once. Every caller goes through here. */
function stockOfRecordOf(row: { variants: Array<{ stock: number }> }, warehouseQty: number): {
  quantity: number;
  source: 'variant' | 'warehouse';
} {
  if (row.variants.length > 0) {
    return {
      quantity: row.variants.reduce((sum, variant) => sum + variant.stock, 0),
      source: 'variant',
    };
  }
  return { quantity: warehouseQty, source: 'warehouse' };
}

function toListItem(row: InventoryListRow, warehouseQty: number): InventoryListItem {
  const record = stockOfRecordOf(row, warehouseQty);

  return {
    productId: row.id,
    slug: row.slug,
    nameEn: row.nameEn,
    nameBn: row.nameBn,
    sku: row.sku,
    categoryNameEn: row.category.nameEn,
    categoryNameBn: row.category.nameBn,
    imageUrl: row.images[0]?.url ?? null,
    variantCount: row.variants.length,
    warehouseQty,
    variantStock: row.variants.reduce((sum, variant) => sum + variant.stock, 0),
    stockOfRecord: record.quantity,
    stockSource: record.source,
    stockStatus: stockStatusOf(record.quantity),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Resolves the default warehouse, for a variant-less adjustment with no id.
 *
 * Exported because the POS module needs the same answer when it decrements the
 * stock of a product that has no variants — "which warehouse holds this" must
 * have one definition, or a till sale and a manual adjustment will disagree
 * about where the stock went.
 */
export async function defaultWarehouseId(): Promise<string> {
  const warehouse =
    (await prisma.warehouse.findFirst({ where: { isDefault: true, isActive: true }, select: { id: true } })) ??
    (await prisma.warehouse.findFirst({ where: { isActive: true }, select: { id: true } }));

  if (!warehouse) {
    throw new HttpError(409, 'CONFLICT', 'No active warehouse exists to hold stock.');
  }
  return warehouse.id;
}

/** Resolves user display names for a set of movement rows, in one query. */
async function movementAuthors(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();

  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });

  return new Map(users.map((user) => [user.id, user.name]));
}

// ─── List ──────────────────────────────────────────────────────────────────

export async function listInventory(query: AdminInventoryListInput): Promise<InventoryListResult> {
  const where: Prisma.ProductWhereInput = {};

  if (query.categoryId) where.categoryId = query.categoryId;

  if (query.q) {
    const q = query.q;
    where.OR = [
      { nameEn: { contains: q } },
      { nameBn: { contains: q } },
      { sku: { contains: q } },
    ];
  }

  const rows = (await prisma.product.findMany({
    where,
    select: INVENTORY_LIST_SELECT,
  })) as InventoryListRow[];

  const warehouseQty = await warehouseQtyFor(rows.map((row) => row.id));

  let items = rows.map((row) => toListItem(row, warehouseQty.get(row.id) ?? 0));

  // The stock filter runs on the derived status, not on a column, because the
  // status is the cross-table rule above. One definition of "low", here.
  if (query.stock !== 'all') {
    const wanted: StockStatus =
      query.stock === 'out' ? 'out_of_stock' : query.stock === 'low' ? 'low_stock' : 'in_stock';
    items = items.filter((item) => item.stockStatus === wanted);
  }

  items.sort((a, b) => {
    switch (query.sort) {
      case 'stock_asc':
        return a.stockOfRecord - b.stockOfRecord || a.nameEn.localeCompare(b.nameEn);
      case 'stock_desc':
        return b.stockOfRecord - a.stockOfRecord || a.nameEn.localeCompare(b.nameEn);
      case 'name_desc':
        return b.nameEn.localeCompare(a.nameEn);
      case 'updated':
        return b.updatedAt.localeCompare(a.updatedAt);
      case 'name_asc':
      default:
        return a.nameEn.localeCompare(b.nameEn);
    }
  });

  const total = items.length;
  const start = (query.page - 1) * query.limit;

  return {
    items: items.slice(start, start + query.limit),
    total,
    page: query.page,
    limit: query.limit,
  };
}

// ─── Alerts (the KPI strip) ────────────────────────────────────────────────

/**
 * The KPI numbers, computed server-side.
 *
 * The browser never counts: a client-side count over one page of twenty would
 * report "3 out of stock" for a catalog with forty. Same reasoning as the order
 * status tabs (order.service.ts:196).
 */
export async function inventoryAlerts(): Promise<InventoryAlerts> {
  const rows = (await prisma.product.findMany({ select: INVENTORY_LIST_SELECT })) as InventoryListRow[];
  const warehouseQty = await warehouseQtyFor(rows.map((row) => row.id));

  const alerts: InventoryAlerts = { out: 0, low: 0, in: 0, total: 0, units: 0, skus: 0 };

  for (const row of rows) {
    const record = stockOfRecordOf(row, warehouseQty.get(row.id) ?? 0);
    const status = stockStatusOf(record.quantity);

    alerts.total += 1;
    alerts.skus += 1;
    alerts.units += record.quantity;

    if (status === 'out_of_stock') alerts.out += 1;
    else if (status === 'low_stock') alerts.low += 1;
    else alerts.in += 1;
  }

  return alerts;
}

// ─── Detail ────────────────────────────────────────────────────────────────

export async function getInventoryDetail(productId: string): Promise<InventoryDetail> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      slug: true,
      sku: true,
      nameEn: true,
      nameBn: true,
      category: { select: { nameEn: true, nameBn: true } },
      variants: {
        select: {
          id: true,
          sku: true,
          nameEn: true,
          nameBn: true,
          stock: true,
          reservedStock: true,
          isActive: true,
        },
        orderBy: { sku: 'asc' },
      },
    },
  });

  if (!product) throw new HttpError(404, 'NOT_FOUND', 'Product not found.');

  /**
   * `WarehouseStock` has no back-relation on `Product` (the schema declares only
   * `Warehouse.stock`), so this is a second query rather than a nested select.
   * One query, not one per warehouse.
   */
  const warehouseRows = await prisma.warehouseStock.findMany({
    where: { productId, variantId: null },
    select: {
      quantity: true,
      warehouse: { select: { id: true, name: true, isDefault: true } },
    },
  });

  const warehouseQty = warehouseRows.reduce((sum, row) => sum + row.quantity, 0);
  const record = stockOfRecordOf({ variants: product.variants }, warehouseQty);

  const movements = await prisma.stockMovement.findMany({
    where: { productId },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  const authors = await movementAuthors(movements.map((row) => row.createdBy ?? ''));

  return {
    product: {
      productId: product.id,
      slug: product.slug,
      nameEn: product.nameEn,
      nameBn: product.nameBn,
      sku: product.sku,
      categoryNameEn: product.category.nameEn,
      categoryNameBn: product.category.nameBn,
    },
    stockOfRecord: record.quantity,
    stockSource: record.source,
    stockStatus: stockStatusOf(record.quantity),
    warehouses: warehouseRows.map((row) => ({
      warehouseId: row.warehouse.id,
      warehouseName: row.warehouse.name,
      isDefault: row.warehouse.isDefault,
      quantity: row.quantity,
    })),
    variants: product.variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      nameEn: variant.nameEn,
      nameBn: variant.nameBn,
      stock: variant.stock,
      reservedStock: variant.reservedStock,
      isActive: variant.isActive,
      stockStatus: stockStatusOf(variant.stock),
    })),
    movements: movements.map((row) => ({
      id: row.id,
      productId: row.productId,
      productNameEn: product.nameEn,
      productSku: product.sku,
      variantId: row.variantId,
      warehouseId: row.warehouseId,
      type: row.type,
      quantity: row.quantity,
      reason: row.reason,
      referenceType: row.referenceType,
      referenceId: row.referenceId,
      createdBy: row.createdBy,
      createdByName: row.createdBy ? authors.get(row.createdBy) ?? null : null,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

// ─── Adjust ────────────────────────────────────────────────────────────────

export interface AdjustResult {
  productId: string;
  variantId: string | null;
  warehouseId: string | null;
  /** The field that was written — the rule above decided it. */
  stockSource: 'variant' | 'warehouse';
  previousQuantity: number;
  newQuantity: number;
  /** The signed change actually applied. Zero when the request was a no-op. */
  delta: number;
  stockOfRecord: number;
  stockStatus: StockStatus;
  /** False when the request would not have changed anything; nothing was written. */
  changed: boolean;
  movementId: string | null;
}

/**
 * Adjusts the stock of record for one product.
 *
 * ── No-op policy ────────────────────────────────────────────────────────────
 *
 * A request that would not change the number (delta 0, or `set` to the value it
 * already holds) writes NOTHING — no stock write, no movement row, no audit row
 * — and returns `changed: false`. The alternative, writing a movement row that
 * records a zero-unit change, fills the log with rows that say nothing happened
 * and makes the real movements harder to find. The caller is told explicitly
 * rather than being given a silent success.
 *
 * ── Negative stock ──────────────────────────────────────────────────────────
 *
 * A result below zero is a 422 carrying the current quantity, never a clamp. A
 * clamp would make "I counted 3" and "I counted -2" produce the same stored
 * value, and the operator would never learn the count was wrong.
 */
export async function adjustStock(
  productId: string,
  input: InventoryAdjustInput,
  actor: Actor,
): Promise<AdjustResult> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      nameEn: true,
      variants: { select: { id: true, stock: true, sku: true } },
    },
  });

  if (!product) throw new HttpError(404, 'NOT_FOUND', 'Product not found.');

  const hasVariants = product.variants.length > 0;

  // ── Which target? The rule decides, and the caller is told when they guessed
  //    wrong rather than having a target picked for them.
  if (hasVariants && !input.variantId) {
    throw new HttpError(
      422,
      'VALIDATION_ERROR',
      `"${product.nameEn}" has ${product.variants.length} variants, so stock is held per variant. Send variantId to say which one.`,
    );
  }

  if (!hasVariants && input.variantId) {
    throw new HttpError(
      422,
      'VALIDATION_ERROR',
      `"${product.nameEn}" has no variants, so it has no variant stock to adjust. Omit variantId.`,
    );
  }

  if (hasVariants && input.warehouseId) {
    throw new HttpError(
      422,
      'VALIDATION_ERROR',
      'Variant stock is not held per warehouse in this schema. Omit warehouseId.',
    );
  }

  const variant = input.variantId
    ? product.variants.find((candidate) => candidate.id === input.variantId)
    : null;

  if (input.variantId && !variant) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'That variant does not belong to this product.');
  }

  const warehouseId = hasVariants ? null : input.warehouseId ?? (await defaultWarehouseId());

  if (!hasVariants && input.warehouseId) {
    const warehouse = await prisma.warehouse.findUnique({
      where: { id: input.warehouseId },
      select: { id: true },
    });
    if (!warehouse) throw new HttpError(422, 'VALIDATION_ERROR', 'That warehouse does not exist.');
  }

  /**
   * ── The no-op check happens BEFORE the transaction opens ─────────────────
   *
   * `withAudit()` writes its audit row unconditionally after the work
   * succeeds, so a no-op returned from inside the callback would still leave an
   * audit row claiming an adjustment happened. The first version of this
   * function did exactly that: 15 audit rows for 12 movements, caught by
   * comparing the two counts against the live database.
   *
   * So the current value is read here, the decision is made here, and a no-op
   * returns without ever entering the transaction. The transaction below then
   * re-reads the value under its own lock, because the number can move between
   * this read and the write.
   */
  const currentQuantity = variant
    ? (
        await prisma.productVariant.findUnique({
          where: { id: variant.id },
          select: { stock: true },
        })
      )?.stock ?? 0
    : (
        await prisma.warehouseStock.findFirst({
          where: { productId, variantId: null, warehouseId: warehouseId! },
          select: { quantity: true },
        })
      )?.quantity ?? 0;

  const targetQuantity =
    input.mode === 'delta' ? currentQuantity + input.quantity : input.quantity;

  if (targetQuantity < 0) {
    throw new HttpError(
      422,
      'VALIDATION_ERROR',
      `That would take stock to ${targetQuantity}. The current quantity is ${currentQuantity}, and stock cannot go below zero.`,
    );
  }

  if (targetQuantity === currentQuantity) {
    return {
      productId,
      variantId: variant?.id ?? null,
      warehouseId,
      stockSource: variant ? 'variant' : 'warehouse',
      previousQuantity: currentQuantity,
      newQuantity: currentQuantity,
      delta: 0,
      stockOfRecord: currentQuantity,
      stockStatus: stockStatusOf(currentQuantity),
      changed: false,
      movementId: null,
    } satisfies AdjustResult;
  }

  return withAudit<AdjustResult>(
    (result) => ({
      userId: actor.userId,
      action: 'inventory.adjust',
      entity: 'inventory',
      entityId: productId,
      changes: {
        stockSource: result.stockSource,
        variantId: result.variantId,
        warehouseId: result.warehouseId,
        mode: input.mode,
        requested: input.quantity,
        from: result.previousQuantity,
        to: result.newQuantity,
        delta: result.delta,
        reason: input.reason,
      },
      ipAddress: actor.ipAddress,
    }),
    async (tx) => {
      // ── Read the current value inside the transaction, so the before/after
      //    pair in the audit row is the one that actually applied.
      let previousQuantity: number;

      if (variant) {
        const current = await tx.productVariant.findUnique({
          where: { id: variant.id },
          select: { stock: true },
        });
        if (!current) throw new HttpError(404, 'NOT_FOUND', 'Variant not found.');
        previousQuantity = current.stock;
      } else {
        const current = await tx.warehouseStock.findFirst({
          where: { productId, variantId: null, warehouseId: warehouseId! },
          select: { id: true, quantity: true },
        });
        previousQuantity = current?.quantity ?? 0;
      }

      const newQuantity =
        input.mode === 'delta' ? previousQuantity + input.quantity : input.quantity;

      if (newQuantity < 0) {
        throw new HttpError(
          422,
          'VALIDATION_ERROR',
          `That would take stock to ${newQuantity}. The current quantity is ${previousQuantity}, and stock cannot go below zero.`,
        );
      }

      const delta = newQuantity - previousQuantity;

      // ── The write. Variant stock is a column; warehouse stock is a row that
      //    may not exist yet for a variant-less product.
      if (variant) {
        await tx.productVariant.update({
          where: { id: variant.id },
          data: { stock: newQuantity },
        });
      } else {
        const existing = await tx.warehouseStock.findFirst({
          where: { productId, variantId: null, warehouseId: warehouseId! },
          select: { id: true },
        });

        if (existing) {
          await tx.warehouseStock.update({
            where: { id: existing.id },
            data: { quantity: newQuantity },
          });
        } else {
          await tx.warehouseStock.create({
            data: { productId, variantId: null, warehouseId: warehouseId!, quantity: newQuantity },
          });
        }
      }

      // ── The movement row. `ADJUSTMENT` is the existing enum value for a
      //    manual correction; `quantity` is the signed change.
      const movement = await tx.stockMovement.create({
        data: {
          productId,
          variantId: variant?.id ?? null,
          warehouseId,
          type: 'ADJUSTMENT',
          quantity: delta,
          reason: input.reason,
          referenceType: 'ADJUSTMENT',
          referenceId: null,
          createdBy: actor.userId,
        },
        select: { id: true },
      });

      return {
        productId,
        variantId: variant?.id ?? null,
        warehouseId,
        stockSource: variant ? 'variant' : 'warehouse',
        previousQuantity,
        newQuantity,
        delta,
        stockOfRecord: newQuantity,
        stockStatus: stockStatusOf(newQuantity),
        changed: true,
        movementId: movement.id,
      } satisfies AdjustResult;
    },
  );
}

// ─── Movements ─────────────────────────────────────────────────────────────

export interface MovementListResult {
  items: MovementRow[];
  total: number;
  page: number;
  limit: number;
}

export async function listMovements(query: AdminMovementsInput): Promise<MovementListResult> {
  const where: Prisma.StockMovementWhereInput = {};

  if (query.productId) where.productId = query.productId;
  if (query.type !== 'all') where.type = query.type;

  if (query.from || query.to) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (query.from) createdAt.gte = new Date(`${query.from}T00:00:00.000Z`);
    // `to` is inclusive of the whole day, so the filter is "before the next
    // midnight" rather than "before this midnight" — a bare date is midnight,
    // and `lte` on it would silently drop everything that happened that day.
    if (query.to) {
      const end = new Date(`${query.to}T00:00:00.000Z`);
      end.setUTCDate(end.getUTCDate() + 1);
      createdAt.lt = end;
    }
    where.createdAt = createdAt;
  }

  const skip = (query.page - 1) * query.limit;

  const [rows, total] = await Promise.all([
    prisma.stockMovement.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: query.limit,
    }),
    prisma.stockMovement.count({ where }),
  ]);

  const authors = await movementAuthors(rows.map((row) => row.createdBy ?? ''));

  // Product names for the log. One query for the page, not one per row.
  const productIds = [...new Set(rows.map((row) => row.productId))];
  const products =
    productIds.length > 0
      ? await prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, nameEn: true, sku: true },
        })
      : [];
  const productById = new Map(products.map((product) => [product.id, product]));

  return {
    items: rows.map((row) => ({
      id: row.id,
      productId: row.productId,
      productNameEn: productById.get(row.productId)?.nameEn ?? null,
      productSku: productById.get(row.productId)?.sku ?? null,
      variantId: row.variantId,
      warehouseId: row.warehouseId,
      type: row.type,
      quantity: row.quantity,
      reason: row.reason,
      referenceType: row.referenceType,
      referenceId: row.referenceId,
      createdBy: row.createdBy,
      createdByName: row.createdBy ? authors.get(row.createdBy) ?? null : null,
      createdAt: row.createdAt.toISOString(),
    })),
    total,
    page: query.page,
    limit: query.limit,
  };
}
