/**
 * `/api/v1/admin/warehouses` — Phase 10 pass E.
 *
 * ── What a warehouse is, and is not ────────────────────────────────────────
 *
 * A warehouse is a location. `WarehouseStock` is how much of a thing sits there.
 * For a product **with variants** the stock of record is `ProductVariant.stock`
 * (checkout decrements it, `cart.service.ts` reads it), so a warehouse row for
 * such a product is an allocation record, not the availability figure. For a
 * product **without** variants, `WarehouseStock` *is* the stock of record — that
 * is the rule `mappers.ts` and `cart.service.ts` already apply, and this module
 * does not invent a third one.
 *
 * ── Transfers ──────────────────────────────────────────────────────────────
 *
 * A transfer moves quantity between two warehouses in one transaction: decrement
 * the source row, increment the destination row, and write two `StockMovement`
 * rows (OUT and IN) so the ledger explains both sides. Total stock does not
 * change — only where it sits.
 *
 * The source row is checked with a conditional update (`quantity: { gte }`), the
 * same technique checkout uses for reservations: two concurrent transfers of the
 * last unit cannot both succeed.
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { HttpError, notFound } from '../../middleware/errorHandler.js';
import { withAudit, diffChanges } from '../../services/audit.service.js';

export interface Actor {
  userId: string;
  ipAddress: string | null;
}

export interface WarehouseRow {
  id: string;
  name: string;
  address: string | null;
  isDefault: boolean;
  isActive: boolean;
  productCount: number;
  totalUnits: number;
}

export async function listWarehouses(): Promise<WarehouseRow[]> {
  const rows = await prisma.warehouse.findMany({
    select: {
      id: true,
      name: true,
      address: true,
      isDefault: true,
      isActive: true,
      stock: { select: { quantity: true, productId: true } },
    },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    address: row.address,
    isDefault: row.isDefault,
    isActive: row.isActive,
    productCount: new Set(row.stock.map((entry) => entry.productId)).size,
    totalUnits: row.stock.reduce((sum, entry) => sum + entry.quantity, 0),
  }));
}

export async function createWarehouse(
  input: { name: string; address?: string | null; isDefault?: boolean },
  actor: Actor,
): Promise<WarehouseRow> {
  const created = await withAudit(
    (row: { id: string }) => ({
      userId: actor.userId,
      action: 'warehouse.create',
      entity: 'warehouse',
      entityId: row.id,
      changes: { after: input as unknown as Prisma.InputJsonValue },
      ipAddress: actor.ipAddress,
    }),
    async (tx) => {
      const warehouse = await tx.warehouse.create({
        data: { name: input.name, address: input.address ?? null, isDefault: false },
        select: { id: true },
      });

      // Making it default has to demote the previous one in the same transaction,
      // or two rows end up flagged default and receiving picks one at random.
      if (input.isDefault) {
        await tx.warehouse.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
        await tx.warehouse.update({ where: { id: warehouse.id }, data: { isDefault: true } });
      }

      return warehouse;
    },
  );

  const rows = await listWarehouses();
  return rows.find((row) => row.id === created.id)!;
}

export async function updateWarehouse(
  id: string,
  input: { name?: string; address?: string | null; isActive?: boolean },
  actor: Actor,
): Promise<WarehouseRow> {
  const before = await prisma.warehouse.findUnique({
    where: { id },
    select: { name: true, address: true, isActive: true },
  });
  if (!before) throw notFound('Warehouse');

  const changes = diffChanges(
    before as unknown as Record<string, unknown>,
    input as unknown as Record<string, unknown>,
  );

  if (Object.keys(changes).length > 0) {
    await withAudit(
      {
        userId: actor.userId,
        action: 'warehouse.update',
        entity: 'warehouse',
        entityId: id,
        changes: changes as Prisma.InputJsonValue,
        ipAddress: actor.ipAddress,
      },
      async (tx) => {
        await tx.warehouse.update({ where: { id }, data: input });
      },
    );
  }

  const rows = await listWarehouses();
  return rows.find((row) => row.id === id)!;
}

/** Sets the default warehouse, demoting every other one in the same transaction. */
export async function setDefaultWarehouse(id: string, actor: Actor): Promise<WarehouseRow[]> {
  const warehouse = await prisma.warehouse.findUnique({
    where: { id },
    select: { isActive: true, isDefault: true },
  });
  if (!warehouse) throw notFound('Warehouse');

  if (!warehouse.isActive) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'An inactive warehouse cannot be the default.', {
      field: 'isDefault',
    });
  }

  if (!warehouse.isDefault) {
    await withAudit(
      {
        userId: actor.userId,
        action: 'warehouse.setDefault',
        entity: 'warehouse',
        entityId: id,
        changes: { isDefault: { from: false, to: true } },
        ipAddress: actor.ipAddress,
      },
      async (tx) => {
        await tx.warehouse.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
        await tx.warehouse.update({ where: { id }, data: { isDefault: true } });
      },
    );
  }

  return listWarehouses();
}

export interface WarehouseStockRow {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  variantId: string | null;
  variantName: string | null;
  quantity: number;
  binLocation: string | null;
}

export async function warehouseStock(
  id: string,
  page: number,
  limit: number,
): Promise<{ items: WarehouseStockRow[]; total: number; page: number; limit: number }> {
  const warehouse = await prisma.warehouse.findUnique({ where: { id }, select: { id: true } });
  if (!warehouse) throw notFound('Warehouse');

  const skip = (page - 1) * limit;

  const [rows, total] = await Promise.all([
    prisma.warehouseStock.findMany({
      where: { warehouseId: id },
      select: {
        id: true,
        productId: true,
        variantId: true,
        quantity: true,
        binLocation: true,
      },
      orderBy: { quantity: 'desc' },
      skip,
      take: limit,
    }),
    prisma.warehouseStock.count({ where: { warehouseId: id } }),
  ]);

  const productIds = [...new Set(rows.map((row) => row.productId))];
  const variantIds = rows
    .map((row) => row.variantId)
    .filter((value): value is string => Boolean(value));

  const [products, variants] = await Promise.all([
    productIds.length === 0
      ? []
      : prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, nameEn: true, sku: true },
        }),
    variantIds.length === 0
      ? []
      : prisma.productVariant.findMany({
          where: { id: { in: variantIds } },
          select: { id: true, nameEn: true },
        }),
  ]);

  const productById = new Map(products.map((product) => [product.id, product]));
  const variantById = new Map(variants.map((variant) => [variant.id, variant]));

  return {
    items: rows.map((row) => ({
      id: row.id,
      productId: row.productId,
      productName: productById.get(row.productId)?.nameEn ?? '(deleted product)',
      sku: productById.get(row.productId)?.sku ?? '—',
      variantId: row.variantId,
      variantName: row.variantId ? (variantById.get(row.variantId)?.nameEn ?? null) : null,
      quantity: row.quantity,
      binLocation: row.binLocation,
    })),
    total,
    page,
    limit,
  };
}

// ─── Transfers ─────────────────────────────────────────────────────────────

export interface TransferRow {
  id: string;
  fromWarehouseId: string;
  fromName: string;
  toWarehouseId: string;
  toName: string;
  productName: string;
  variantName: string | null;
  quantity: number;
  status: string;
  createdAt: string;
}

export async function listTransfers(
  page: number,
  limit: number,
): Promise<{ items: TransferRow[]; total: number; page: number; limit: number }> {
  const skip = (page - 1) * limit;

  const [rows, total] = await Promise.all([
    prisma.stockTransfer.findMany({
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.stockTransfer.count(),
  ]);

  const warehouseIds = [...new Set(rows.flatMap((row) => [row.fromWarehouseId, row.toWarehouseId]))];
  const productIds = [...new Set(rows.map((row) => row.productId))];
  const variantIds = rows
    .map((row) => row.variantId)
    .filter((value): value is string => Boolean(value));

  const [warehouses, products, variants] = await Promise.all([
    warehouseIds.length === 0
      ? []
      : prisma.warehouse.findMany({ where: { id: { in: warehouseIds } }, select: { id: true, name: true } }),
    productIds.length === 0
      ? []
      : prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, nameEn: true } }),
    variantIds.length === 0
      ? []
      : prisma.productVariant.findMany({ where: { id: { in: variantIds } }, select: { id: true, nameEn: true } }),
  ]);

  const whById = new Map(warehouses.map((row) => [row.id, row.name]));
  const productById = new Map(products.map((row) => [row.id, row.nameEn]));
  const variantById = new Map(variants.map((row) => [row.id, row.nameEn]));

  return {
    items: rows.map((row) => ({
      id: row.id,
      fromWarehouseId: row.fromWarehouseId,
      fromName: whById.get(row.fromWarehouseId) ?? '—',
      toWarehouseId: row.toWarehouseId,
      toName: whById.get(row.toWarehouseId) ?? '—',
      productName: productById.get(row.productId) ?? '(deleted product)',
      variantName: row.variantId ? (variantById.get(row.variantId) ?? null) : null,
      quantity: row.quantity,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    })),
    total,
    page,
    limit,
  };
}

/**
 * Moves stock between two warehouses.
 *
 * The source decrement is a conditional update (`quantity >= qty`), so two
 * concurrent transfers of the last unit cannot both succeed — the same reasoning
 * as checkout's reservation. The destination row is created if absent.
 */
export async function createTransfer(
  input: {
    fromWarehouseId: string;
    toWarehouseId: string;
    productId: string;
    variantId?: string | null;
    quantity: number;
  },
  actor: Actor,
): Promise<TransferRow> {
  if (input.fromWarehouseId === input.toWarehouseId) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'Source and destination must differ.', {
      field: 'toWarehouseId',
    });
  }

  const warehouses = await prisma.warehouse.findMany({
    where: { id: { in: [input.fromWarehouseId, input.toWarehouseId] } },
    select: { id: true, isActive: true },
  });
  if (warehouses.length !== 2) throw notFound('Warehouse');
  if (warehouses.some((row) => !row.isActive)) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'Both warehouses must be active.');
  }

  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    select: { id: true, nameEn: true },
  });
  if (!product) throw notFound('Product');

  const created = await withAudit(
    (row: { id: string }) => ({
      userId: actor.userId,
      action: 'transfer.create',
      entity: 'stockTransfer',
      entityId: row.id,
      changes: { ...input, product: product.nameEn },
      ipAddress: actor.ipAddress,
    }),
    async (tx) => {
      const source = await tx.warehouseStock.findFirst({
        where: {
          warehouseId: input.fromWarehouseId,
          productId: input.productId,
          variantId: input.variantId ?? null,
        },
        select: { id: true, quantity: true },
      });

      if (!source || source.quantity < input.quantity) {
        throw new HttpError(
          422,
          'VALIDATION_ERROR',
          `Only ${source?.quantity ?? 0} in the source warehouse.`,
          { field: 'quantity', available: source?.quantity ?? 0 },
        );
      }

      // Conditional decrement: fails if another transfer took the stock first.
      const updated = await tx.warehouseStock.updateMany({
        where: { id: source.id, quantity: { gte: input.quantity } },
        data: { quantity: { decrement: input.quantity } },
      });
      if (updated.count === 0) {
        throw new HttpError(409, 'CONFLICT', 'That stock moved while you were transferring it.');
      }

      const destination = await tx.warehouseStock.findFirst({
        where: {
          warehouseId: input.toWarehouseId,
          productId: input.productId,
          variantId: input.variantId ?? null,
        },
        select: { id: true },
      });

      if (destination) {
        await tx.warehouseStock.update({
          where: { id: destination.id },
          data: { quantity: { increment: input.quantity } },
        });
      } else {
        await tx.warehouseStock.create({
          data: {
            warehouseId: input.toWarehouseId,
            productId: input.productId,
            variantId: input.variantId ?? null,
            quantity: input.quantity,
          },
        });
      }

      const movement = {
        productId: input.productId,
        variantId: input.variantId ?? null,
        quantity: input.quantity,
        reason: 'Warehouse transfer',
        referenceType: 'TRANSFER',
        createdBy: actor.userId,
      };

      await tx.stockMovement.create({
        data: { ...movement, warehouseId: input.fromWarehouseId, type: 'OUT' },
      });
      await tx.stockMovement.create({
        data: { ...movement, warehouseId: input.toWarehouseId, type: 'IN' },
      });

      return tx.stockTransfer.create({
        data: {
          fromWarehouseId: input.fromWarehouseId,
          toWarehouseId: input.toWarehouseId,
          productId: input.productId,
          variantId: input.variantId ?? null,
          quantity: input.quantity,
          // A transfer that is written only after both sides moved is completed,
          // not pending: a PENDING row would describe an intent nobody is tracking.
          status: 'COMPLETED',
        },
        select: { id: true },
      });
    },
  );

  // Fetch the row back by id rather than scanning page 1 of the list: another
  // transfer created at the same moment would make "newest first" ambiguous.
  const row = await prisma.stockTransfer.findUniqueOrThrow({
    where: { id: created.id },
    select: {
      id: true,
      fromWarehouseId: true,
      toWarehouseId: true,
      quantity: true,
      status: true,
      createdAt: true,
      variantId: true,
    },
  });

  const [from, to, variant] = await Promise.all([
    prisma.warehouse.findUnique({ where: { id: row.fromWarehouseId }, select: { name: true } }),
    prisma.warehouse.findUnique({ where: { id: row.toWarehouseId }, select: { name: true } }),
    row.variantId
      ? prisma.productVariant.findUnique({ where: { id: row.variantId }, select: { nameEn: true } })
      : Promise.resolve(null),
  ]);

  return {
    id: row.id,
    fromWarehouseId: row.fromWarehouseId,
    fromName: from?.name ?? '—',
    toWarehouseId: row.toWarehouseId,
    toName: to?.name ?? '—',
    productName: product.nameEn,
    variantName: variant?.nameEn ?? null,
    quantity: row.quantity,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}
