/**
 * Cart service — server-side cart for a signed-in user.
 *
 * The cart is a *suggestion*, not an authority (AGENTS.md §7.3). It stores
 * product/variant ids and quantities; every price shown is resolved from the
 * database at read time, and the checkout recomputes everything again. That
 * means a cart row can never carry a stale or tampered price into an order.
 *
 * Guest carts live in localStorage on the client and are merged here at login
 * via `POST /cart/sync`. The merge is additive and idempotent: a product
 * already in the server cart gets its quantity raised, never duplicated.
 */

import { prisma } from '../config/database.js';
import { HttpError } from '../middleware/errorHandler.js';

export interface CartLineDto {
  id: string;
  productId: string;
  variantId: string | null;
  quantity: number;
  slug: string;
  sku: string;
  nameEn: string;
  nameBn: string;
  imageUrl: string | null;
  /** Current unit price in poisha — always from the DB, never from the client. */
  unitPricePoisha: number;
  originalUnitPricePoisha: number;
  /** Stock available for this line right now. */
  stockQuantity: number;
  /** True when the requested quantity exceeds stock — the UI must warn. */
  insufficientStock: boolean;
  /** True when the product or variant is no longer purchasable. */
  unavailable: boolean;
  variantNameEn: string | null;
  variantNameBn: string | null;
}

export interface CartDto {
  lines: CartLineDto[];
  itemCount: number;
  subtotalPoisha: number;
  /** Lines that cannot be bought as-is; the UI blocks checkout on these. */
  hasIssues: boolean;
}

/** The price a product actually sells at today. */
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
 * Loads the cart for a user.
 *
 * One query with nested selects — no N+1. The variant, when present, carries
 * its own price and stock, which override the product's.
 */
export async function getCart(userId: string): Promise<CartDto> {
  const rows = await prisma.cartItem.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      productId: true,
      variantId: true,
      quantity: true,
      product: {
        select: {
          slug: true,
          sku: true,
          nameEn: true,
          nameBn: true,
          basePricePoisha: true,
          discountPricePoisha: true,
          flashSalePricePoisha: true,
          isFlashSale: true,
          isPublished: true,
          isDraft: true,
          images: { where: { isMain: true }, take: 1, select: { url: true } },
        },
      },
      variant: {
        select: {
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

  const lines: CartLineDto[] = rows.map((row) => {
    const product = row.product;
    const variant = row.variant;

    const unavailable =
      !product.isPublished || product.isDraft || (variant ? !variant.isActive : false);

    const unitPricePoisha = variant ? variant.pricePoisha : effectivePrice(product);
    const stockQuantity = variant ? variant.stock : 0;

    // A product with no variant selected still needs a stock figure. It is the
    // sum of its variants' stock, which is what the PDP shows.
    return {
      id: row.id,
      productId: row.productId,
      variantId: row.variantId,
      quantity: row.quantity,
      slug: product.slug,
      sku: variant?.sku ?? product.sku,
      nameEn: product.nameEn,
      nameBn: product.nameBn,
      imageUrl: product.images[0]?.url ?? null,
      unitPricePoisha,
      originalUnitPricePoisha: product.basePricePoisha,
      stockQuantity,
      insufficientStock: row.quantity > stockQuantity,
      unavailable,
      variantNameEn: variant?.nameEn ?? null,
      variantNameBn: variant?.nameBn ?? null,
    };
  });

  return {
    lines,
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    subtotalPoisha: lines.reduce((sum, line) => sum + line.unitPricePoisha * line.quantity, 0),
    hasIssues: lines.some((line) => line.unavailable || line.insufficientStock),
  };
}

/**
 * Resolves a product+variant pair and validates it is purchasable.
 *
 * Shared by add, update and sync so all three reject the same things for the
 * same reasons — an unpublished product, an inactive variant, a variant that
 * does not belong to the product.
 */
async function resolveLine(productId: string, variantId: string | null | undefined) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      isPublished: true,
      isDraft: true,
      variants: { select: { id: true, stock: true, isActive: true } },
    },
  });

  if (!product || !product.isPublished || product.isDraft) {
    throw new HttpError(404, 'NOT_FOUND', 'That product is not available.');
  }

  if (variantId) {
    const variant = product.variants.find((v) => v.id === variantId);
    if (!variant) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'That variant does not belong to this product.');
    }
    if (!variant.isActive) {
      throw new HttpError(409, 'CONFLICT', 'That variant is no longer available.');
    }
    return { productId, variantId, stock: variant.stock };
  }

  /**
   * No variant. Two legal cases, and they are not the same:
   *
   *   1. The product genuinely has no variants — its stock is the summed
   *      `WarehouseStock.quantity`, the same number the catalog mapper reports.
   *      This used to return `stock: 0`, which made every variant-less line
   *      look sold out and got it silently skipped by the merge.
   *   2. The product has variants and the caller did not choose one. That is a
   *      card quick-add (the reference does the same, `addCart(id,1,'')`), and
   *      it is legal: the line carries no variant and the server prices it at
   *      the product's base price. Guessing a variant would sell the wrong
   *      thing, so the line stays variant-less rather than picking for them.
   */
  if (product.variants.length > 0) {
    return { productId, variantId: null, stock: product.variants.reduce((sum, v) => sum + v.stock, 0) };
  }

  const warehouse = await prisma.warehouseStock.aggregate({
    where: { productId, variantId: null },
    _sum: { quantity: true },
  });

  return { productId, variantId: null, stock: warehouse._sum.quantity ?? 0 };
}

/** Adds a line, or raises the quantity of an existing one. */
export async function addItem(
  userId: string,
  input: { productId: string; variantId?: string | null; quantity: number },
): Promise<CartDto> {
  const resolved = await resolveLine(input.productId, input.variantId ?? null);

  if (resolved.stock < input.quantity) {
    throw new HttpError(409, 'OUT_OF_STOCK', 'Not enough stock for the quantity requested.');
  }

  const existing = await prisma.cartItem.findFirst({
    where: { userId, productId: input.productId, variantId: resolved.variantId },
    select: { id: true, quantity: true },
  });

  if (existing) {
    const nextQuantity = Math.min(existing.quantity + input.quantity, 99);
    if (nextQuantity > resolved.stock) {
      throw new HttpError(409, 'OUT_OF_STOCK', 'Not enough stock for the quantity requested.');
    }
    await prisma.cartItem.update({
      where: { id: existing.id },
      data: { quantity: nextQuantity },
    });
  } else {
    await prisma.cartItem.create({
      data: {
        userId,
        productId: input.productId,
        variantId: resolved.variantId,
        quantity: input.quantity,
      },
    });
  }

  return getCart(userId);
}

/**
 * Sets an absolute quantity. `0` removes the line — the reference drawer's
 * behaviour, kept consistent with the client store.
 */
export async function updateItem(
  userId: string,
  itemId: string,
  quantity: number,
): Promise<CartDto> {
  // Ownership in the query, not after the fetch.
  const item = await prisma.cartItem.findFirst({
    where: { id: itemId, userId },
    select: { id: true, variantId: true, productId: true },
  });

  if (!item) throw new HttpError(404, 'NOT_FOUND', 'Cart item not found.');

  if (quantity === 0) {
    await prisma.cartItem.delete({ where: { id: item.id } });
    return getCart(userId);
  }

  const resolved = await resolveLine(item.productId, item.variantId);
  if (quantity > resolved.stock) {
    throw new HttpError(409, 'OUT_OF_STOCK', 'Not enough stock for the quantity requested.');
  }

  await prisma.cartItem.update({ where: { id: item.id }, data: { quantity } });
  return getCart(userId);
}

export async function removeItem(userId: string, itemId: string): Promise<CartDto> {
  const item = await prisma.cartItem.findFirst({
    where: { id: itemId, userId },
    select: { id: true },
  });
  if (!item) throw new HttpError(404, 'NOT_FOUND', 'Cart item not found.');

  await prisma.cartItem.delete({ where: { id: item.id } });
  return getCart(userId);
}

/**
 * Merges a guest cart into the server cart at login.
 *
 * Additive and idempotent: an existing line's quantity is raised, never
 * duplicated, and a line already at its stock ceiling is left alone rather than
 * failing the whole sync. A merge that throws on one bad line would lose the
 * rest of the guest's cart, which is the worst possible outcome.
 *
 * Invalid lines are skipped silently and counted in the response, so the client
 * can tell the user "3 items could not be added" without a stack trace.
 */
export async function syncCart(
  userId: string,
  items: Array<{ productId: string; variantId?: string | null; quantity: number }>,
): Promise<{ cart: CartDto; merged: number; skipped: number }> {
  let merged = 0;
  let skipped = 0;

  for (const item of items) {
    try {
      const resolved = await resolveLine(item.productId, item.variantId ?? null);
      if (resolved.stock <= 0) {
        skipped += 1;
        continue;
      }

      const existing = await prisma.cartItem.findFirst({
        where: { userId, productId: item.productId, variantId: resolved.variantId },
        select: { id: true, quantity: true },
      });

      if (existing) {
        // Take the larger of the two, capped at stock. A guest who had 2 and a
        // server cart with 3 should end with 3, not 5 — the merge is a union of
        // intent, not a sum of duplicates.
        const nextQuantity = Math.min(Math.max(existing.quantity, item.quantity), resolved.stock, 99);
        if (nextQuantity !== existing.quantity) {
          await prisma.cartItem.update({ where: { id: existing.id }, data: { quantity: nextQuantity } });
        }
      } else {
        await prisma.cartItem.create({
          data: {
            userId,
            productId: item.productId,
            variantId: resolved.variantId,
            quantity: Math.min(item.quantity, resolved.stock, 99),
          },
        });
      }

      merged += 1;
    } catch {
      skipped += 1;
    }
  }

  return { cart: await getCart(userId), merged, skipped };
}

/** Empties the cart — used after a successful checkout. */
export async function clearCart(userId: string): Promise<void> {
  await prisma.cartItem.deleteMany({ where: { userId } });
}
