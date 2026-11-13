/**
 * Checkout — the critical path. AGENTS.md §7.3, security.md §6, masterbuild Phase 8.
 *
 * The rules this file exists to enforce:
 *
 *   1. **The client sends ids and quantities. Nothing else.** Every price,
 *      discount, delivery charge and total is read from the database and
 *      recomputed here. A tampered payload cannot lower a price because there
 *      is no price in the payload to tamper with.
 *   2. **Coupons are re-validated server-side**, not trusted from the cart.
 *      Window, usage limit, per-user limit and minimum order are all checked
 *      again at the moment of purchase.
 *   3. **Stock is reserved atomically.** A conditional `UPDATE ... WHERE
 *      stock >= n` is the reservation: MySQL either applies it or it does not,
 *      and the affected-row count is the answer. No read-then-write race.
 *   4. **All or nothing.** If any line is short, the whole transaction rolls
 *      back. Partial fulfilment of a cart is not a thing a customer asked for.
 *   5. **Idempotent.** The same `Idempotency-Key` twice returns the same order
 *      rather than creating a second one.
 *
 * Concurrency strategy, stated plainly because the gate asks for it:
 *   - Stock: `UPDATE productVariant SET stock = stock - n WHERE id = ? AND
 *     stock >= n`. The `WHERE` clause is the lock. Two concurrent checkouts of
 *     the last unit both run it; exactly one gets `affectedRows = 1`, the other
 *     gets 0 and the transaction aborts with a clean 409.
 *   - Coupon per-user limit: a unique index on `(couponId, userId)` in
 *     `CouponRedemption`. The database rejects the second redemption, so the
 *     limit holds even if two requests interleave.
 *   - Idempotency: a unique index on `(scope, key)`. The second insert fails
 *     and the handler returns the stored response.
 */

import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { DELIVERY_DEFAULTS } from '../config/store-defaults.js';
import { HttpError } from '../middleware/errorHandler.js';
import { clearCart } from './cart.service.js';
import { getDeliveryFees } from './settings.service.js';
import {
  canCustomerTransition,
  canTransition,
  releasesStock,
  transitionRefusal,
  type OrderStatus,
} from './order-status.js';

/**
 * Delivery defaults. The live values come from the `Setting` table through
 * `getDeliveryFees()`; these are the fallbacks a fresh database uses.
 *
 * Re-exported under the old names because other modules and docs refer to them.
 */
export const DELIVERY_FLAT_POISHA = DELIVERY_DEFAULTS.standardFeePoisha;
export const FREE_DELIVERY_THRESHOLD_POISHA = DELIVERY_DEFAULTS.freeThresholdPoisha;
export const EXPRESS_SURCHARGE_POISHA = DELIVERY_DEFAULTS.expressSurchargePoisha;

export interface CheckoutInput {
  items: Array<{ productId: string; variantId?: string | null; quantity: number }>;
  addressId?: string;
  address?: {
    recipientName?: string;
    phone?: string;
    division?: string;
    district?: string;
    area?: string;
    address?: string;
    postalCode?: string;
    label?: string;
  };
  deliveryMethod: 'STANDARD' | 'EXPRESS';
  paymentMethod: 'COD' | 'BKASH' | 'NAGAD' | 'SSLCOMMERZ';
  couponCode?: string;
  notes?: string;
  guestPhone?: string;
  guestName?: string;
}

export interface OrderLineDto {
  id: string;
  productId: string;
  variantId: string | null;
  nameEn: string;
  nameBn: string;
  sku: string;
  quantity: number;
  unitPricePoisha: number;
  lineTotalPoisha: number;
  returnStatus: string | null;
}

export interface OrderDto {
  id: string;
  orderNumber: string;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  subtotalPoisha: number;
  discountAmountPoisha: number;
  deliveryChargePoisha: number;
  totalAmountPoisha: number;
  paidAmountPoisha: number;
  couponCode: string | null;
  createdAt: string;
  items: OrderLineDto[];
  shippingAddress: {
    recipientName: string;
    phone: string;
    division: string;
    district: string;
    area: string;
    address: string;
    postalCode: string | null;
  } | null;
  statusHistory: Array<{ status: string; note: string | null; createdAt: string }>;
  trackingUrl: string | null;
  courierName: string | null;
  consignmentId: string | null;
}

/**
 * A non-sequential public order number.
 *
 * security.md §11: "Order numbers are non-sequential. Internal auto-increment
 * ids never appear in a URL." A sequential number lets anyone scrape the whole
 * order book and probe for other people's orders; a random one makes each guess
 * independent.
 *
 * Format: `SM-` + base36 timestamp (sortable, 8 chars) + 4 random chars.
 * The timestamp keeps orders roughly ordered for support; the random suffix
 * makes enumeration impractical.
 */
export function generateOrderNumber(): string {
  const time = Date.now().toString(36).toUpperCase().slice(-6);
  const rand = randomBytes(3).toString('hex').toUpperCase().slice(0, 4);
  return `SM-${time}${rand}`;
}

/** The price a product sells at today — must match the cart's derivation. */
function effectivePrice(product: {
  basePricePoisha: number;
  discountPricePoisha: number | null;
  flashSalePricePoisha: number | null;
  isFlashSale: boolean;
}): number {
  if (product.isFlashSale && product.flashSalePricePoisha !== null) {
    return product.flashSalePricePoisha;
  }
  if (product.discountPricePoisha !== null) return product.discountPricePoisha;
  return product.basePricePoisha;
}

/**
 * Delivery charge for a subtotal.
 *
 * Async because the three numbers are now store settings, not constants: an
 * operator changing the flat fee in the admin panel must change what checkout
 * charges on the next order. The read is cached (`getDeliveryFees`), so this is
 * one map lookup, not three queries, and it never throws — a settings read that
 * fails falls back to the defaults rather than refusing an order.
 */
export async function deliveryChargeFor(
  subtotalPoisha: number,
  method: 'STANDARD' | 'EXPRESS',
): Promise<number> {
  const fees = await getDeliveryFees();
  const base = subtotalPoisha >= fees.freeThresholdPoisha ? 0 : fees.standardFeePoisha;
  return method === 'EXPRESS' ? base + fees.expressSurchargePoisha : base;
}

interface CouponResult {
  couponId: string | null;
  code: string | null;
  discountPoisha: number;
  freeDelivery: boolean;
}

/**
 * Re-validates a coupon and computes its discount.
 *
 * Every rule is checked here, at purchase time, against the database — not
 * against anything the client sent. A coupon that was valid when it was added
 * to the cart may have expired, hit its usage cap, or been used by this user
 * already; all three are caught at this point.
 */
async function applyCoupon(
  code: string | undefined,
  userId: string | null,
  subtotalPoisha: number,
  lineProductIds: string[],
): Promise<CouponResult> {
  const none: CouponResult = { couponId: null, code: null, discountPoisha: 0, freeDelivery: false };
  if (!code) return none;

  const coupon = await prisma.coupon.findUnique({
    where: { code: code.toUpperCase() },
    select: {
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
      isActive: true,
      applicableProducts: true,
      applicableCategories: true,
      applicableBrands: true,
    },
  });

  if (!coupon || !coupon.isActive) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'This coupon is not valid.');
  }

  const now = new Date();
  if (now < coupon.startDate || now > coupon.endDate) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'This coupon has expired.');
  }

  if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'This coupon has reached its usage limit.');
  }

  if (coupon.minOrderValuePoisha !== null && subtotalPoisha < coupon.minOrderValuePoisha) {
    throw new HttpError(
      422,
      'VALIDATION_ERROR',
      `This coupon needs a minimum order of ৳${Math.round(coupon.minOrderValuePoisha / 100)}.`,
    );
  }

  // Per-user limit. A guest has no identity to enforce against, so a
  // per-user-limited coupon requires a session.
  if (userId) {
    const used = await prisma.couponRedemption.count({
      where: { couponId: coupon.id, userId },
    });
    if (used >= coupon.perUserLimit) {
      throw new HttpError(422, 'VALIDATION_ERROR', 'You have already used this coupon.');
    }
  } else if (coupon.perUserLimit > 0) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Sign in to use this coupon.');
  }

  /**
   * Scoping: products, categories and brands.
   *
   * A line is eligible when it satisfies **every** scope the coupon sets, and
   * the coupon applies when at least one line is eligible. Adding a scope
   * therefore narrows the offer rather than widening it, which is what an
   * operator ticking boxes in the builder expects.
   *
   * `applicableCategories` and `applicableBrands` were selected since Phase 8 and
   * never read: a coupon scoped to "Fashion" applied to a rice cooker. Phase 10's
   * builder offers all three scopes, so leaving them unenforced would mean the
   * panel configures something that does nothing.
   *
   * The category/brand lookup only runs when one of those two scopes is set, and
   * is bounded by the cart's line count.
   */
  const scopedProducts = coupon.applicableProducts as string[] | null;
  const scopedCategories = coupon.applicableCategories as string[] | null;
  const scopedBrands = coupon.applicableBrands as string[] | null;

  const hasProductScope = Array.isArray(scopedProducts) && scopedProducts.length > 0;
  const hasCategoryScope = Array.isArray(scopedCategories) && scopedCategories.length > 0;
  const hasBrandScope = Array.isArray(scopedBrands) && scopedBrands.length > 0;

  if (hasProductScope || hasCategoryScope || hasBrandScope) {
    const lines =
      hasCategoryScope || hasBrandScope
        ? await prisma.product.findMany({
            where: { id: { in: lineProductIds } },
            select: { id: true, categoryId: true, brandId: true },
          })
        : lineProductIds.map((id) => ({ id, categoryId: null, brandId: null }));

    const eligible = lines.some(
      (line) =>
        (!hasProductScope || scopedProducts!.includes(line.id)) &&
        (!hasCategoryScope ||
          (line.categoryId !== null && scopedCategories!.includes(line.categoryId))) &&
        (!hasBrandScope || (line.brandId !== null && scopedBrands!.includes(line.brandId))),
    );

    if (!eligible) {
      throw new HttpError(422, 'VALIDATION_ERROR', 'This coupon does not apply to these items.');
    }
  }

  if (coupon.type === 'FREE_DELIVERY') {
    return { couponId: coupon.id, code: coupon.code, discountPoisha: 0, freeDelivery: true };
  }

  let discount =
    coupon.type === 'FIXED'
      ? coupon.value
      : Math.floor((subtotalPoisha * coupon.value) / 100);

  if (coupon.maxDiscountPoisha !== null) {
    discount = Math.min(discount, coupon.maxDiscountPoisha);
  }

  // A discount can never exceed the subtotal — a negative total would mean we
  // owe the customer money for shopping.
  discount = Math.min(discount, subtotalPoisha);

  return { couponId: coupon.id, code: coupon.code, discountPoisha: discount, freeDelivery: false };
}

/**
 * Reserves stock for one line.
 *
 * This single statement is the entire concurrency control:
 *
 *   UPDATE productVariant SET stock = stock - ? WHERE id = ? AND stock >= ?
 *
 * MySQL evaluates the `WHERE` and the write atomically under a row lock, so two
 * concurrent checkouts of the last unit cannot both succeed. `affectedRows === 0`
 * means someone else got there first.
 *
 * `reservedStock` is incremented in the same statement so the admin panel can
 * see committed-but-unshipped units without a second query.
 */
async function reserveVariantStock(
  tx: Prisma.TransactionClient,
  variantId: string,
  quantity: number,
): Promise<boolean> {
  const affected = await tx.$executeRaw`
    UPDATE ProductVariant
    SET stock = stock - ${quantity}, reservedStock = reservedStock + ${quantity}
    WHERE id = ${variantId} AND stock >= ${quantity}
  `;
  return affected === 1;
}

/**
 * Places an order.
 *
 * Runs inside one interactive transaction: price resolution, coupon validation,
 * stock reservation, order creation, status history and the coupon ledger all
 * commit together or not at all.
 *
 * The SMS/email enqueue happens **after** the transaction commits and is not
 * awaited into the response — masterbuild Phase 8 item 6: "Never block the
 * response on it." A notification table row is written inside the transaction
 * so the intent is durable; the actual send is a worker's job.
 */
export async function placeOrder(
  userId: string | null,
  input: CheckoutInput,
  meta: { ipAddress?: string; idempotencyKey?: string } = {},
): Promise<OrderDto> {
  // ── Resolve the shipping address ──────────────────────────────────────
  let shipping: {
    recipientName: string;
    phone: string;
    division: string;
    district: string;
    area: string;
    address: string;
    postalCode: string | null;
  };

  if (input.addressId) {
    if (!userId) {
      throw new HttpError(401, 'UNAUTHORIZED', 'Sign in to use a saved address.');
    }
    // Ownership in the query.
    const saved = await prisma.address.findFirst({
      where: { id: input.addressId, userId },
      select: {
        recipientName: true,
        phone: true,
        division: true,
        district: true,
        area: true,
        address: true,
        postalCode: true,
      },
    });
    if (!saved) throw new HttpError(404, 'NOT_FOUND', 'Address not found.');
    shipping = saved;
  } else {
    const a = input.address ?? {};
    if (!a.recipientName || !a.phone || !a.division || !a.district || !a.area || !a.address) {
      throw new HttpError(422, 'VALIDATION_ERROR', 'A complete delivery address is required.');
    }
    shipping = {
      recipientName: a.recipientName,
      phone: a.phone,
      division: a.division,
      district: a.district,
      area: a.area,
      address: a.address,
      postalCode: a.postalCode ?? null,
    };
  }

  // A guest order needs a phone for the courier and for tracking.
  const guestPhone = userId ? null : (input.guestPhone ?? shipping.phone);
  if (!userId && !guestPhone) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'A phone number is required to place an order.');
  }

  // ── Resolve every line from the database ──────────────────────────────
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
      isPublished: true,
      isDraft: true,
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

  const byId = new Map(products.map((p) => [p.id, p]));

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

  const lines: ResolvedLine[] = [];

  for (const item of input.items) {
    const product = byId.get(item.productId);
    if (!product || !product.isPublished || product.isDraft) {
      throw new HttpError(409, 'CONFLICT', 'An item in your cart is no longer available.');
    }

    let unitPricePoisha: number;
    let sku: string;
    let variantId: string | null = null;

    if (item.variantId) {
      const variant = product.variants.find((v) => v.id === item.variantId);
      if (!variant || !variant.isActive) {
        throw new HttpError(409, 'CONFLICT', 'An item in your cart is no longer available.');
      }
      variantId = variant.id;
      unitPricePoisha = variant.pricePoisha;
      sku = variant.sku;
    } else {
      if (product.variants.length > 0) {
        throw new HttpError(422, 'VALIDATION_ERROR', 'Please choose a variant for every item.');
      }
      unitPricePoisha = effectivePrice(product);
      sku = product.sku;
    }

    lines.push({
      productId: product.id,
      variantId,
      nameEn: product.nameEn,
      nameBn: product.nameBn,
      sku,
      quantity: item.quantity,
      unitPricePoisha,
      lineTotalPoisha: unitPricePoisha * item.quantity,
    });
  }

  // ── Money, recomputed ─────────────────────────────────────────────────
  const subtotalPoisha = lines.reduce((sum, line) => sum + line.lineTotalPoisha, 0);

  const coupon = await applyCoupon(
    input.couponCode,
    userId,
    subtotalPoisha,
    lines.map((line) => line.productId),
  );

  let deliveryChargePoisha = await deliveryChargeFor(subtotalPoisha, input.deliveryMethod);
  if (coupon.freeDelivery) deliveryChargePoisha = 0;

  const discountAmountPoisha = coupon.discountPoisha;
  const totalAmountPoisha = Math.max(
    0,
    subtotalPoisha - discountAmountPoisha + deliveryChargePoisha,
  );

  // ── One transaction: reserve, create, record ──────────────────────────
  const order = await prisma.$transaction(async (tx) => {
    /**
     * Reserve stock first. Doing it before the order row exists means a
     * shortage aborts with nothing written — no orphan order to clean up.
     */
    for (const line of lines) {
      if (!line.variantId) continue; // Variantless products carry no stock row.

      const reserved = await reserveVariantStock(tx, line.variantId, line.quantity);
      if (!reserved) {
        throw new HttpError(
          409,
          'OUT_OF_STOCK',
          `${line.nameEn} does not have enough stock. Please adjust your cart.`,
        );
      }
    }

    /**
     * Claim the coupon. The unique index on (couponId, userId) is what makes
     * the per-user limit real under concurrency; a violation surfaces as a
     * P2002 and is translated to a clean 422 below.
     *
     * `orderId` starts null because the order row does not exist yet — the
     * claim has to happen first, or two concurrent checkouts could both pass
     * the per-user check before either writes. It is filled in after creation.
     */
    let redemptionId: string | null = null;
    if (coupon.couponId && userId) {
      try {
        const redemption = await tx.couponRedemption.create({
          data: {
            couponId: coupon.couponId,
            userId,
            orderId: null,
            amountPoisha: discountAmountPoisha,
          },
          select: { id: true },
        });
        redemptionId = redemption.id;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new HttpError(422, 'VALIDATION_ERROR', 'You have already used this coupon.');
        }
        throw error;
      }
    }

    if (coupon.couponId) {
      await tx.coupon.update({
        where: { id: coupon.couponId },
        data: { usedCount: { increment: 1 } },
      });
    }

    const created = await tx.order.create({
      data: {
        orderNumber: generateOrderNumber(),
        userId: userId ?? null,
        guestPhone,
        guestName: userId ? null : (input.guestName ?? shipping.recipientName),
        currentStatus: 'PENDING',
        subtotalPoisha,
        discountAmountPoisha,
        couponId: coupon.couponId,
        deliveryChargePoisha,
        totalAmountPoisha,
        paymentMethod: input.paymentMethod,
        paymentStatus: 'UNPAID',
        notes: input.notes ?? null,
        idempotencyKey: meta.idempotencyKey ?? null,
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
        shippingAddress: {
          create: {
            recipientName: shipping.recipientName,
            phone: shipping.phone,
            division: shipping.division,
            district: shipping.district,
            area: shipping.area,
            address: shipping.address,
            postalCode: shipping.postalCode,
          },
        },
        statusHistory: {
          create: {
            status: 'PENDING',
            note: 'Order placed',
            changedBy: userId,
          },
        },
      },
      select: { id: true, orderNumber: true },
    });

    // Point the redemption at the real order id now that it exists.
    if (redemptionId) {
      await tx.couponRedemption.update({
        where: { id: redemptionId },
        data: { orderId: created.id },
      });
    }

    /**
     * Durable notification intent. The row is written here so it cannot be lost
     * if the process dies after the response; the send is a worker's job and is
     * never awaited into the request.
     */
    if (userId) {
      await tx.notification.create({
        data: {
          type: 'ORDER_CONFIRMATION',
          recipientId: userId,
          channel: 'SMS',
          subject: `Order ${created.orderNumber}`,
          body: `Your SharkMart order ${created.orderNumber} has been received.`,
          status: 'PENDING',
        },
      });
    }

    return created;
  });

  // The cart is now the order. Clearing it is outside the transaction on
  // purpose: if this fails the order still stands and the user can clear it
  // manually, which is far better than rolling back a paid order.
  if (userId) {
    await clearCart(userId).catch(() => undefined);
  }

  const dto = await getOrderById(order.id);
  if (!dto) throw new HttpError(500, 'INTERNAL_ERROR', 'Order was created but could not be read back.');
  return dto;
}

/** Maps an order row to the wire DTO. */
function toOrderDto(order: {
  id: string;
  orderNumber: string;
  currentStatus: string;
  paymentMethod: string;
  paymentStatus: string;
  subtotalPoisha: number;
  discountAmountPoisha: number;
  deliveryChargePoisha: number;
  totalAmountPoisha: number;
  paidAmountPoisha: number;
  createdAt: Date;
  trackingUrl: string | null;
  courierName: string | null;
  consignmentId: string | null;
  coupon: { code: string } | null;
  items: Array<{
    id: string;
    productId: string;
    variantId: string | null;
    nameEn: string;
    nameBn: string;
    sku: string;
    quantity: number;
    unitPricePoisha: number;
    lineTotalPoisha: number;
    returnStatus: string | null;
  }>;
  shippingAddress: {
    recipientName: string;
    phone: string;
    division: string;
    district: string;
    area: string;
    address: string;
    postalCode: string | null;
  } | null;
  statusHistory: Array<{ status: string; note: string | null; createdAt: Date }>;
}): OrderDto {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.currentStatus,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    subtotalPoisha: order.subtotalPoisha,
    discountAmountPoisha: order.discountAmountPoisha,
    deliveryChargePoisha: order.deliveryChargePoisha,
    totalAmountPoisha: order.totalAmountPoisha,
    paidAmountPoisha: order.paidAmountPoisha,
    couponCode: order.coupon?.code ?? null,
    createdAt: order.createdAt.toISOString(),
    items: order.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      variantId: item.variantId,
      nameEn: item.nameEn,
      nameBn: item.nameBn,
      sku: item.sku,
      quantity: item.quantity,
      unitPricePoisha: item.unitPricePoisha,
      lineTotalPoisha: item.lineTotalPoisha,
      returnStatus: item.returnStatus,
    })),
    shippingAddress: order.shippingAddress,
    statusHistory: order.statusHistory.map((entry) => ({
      status: entry.status,
      note: entry.note,
      createdAt: entry.createdAt.toISOString(),
    })),
    trackingUrl: order.trackingUrl,
    courierName: order.courierName,
    consignmentId: order.consignmentId,
  };
}

const ORDER_SELECT = {
  id: true,
  orderNumber: true,
  currentStatus: true,
  paymentMethod: true,
  paymentStatus: true,
  subtotalPoisha: true,
  discountAmountPoisha: true,
  deliveryChargePoisha: true,
  totalAmountPoisha: true,
  paidAmountPoisha: true,
  createdAt: true,
  trackingUrl: true,
  courierName: true,
  consignmentId: true,
  coupon: { select: { code: true } },
  items: {
    select: {
      id: true,
      productId: true,
      variantId: true,
      nameEn: true,
      nameBn: true,
      sku: true,
      quantity: true,
      unitPricePoisha: true,
      lineTotalPoisha: true,
      returnStatus: true,
    },
  },
  shippingAddress: {
    select: {
      recipientName: true,
      phone: true,
      division: true,
      district: true,
      area: true,
      address: true,
      postalCode: true,
    },
  },
  statusHistory: {
    select: { status: true, note: true, createdAt: true },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.OrderSelect;

/** Reads an order by internal id. No ownership check — callers must apply one. */
export async function getOrderById(orderId: string): Promise<OrderDto | null> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: ORDER_SELECT });
  return order ? toOrderDto(order) : null;
}

/**
 * Reads an order that belongs to a user.
 *
 * Ownership is in the `where`, so another user's order is a 404 — not a 403
 * that confirms the id exists (security.md §6).
 */
export async function getOrderForUser(userId: string, orderId: string): Promise<OrderDto | null> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    select: ORDER_SELECT,
  });
  return order ? toOrderDto(order) : null;
}

/**
 * Verifies a payment gateway result — AGENTS.md §7.10, security.md §10.
 *
 * The redirect that brings a buyer back from bKash/Nagad/SSLCommerz is **not**
 * trusted. Anyone can craft a URL. The only trustworthy signal is the gateway's
 * own record of the transaction, fetched server-side.
 *
 * `verifyWithGateway` is the seam. In this phase no live credential exists, so
 * it returns `unverified` and the order is never marked PAID on an unverified
 * claim. Wiring a real gateway means filling in this one function — the amount
 * reconciliation and the state transition around it are already correct and
 * must not be bypassed.
 *
 * The amount check is the part people skip: a gateway callback that says
 * "success" for ৳1 on a ৳5,000 order is an attack, and it is caught by
 * comparing the callback amount to `order.totalAmountPoisha`, not by trusting
 * the status string.
 */
async function verifyWithGateway(input: {
  gateway: string;
  transactionId: string;
  orderNumber: string;
  expectedAmountPoisha: number;
}): Promise<{ verified: boolean; amountPoisha: number | null }> {
  /**
   * PHASE 10 SEAM: call the provider's query API here.
   *   bKash        → GET /payment/query/{paymentID}
   *   Nagad        → GET /verify/payment/{paymentRefId}
   *   SSLCommerz   → POST /validator/api/validationserverAPI.php
   * Each returns an amount and a status; compare the amount to
   * `expectedAmountPoisha` before returning verified: true.
   */
  void input;
  return { verified: false, amountPoisha: null };
}

/**
 * Applies a gateway result to an order.
 *
 * Only a SUCCESS with a verified amount moves the order to PAID. A FAILED or
 * CANCELLED result leaves the order PENDING and UNPAID, so the customer can
 * retry — cancelling it would throw away a cart they may still want.
 */
export async function verifyPayment(
  input: {
    orderNumber: string;
    gateway: 'BKASH' | 'NAGAD' | 'SSLCOMMERZ';
    transactionId: string;
    status: 'SUCCESS' | 'FAILED' | 'CANCELLED';
  },
  userId: string | null,
): Promise<OrderDto> {
  const order = await prisma.order.findUnique({
    where: { orderNumber: input.orderNumber },
    select: {
      id: true,
      userId: true,
      totalAmountPoisha: true,
      paymentStatus: true,
      currentStatus: true,
    },
  });

  if (!order) throw new HttpError(404, 'NOT_FOUND', 'Order not found.');

  // A signed-in user may only verify their own order. A guest has no identity
  // beyond the order number, which is why the number is non-sequential.
  if (order.userId && userId && order.userId !== userId) {
    throw new HttpError(404, 'NOT_FOUND', 'Order not found.');
  }

  if (input.status !== 'SUCCESS') {
    // Record the attempt but do not change the money state.
    await prisma.order.update({
      where: { id: order.id },
      data: { paymentGateway: input.gateway, paymentTxnId: input.transactionId },
    });
    const dto = await getOrderById(order.id);
    return dto!;
  }

  // Already paid — a duplicate callback is a no-op, not a second payment.
  if (order.paymentStatus === 'PAID') {
    const dto = await getOrderById(order.id);
    return dto!;
  }

  const verification = await verifyWithGateway({
    gateway: input.gateway,
    transactionId: input.transactionId,
    orderNumber: input.orderNumber,
    expectedAmountPoisha: order.totalAmountPoisha,
  });

  if (!verification.verified) {
    /**
     * No live gateway credential in this phase. The transaction id is recorded
     * so a reconciliation job can settle it later, but the order is NOT marked
     * paid — marking it paid on an unverified claim is exactly the hole
     * security.md §10 exists to close.
     */
    await prisma.order.update({
      where: { id: order.id },
      data: { paymentGateway: input.gateway, paymentTxnId: input.transactionId },
    });

    throw new HttpError(
      409,
      'PAYMENT_FAILED',
      'We could not verify this payment yet. If you were charged, it will be confirmed shortly.',
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: order.id },
      data: {
        paymentStatus: 'PAID',
        paidAmountPoisha: verification.amountPoisha ?? order.totalAmountPoisha,
        paymentGateway: input.gateway,
        paymentTxnId: input.transactionId,
        currentStatus: order.currentStatus === 'PENDING' ? 'CONFIRMED' : order.currentStatus,
      },
    });

    if (order.currentStatus === 'PENDING') {
      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          status: 'CONFIRMED',
          note: `Payment confirmed via ${input.gateway}`,
        },
      });
    }

    return order.id;
  });

  const dto = await getOrderById(updated);
  return dto!;
}

/**
 * Cancels an order and returns its stock.
 *
 * The status machine decides whether the move is legal; the caller decides
 * whether this actor is allowed to make it. Restocking is conditional on
 * `releasesStock` so a cancel and a return cannot double-count.
 */
export async function cancelOrder(
  orderId: string,
  options: { reason?: string; changedBy?: string; byCustomer: boolean },
): Promise<OrderDto> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      currentStatus: true,
      items: { select: { variantId: true, quantity: true } },
    },
  });

  if (!order) throw new HttpError(404, 'NOT_FOUND', 'Order not found.');

  const from = order.currentStatus as OrderStatus;
  const allowed = options.byCustomer
    ? canCustomerTransition(from, 'CANCELLED')
    : canTransition(from, 'CANCELLED');

  if (!allowed) {
    throw new HttpError(409, 'CONFLICT', transitionRefusal(from, 'CANCELLED'));
  }

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: order.id },
      data: { currentStatus: 'CANCELLED' },
    });

    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        status: 'CANCELLED',
        note: options.reason ?? 'Cancelled',
        changedBy: options.changedBy ?? null,
      },
    });

    // Put the units back. Same statement shape as the reservation, so the
    // stock ledger stays symmetric.
    if (releasesStock('CANCELLED')) {
      for (const item of order.items) {
        if (!item.variantId) continue;
        await tx.$executeRaw`
          UPDATE ProductVariant
          SET stock = stock + ${item.quantity},
              reservedStock = GREATEST(0, reservedStock - ${item.quantity})
          WHERE id = ${item.variantId}
        `;
      }
    }
  });

  const dto = await getOrderById(order.id);
  return dto!;
}

/**
 * Requests a return on a delivered order.
 *
 * Moves the order to RETURNED and flags the requested lines. The refund itself
 * is a separate, staff-driven step through REFUND_PENDING → REFUNDED — a
 * customer asking for a return must not be able to move money.
 */
export async function requestReturn(
  orderId: string,
  input: { reason: string; itemIds?: string[] },
  changedBy: string,
): Promise<OrderDto> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      currentStatus: true,
      items: { select: { id: true, variantId: true, quantity: true } },
    },
  });

  if (!order) throw new HttpError(404, 'NOT_FOUND', 'Order not found.');

  const from = order.currentStatus as OrderStatus;
  if (!canCustomerTransition(from, 'RETURNED')) {
    throw new HttpError(409, 'CONFLICT', transitionRefusal(from, 'RETURNED'));
  }

  const targets = input.itemIds
    ? order.items.filter((item) => input.itemIds!.includes(item.id))
    : order.items;

  if (targets.length === 0) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'None of those items belong to this order.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: order.id },
      data: { currentStatus: 'RETURNED' },
    });

    await tx.orderItem.updateMany({
      where: { id: { in: targets.map((t) => t.id) } },
      data: { returnStatus: 'REQUESTED' },
    });

    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        status: 'RETURNED',
        note: `Return requested: ${input.reason}`,
        changedBy,
      },
    });

    for (const item of targets) {
      if (!item.variantId) continue;
      await tx.$executeRaw`
        UPDATE ProductVariant
        SET stock = stock + ${item.quantity},
            reservedStock = GREATEST(0, reservedStock - ${item.quantity})
        WHERE id = ${item.variantId}
      `;
    }
  });

  const dto = await getOrderById(order.id);
  return dto!;
}

/** Lists a user's orders, newest first, paginated. */
export async function listOrdersForUser(
  userId: string,
  options: { page: number; limit: number; status?: string },
): Promise<{ items: OrderDto[]; total: number }> {
  const where = {
    userId,
    ...(options.status ? { currentStatus: options.status as OrderStatus } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.order.findMany({
      where,
      select: ORDER_SELECT,
      orderBy: { createdAt: 'desc' },
      skip: (options.page - 1) * options.limit,
      take: options.limit,
    }),
    prisma.order.count({ where }),
  ]);

  return { items: rows.map(toOrderDto), total };
}

/**
 * Public tracking: order number **and** phone must both match.
 *
 * Either alone returns not found (security.md §11). The order number is
 * non-sequential, and the phone is the second factor — together they are
 * unguessable enough for a public endpoint.
 *
 * The phone comparison is done on digits only, because the same number is
 * stored as `01712345678` on one order and `+8801712345678` on another
 * depending on how it was typed. Comparing raw strings would silently fail to
 * find a real order.
 */
export async function trackOrder(orderNumber: string, phone: string): Promise<OrderDto | null> {
  const digits = phone.replace(/\D/g, '');
  // The last 10 digits are the local number without the leading 0 — this makes
  // 01712345678, +8801712345678 and 8801712345678 all match one order.
  const tail = digits.slice(-10);

  const order = await prisma.order.findFirst({
    where: {
      orderNumber,
      OR: [
        { guestPhone: { endsWith: tail } },
        { shippingAddress: { phone: { endsWith: tail } } },
        { user: { phone: { endsWith: tail } } },
      ],
    },
    select: ORDER_SELECT,
  });

  return order ? toOrderDto(order) : null;
}
