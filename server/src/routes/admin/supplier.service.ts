/**
 * `/api/v1/admin/suppliers` — Phase 10 pass D.
 *
 * ── The state machine ──────────────────────────────────────────────────────
 *
 *   DRAFT ──order──> ORDERED ──receive(partial)──> PARTIAL
 *                       │                            │
 *                       └──────receive(all)──────────┴──> RECEIVED
 *
 *   DRAFT | ORDERED | PARTIAL ──cancel──> CANCELLED
 *
 * Why a DRAFT step exists: a purchase order is prepared, checked against what is
 * actually needed, and only then sent. Letting a DRAFT be received would mean the
 * shop can take delivery of something nobody ordered.
 *
 * Why cancel stops at PARTIAL: once goods have arrived, "cancel" is a lie — the
 * stock exists. That case is a return to the supplier, which is a different
 * action and is not in this pass.
 *
 * ── Receiving is a delta ───────────────────────────────────────────────────
 *
 * `receivedQuantity` on the wire means "this many more arrived", and the service
 * clamps it against the ordered quantity. A client that sent an absolute total
 * would silently overwrite a colleague's earlier receipt; a delta composes, and
 * two people receiving halves of one shipment end up with the right number.
 *
 * ── What receiving does NOT do ─────────────────────────────────────────────
 *
 * It does not change stock. Stock is per warehouse, and the warehouse module
 * (pass E) is where a receipt becomes a stock change. Doing it here would create
 * a second, conflicting writer to `ProductVariant.stock` — exactly the drift the
 * inventory module already has to explain.
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { HttpError, notFound } from '../../middleware/errorHandler.js';
import { withAudit, diffChanges } from '../../services/audit.service.js';
import type {
  PurchaseOrderCreateInput,
  SupplierCreateInput,
  SupplierUpdateInput,
} from '../../validators/adminSupplier.schema.js';

export interface Actor {
  userId: string;
  ipAddress: string | null;
}

export type SupplierRefusal = 'SUPPLIER_HAS_ORDERS';
export type PurchaseOrderRefusal = 'PO_NOT_ORDERED' | 'PO_ALREADY_RECEIVED' | 'PO_OVER_RECEIVE';

// ─── Suppliers ─────────────────────────────────────────────────────────────

export interface SupplierRow {
  id: string;
  name: string;
  contactPerson: string | null;
  phone: string;
  email: string | null;
  address: string | null;
  isActive: boolean;
  productCount: number;
  orderCount: number;
  createdAt: string;
}

const SUPPLIER_SELECT = {
  id: true,
  name: true,
  contactPerson: true,
  phone: true,
  email: true,
  address: true,
  isActive: true,
  createdAt: true,
} satisfies Prisma.SupplierSelect;

export async function listSuppliers(query: {
  q?: string;
  active: 'all' | 'true' | 'false';
  page: number;
  limit: number;
  sort: 'newest' | 'name' | 'orders';
}): Promise<{ items: SupplierRow[]; total: number; page: number; limit: number }> {
  const where: Prisma.SupplierWhereInput = {
    ...(query.active === 'all' ? {} : { isActive: query.active === 'true' }),
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q } },
            { phone: { contains: query.q } },
            { contactPerson: { contains: query.q } },
          ],
        }
      : {}),
  };

  const orderBy: Prisma.SupplierOrderByWithRelationInput =
    query.sort === 'name' ? { name: 'asc' } : { createdAt: 'desc' };

  const skip = (query.page - 1) * query.limit;

  const [rows, total] = await Promise.all([
    prisma.supplier.findMany({
      where,
      select: {
        ...SUPPLIER_SELECT,
        _count: { select: { products: true, purchaseOrders: true } },
      },
      orderBy,
      skip,
      take: query.limit,
    }),
    prisma.supplier.count({ where }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      contactPerson: row.contactPerson,
      phone: row.phone,
      email: row.email,
      address: row.address,
      isActive: row.isActive,
      productCount: row._count.products,
      orderCount: row._count.purchaseOrders,
      createdAt: row.createdAt.toISOString(),
    })),
    total,
    page: query.page,
    limit: query.limit,
  };
}

export interface SupplierProductRow {
  productId: string;
  nameEn: string;
  sku: string;
  costPricePoisha: number;
  leadDays: number | null;
}

export interface SupplierDetail extends SupplierRow {
  products: SupplierProductRow[];
  orders: Array<{ id: string; status: string; totalAmountPoisha: number; createdAt: string }>;
}

export async function getSupplier(id: string): Promise<SupplierDetail> {
  const row = await prisma.supplier.findUnique({
    where: { id },
    select: {
      ...SUPPLIER_SELECT,
      products: {
        select: {
          productId: true,
          costPricePoisha: true,
          leadDays: true,
          product: { select: { nameEn: true, sku: true } },
        },
        orderBy: { product: { nameEn: 'asc' } },
      },
      purchaseOrders: {
        select: { id: true, status: true, totalAmountPoisha: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      },
      _count: { select: { products: true, purchaseOrders: true } },
    },
  });

  if (!row) throw notFound('Supplier');

  return {
    id: row.id,
    name: row.name,
    contactPerson: row.contactPerson,
    phone: row.phone,
    email: row.email,
    address: row.address,
    isActive: row.isActive,
    productCount: row._count.products,
    orderCount: row._count.purchaseOrders,
    createdAt: row.createdAt.toISOString(),
    products: row.products.map((link) => ({
      productId: link.productId,
      nameEn: link.product.nameEn,
      sku: link.product.sku,
      costPricePoisha: link.costPricePoisha,
      leadDays: link.leadDays,
    })),
    orders: row.purchaseOrders.map((order) => ({
      id: order.id,
      status: order.status,
      totalAmountPoisha: order.totalAmountPoisha,
      createdAt: order.createdAt.toISOString(),
    })),
  };
}

export async function createSupplier(
  input: SupplierCreateInput,
  actor: Actor,
): Promise<SupplierRow> {
  const created = await withAudit(
    (row: { id: string }) => ({
      userId: actor.userId,
      action: 'supplier.create',
      entity: 'supplier',
      entityId: row.id,
      changes: { after: input as unknown as Prisma.InputJsonValue },
      ipAddress: actor.ipAddress,
    }),
    async (tx) => tx.supplier.create({ data: input, select: SUPPLIER_SELECT }),
  );

  return {
    ...created,
    createdAt: created.createdAt.toISOString(),
    productCount: 0,
    orderCount: 0,
  };
}

export async function updateSupplier(
  id: string,
  input: SupplierUpdateInput,
  actor: Actor,
): Promise<SupplierRow> {
  const before = await prisma.supplier.findUnique({ where: { id }, select: SUPPLIER_SELECT });
  if (!before) throw notFound('Supplier');

  const changes = diffChanges(
    before as unknown as Record<string, unknown>,
    input as unknown as Record<string, unknown>,
  );

  const updated = await withAudit(
    {
      userId: actor.userId,
      action: 'supplier.update',
      entity: 'supplier',
      entityId: id,
      changes: changes as Prisma.InputJsonValue,
      ipAddress: actor.ipAddress,
    },
    async (tx) => tx.supplier.update({ where: { id }, data: input, select: SUPPLIER_SELECT }),
  );

  const counts = await prisma.supplier.findUniqueOrThrow({
    where: { id },
    select: { _count: { select: { products: true, purchaseOrders: true } } },
  });

  return {
    ...updated,
    createdAt: updated.createdAt.toISOString(),
    productCount: counts._count.products,
    orderCount: counts._count.purchaseOrders,
  };
}

/**
 * Deletes a supplier that has never been ordered from.
 *
 * `PurchaseOrder.supplierId` has no `onDelete`, so Prisma's default (RESTRICT for
 * a required relation) would surface as a raw FK error. A supplier with history is
 * deactivated instead: the orders must keep pointing at somebody.
 */
export async function deleteSupplier(id: string, actor: Actor): Promise<void> {
  const before = await prisma.supplier.findUnique({
    where: { id },
    select: { id: true, name: true, _count: { select: { purchaseOrders: true, products: true } } },
  });
  if (!before) throw notFound('Supplier');

  if (before._count.purchaseOrders > 0) {
    throw new HttpError(
      409,
      'CONFLICT',
      'This supplier has purchase orders. Deactivate it instead of deleting it.',
      {
        reason: 'SUPPLIER_HAS_ORDERS' satisfies SupplierRefusal,
        orders: before._count.purchaseOrders,
      },
    );
  }

  await withAudit(
    {
      userId: actor.userId,
      action: 'supplier.delete',
      entity: 'supplier',
      entityId: id,
      changes: { before: before as unknown as Prisma.InputJsonValue },
      ipAddress: actor.ipAddress,
    },
    async (tx) => {
      // SupplierProduct cascades with the supplier; that link has no history.
      await tx.supplier.delete({ where: { id } });
    },
  );
}

export async function setSupplierActive(
  id: string,
  isActive: boolean,
  actor: Actor,
): Promise<SupplierRow> {
  const before = await prisma.supplier.findUnique({ where: { id }, select: SUPPLIER_SELECT });
  if (!before) throw notFound('Supplier');

  const updated = await withAudit(
    {
      userId: actor.userId,
      action: isActive ? 'supplier.activate' : 'supplier.deactivate',
      entity: 'supplier',
      entityId: id,
      changes: { isActive: { from: before.isActive, to: isActive } },
      ipAddress: actor.ipAddress,
    },
    async (tx) => tx.supplier.update({ where: { id }, data: { isActive }, select: SUPPLIER_SELECT }),
  );

  const counts = await prisma.supplier.findUniqueOrThrow({
    where: { id },
    select: { _count: { select: { products: true, purchaseOrders: true } } },
  });

  return {
    ...updated,
    createdAt: updated.createdAt.toISOString(),
    productCount: counts._count.products,
    orderCount: counts._count.purchaseOrders,
  };
}

// ─── Supplier products ─────────────────────────────────────────────────────

export async function addSupplierProduct(
  supplierId: string,
  input: { productId: string; costPricePoisha: number; leadDays?: number | null },
  actor: Actor,
): Promise<void> {
  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true } });
  if (!supplier) throw notFound('Supplier');

  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    select: { id: true, nameEn: true },
  });
  if (!product) throw notFound('Product');

  /**
   * Upsert, not create: re-adding a product to the same supplier is how an
   * operator corrects a cost price or a lead time. Rejecting it with a 409 would
   * force them to remove the link first, which is two writes for one intent.
   */
  await withAudit(
    {
      userId: actor.userId,
      action: 'supplier.product.add',
      entity: 'supplier',
      entityId: supplierId,
      changes: { product: product.nameEn, ...input },
      ipAddress: actor.ipAddress,
    },
    async (tx) => {
      await tx.supplierProduct.upsert({
        where: { supplierId_productId: { supplierId, productId: input.productId } },
        create: {
          supplierId,
          productId: input.productId,
          costPricePoisha: input.costPricePoisha,
          leadDays: input.leadDays ?? null,
        },
        update: { costPricePoisha: input.costPricePoisha, leadDays: input.leadDays ?? null },
      });
    },
  );
}

export async function removeSupplierProduct(
  supplierId: string,
  productId: string,
  actor: Actor,
): Promise<void> {
  const link = await prisma.supplierProduct.findUnique({
    where: { supplierId_productId: { supplierId, productId } },
    select: { id: true, product: { select: { nameEn: true } } },
  });
  if (!link) throw notFound('Supplier product');

  await withAudit(
    {
      userId: actor.userId,
      action: 'supplier.product.remove',
      entity: 'supplier',
      entityId: supplierId,
      changes: { removed: link.product.nameEn },
      ipAddress: actor.ipAddress,
    },
    async (tx) => {
      await tx.supplierProduct.delete({ where: { id: link.id } });
    },
  );
}

// ─── Purchase orders ───────────────────────────────────────────────────────

export interface PurchaseOrderRow {
  id: string;
  supplierId: string;
  supplierName: string;
  status: string;
  totalAmountPoisha: number;
  notes: string | null;
  itemCount: number;
  receivedItemCount: number;
  createdAt: string;
  receivedAt: string | null;
}

const PO_SELECT = {
  id: true,
  supplierId: true,
  status: true,
  totalAmountPoisha: true,
  notes: true,
  createdAt: true,
  receivedAt: true,
  supplier: { select: { name: true } },
  items: { select: { quantity: true, receivedQuantity: true } },
} satisfies Prisma.PurchaseOrderSelect;

type PoDbRow = Prisma.PurchaseOrderGetPayload<{ select: typeof PO_SELECT }>;

function toPoDto(row: PoDbRow): PurchaseOrderRow {
  return {
    id: row.id,
    supplierId: row.supplierId,
    supplierName: row.supplier.name,
    status: row.status,
    totalAmountPoisha: row.totalAmountPoisha,
    notes: row.notes,
    itemCount: row.items.length,
    receivedItemCount: row.items.filter((item) => item.receivedQuantity >= item.quantity).length,
    createdAt: row.createdAt.toISOString(),
    receivedAt: row.receivedAt?.toISOString() ?? null,
  };
}

export async function listPurchaseOrders(query: {
  supplierId?: string;
  status: 'all' | 'DRAFT' | 'ORDERED' | 'PARTIAL' | 'RECEIVED' | 'CANCELLED';
  page: number;
  limit: number;
}): Promise<{ items: PurchaseOrderRow[]; total: number; page: number; limit: number }> {
  const where: Prisma.PurchaseOrderWhereInput = {
    ...(query.supplierId ? { supplierId: query.supplierId } : {}),
    ...(query.status === 'all' ? {} : { status: query.status }),
  };

  const skip = (query.page - 1) * query.limit;

  const [rows, total] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where,
      select: PO_SELECT,
      orderBy: { createdAt: 'desc' },
      skip,
      take: query.limit,
    }),
    prisma.purchaseOrder.count({ where }),
  ]);

  return { items: rows.map(toPoDto), total, page: query.page, limit: query.limit };
}

export interface PurchaseOrderItemRow {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  receivedQuantity: number;
  costPricePoisha: number;
}

export interface PurchaseOrderDetail extends PurchaseOrderRow {
  items: PurchaseOrderItemRow[];
}

export async function getPurchaseOrder(id: string): Promise<PurchaseOrderDetail> {
  const row = await prisma.purchaseOrder.findUnique({
    where: { id },
    select: {
      ...PO_SELECT,
      items: {
        select: {
          id: true,
          productId: true,
          quantity: true,
          receivedQuantity: true,
          costPricePoisha: true,
        },
      },
    },
  });
  if (!row) throw notFound('Purchase order');

  const products =
    row.items.length === 0
      ? []
      : await prisma.product.findMany({
          where: { id: { in: row.items.map((item) => item.productId) } },
          select: { id: true, nameEn: true, sku: true },
        });
  const byId = new Map(products.map((product) => [product.id, product]));

  return {
    ...toPoDto(row),
    items: row.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: byId.get(item.productId)?.nameEn ?? '(deleted product)',
      sku: byId.get(item.productId)?.sku ?? '—',
      quantity: item.quantity,
      receivedQuantity: item.receivedQuantity,
      costPricePoisha: item.costPricePoisha,
    })),
  };
}

/**
 * Creates a DRAFT order. The total is computed here, never trusted from the
 * client: `sum(quantity * costPrice)` over the lines it actually stored.
 */
export async function createPurchaseOrder(
  input: PurchaseOrderCreateInput,
  actor: Actor,
): Promise<PurchaseOrderDetail> {
  const supplier = await prisma.supplier.findUnique({
    where: { id: input.supplierId },
    select: { id: true, isActive: true, name: true },
  });
  if (!supplier) throw notFound('Supplier');
  if (!supplier.isActive) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'That supplier is inactive.', {
      field: 'supplierId',
    });
  }

  const productIds = [...new Set(input.items.map((item) => item.productId))];
  const found = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true },
  });
  if (found.length !== productIds.length) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'One or more products do not exist.', {
      field: 'items',
    });
  }

  const total = input.items.reduce((sum, item) => sum + item.quantity * item.costPricePoisha, 0);

  const created = await withAudit(
    (row: { id: string }) => ({
      userId: actor.userId,
      action: 'po.create',
      entity: 'purchaseOrder',
      entityId: row.id,
      changes: { supplier: supplier.name, total, lines: input.items.length },
      ipAddress: actor.ipAddress,
    }),
    async (tx) =>
      tx.purchaseOrder.create({
        data: {
          supplierId: input.supplierId,
          status: 'DRAFT',
          totalAmountPoisha: total,
          notes: input.notes ?? null,
          items: {
            create: input.items.map((item) => ({
              productId: item.productId,
              variantId: item.variantId ?? null,
              quantity: item.quantity,
              costPricePoisha: item.costPricePoisha,
            })),
          },
        },
        select: { id: true },
      }),
  );

  return getPurchaseOrder(created.id);
}

export async function markPurchaseOrderOrdered(id: string, actor: Actor): Promise<PurchaseOrderDetail> {
  const before = await prisma.purchaseOrder.findUnique({ where: { id }, select: { status: true } });
  if (!before) throw notFound('Purchase order');

  if (before.status !== 'DRAFT') {
    throw new HttpError(409, 'CONFLICT', `This order is ${before.status}, not a draft.`, {
      reason: 'PO_NOT_ORDERED' satisfies PurchaseOrderRefusal,
    });
  }

  await withAudit(
    {
      userId: actor.userId,
      action: 'po.order',
      entity: 'purchaseOrder',
      entityId: id,
      changes: { status: { from: 'DRAFT', to: 'ORDERED' } },
      ipAddress: actor.ipAddress,
    },
    async (tx) => {
      await tx.purchaseOrder.update({ where: { id }, data: { status: 'ORDERED' } });
    },
  );

  return getPurchaseOrder(id);
}

/**
 * Records a receipt.
 *
 * Each line is clamped to what was ordered. A request that would push any line
 * past its quantity is refused as a whole — partially applying it would leave the
 * operator with a receipt they did not intend and no way to tell which lines took.
 */
export async function receivePurchaseOrder(
  id: string,
  body: { lines: Array<{ itemId: string; receivedQuantity: number }>; note?: string },
  actor: Actor,
): Promise<PurchaseOrderDetail> {
  const order = await prisma.purchaseOrder.findUnique({
    where: { id },
    select: {
      status: true,
      items: {
        select: {
          id: true,
          productId: true,
          variantId: true,
          quantity: true,
          receivedQuantity: true,
        },
      },
    },
  });
  if (!order) throw notFound('Purchase order');

  if (order.status === 'RECEIVED') {
    throw new HttpError(409, 'CONFLICT', 'This order is already fully received.', {
      reason: 'PO_ALREADY_RECEIVED' satisfies PurchaseOrderRefusal,
    });
  }
  if (order.status === 'CANCELLED') {
    throw new HttpError(409, 'CONFLICT', 'This order is cancelled.', {
      reason: 'PO_NOT_ORDERED' satisfies PurchaseOrderRefusal,
    });
  }
  if (order.status === 'DRAFT') {
    throw new HttpError(
      409,
      'CONFLICT',
      'Send the order to the supplier before receiving it.',
      { reason: 'PO_NOT_ORDERED' satisfies PurchaseOrderRefusal },
    );
  }

  const byId = new Map(order.items.map((item) => [item.id, item]));

  // Validate the whole request before writing anything.
  for (const line of body.lines) {
    const item = byId.get(line.itemId);
    if (!item) {
      throw new HttpError(422, 'VALIDATION_ERROR', 'A line does not belong to this order.', {
        field: 'lines',
        itemId: line.itemId,
      });
    }
    if (item.receivedQuantity + line.receivedQuantity > item.quantity) {
      throw new HttpError(
        422,
        'VALIDATION_ERROR',
        `Receiving ${line.receivedQuantity} would exceed the ${item.quantity} ordered.`,
        {
          reason: 'PO_OVER_RECEIVE' satisfies PurchaseOrderRefusal,
          itemId: line.itemId,
          ordered: item.quantity,
          alreadyReceived: item.receivedQuantity,
        },
      );
    }
  }

  const after = order.items.map((item) => {
    const line = body.lines.find((entry) => entry.itemId === item.id);
    return {
      id: item.id,
      received: item.receivedQuantity + (line?.receivedQuantity ?? 0),
      quantity: item.quantity,
    };
  });

  const fullyReceived = after.every((item) => item.received >= item.quantity);

  /**
   * The stock write.
   *
   * Receiving is the only place in the system that says "stock arrived", so it
   * must land on the same field checkout decrements, or the two drift apart the
   * moment the first shipment is booked in. That field is:
   *
   *   a line with a variant  -> ProductVariant.stock
   *   a line without one     -> WarehouseStock at the default warehouse
   *
   * exactly the rule `cart.service.ts` and `mappers.ts` already apply. Each line
   * also writes a StockMovement, which is the only record of why the count moved.
   */
  const linesWithProduct = order.items
    .filter((item) => body.lines.some((line) => line.itemId === item.id))
    .map((item) => ({
      ...item,
      delta: body.lines.find((line) => line.itemId === item.id)!.receivedQuantity,
    }));

  const variantIds = linesWithProduct
    .map((item) => item.variantId)
    .filter((value): value is string => Boolean(value));

  const variants =
    variantIds.length === 0
      ? []
      : await prisma.productVariant.findMany({
          where: { id: { in: variantIds } },
          select: { id: true, productId: true },
        });
  const variantById = new Map(variants.map((variant) => [variant.id, variant]));

  const defaultWarehouse = await prisma.warehouse.findFirst({
    where: { isDefault: true, isActive: true },
    select: { id: true },
  });

  await withAudit(
    {
      userId: actor.userId,
      action: 'po.receive',
      entity: 'purchaseOrder',
      entityId: id,
      changes: {
        lines: body.lines,
        note: body.note ?? null,
        status: fullyReceived ? 'RECEIVED' : 'PARTIAL',
      },
      ipAddress: actor.ipAddress,
    },
    async (tx) => {
      for (const line of body.lines) {
        await tx.purchaseOrderItem.update({
          where: { id: line.itemId },
          data: { receivedQuantity: { increment: line.receivedQuantity } },
        });
      }

      for (const item of linesWithProduct) {
        if (item.variantId) {
          const variant = variantById.get(item.variantId);
          if (!variant) throw notFound('Variant');

          await tx.productVariant.update({
            where: { id: item.variantId },
            data: { stock: { increment: item.delta } },
          });

          await tx.stockMovement.create({
            data: {
              productId: variant.productId,
              variantId: item.variantId,
              warehouseId: defaultWarehouse?.id ?? null,
              type: 'IN',
              quantity: item.delta,
              reason: body.note ?? 'Purchase order received',
              referenceType: 'PURCHASE_ORDER',
              referenceId: id,
              createdBy: actor.userId,
            },
          });
        } else {
          if (!defaultWarehouse) {
            throw new HttpError(
              409,
              'CONFLICT',
              'No default warehouse is configured, so received stock has nowhere to go.',
              { reason: 'NO_DEFAULT_WAREHOUSE' },
            );
          }

          /**
           * No variant: `WarehouseStock` is the stock of record for this product.
           *
           * findFirst + update/create rather than `upsert`: the compound unique
           * is (warehouseId, productId, variantId) and `variantId` is nullable,
           * so the generated `..._variantId` input cannot express "null" — a
           * cast would compile and then fail at runtime.
           */
          const existing = await tx.warehouseStock.findFirst({
            where: { warehouseId: defaultWarehouse.id, productId: item.productId, variantId: null },
            select: { id: true },
          });

          if (existing) {
            await tx.warehouseStock.update({
              where: { id: existing.id },
              data: { quantity: { increment: item.delta } },
            });
          } else {
            await tx.warehouseStock.create({
              data: {
                warehouseId: defaultWarehouse.id,
                productId: item.productId,
                variantId: null,
                quantity: item.delta,
              },
            });
          }

          await tx.stockMovement.create({
            data: {
              productId: item.productId,
              warehouseId: defaultWarehouse.id,
              type: 'IN',
              quantity: item.delta,
              reason: body.note ?? 'Purchase order received',
              referenceType: 'PURCHASE_ORDER',
              referenceId: id,
              createdBy: actor.userId,
            },
          });
        }
      }

      await tx.purchaseOrder.update({
        where: { id },
        data: {
          status: fullyReceived ? 'RECEIVED' : 'PARTIAL',
          ...(fullyReceived ? { receivedAt: new Date() } : {}),
        },
      });
    },
  );

  return getPurchaseOrder(id);
}

export async function cancelPurchaseOrder(
  id: string,
  reason: string,
  actor: Actor,
): Promise<PurchaseOrderDetail> {
  const before = await prisma.purchaseOrder.findUnique({ where: { id }, select: { status: true } });
  if (!before) throw notFound('Purchase order');

  if (before.status === 'RECEIVED') {
    throw new HttpError(
      409,
      'CONFLICT',
      'Goods already arrived. Record a return to the supplier instead of cancelling.',
      { reason: 'PO_ALREADY_RECEIVED' satisfies PurchaseOrderRefusal },
    );
  }
  if (before.status === 'CANCELLED') {
    throw new HttpError(409, 'CONFLICT', 'This order is already cancelled.');
  }

  await withAudit(
    {
      userId: actor.userId,
      action: 'po.cancel',
      entity: 'purchaseOrder',
      entityId: id,
      changes: { status: { from: before.status, to: 'CANCELLED' }, reason },
      ipAddress: actor.ipAddress,
    },
    async (tx) => {
      await tx.purchaseOrder.update({ where: { id }, data: { status: 'CANCELLED' } });
    },
  );

  return getPurchaseOrder(id);
}
