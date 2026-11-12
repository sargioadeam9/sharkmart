/**
 * One-off cleanup for `CONC-*` probe products left behind by
 * `tests/phase8.test.ts` before it moved its deletes into `finally`.
 *
 * Safe to run repeatedly: it only touches products whose SKU starts with
 * `CONC-`, which no seed data ever uses (seed SKUs are `OSB-####`).
 *
 * Run: npx tsx prisma/cleanup-conc.ts
 */
/* eslint-disable no-console -- one-off maintenance script; its whole job is to print a summary */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const products = await prisma.product.findMany({
    where: { sku: { startsWith: 'CONC-' } },
    select: { id: true, sku: true, variants: { select: { id: true } } },
  });

  if (products.length === 0) {
    console.log('cleanup-conc: nothing to do, 0 CONC-* products');
    return;
  }

  const productIds = products.map((p) => p.id);
  const variantIds = products.flatMap((p) => p.variants.map((v) => v.id));

  // OrderItem and CartItem hold non-cascading references to product + variant.
  const orderItems = await prisma.orderItem.deleteMany({
    where: { OR: [{ productId: { in: productIds } }, { variantId: { in: variantIds } }] },
  });
  const cartItems = await prisma.cartItem.deleteMany({
    where: { OR: [{ productId: { in: productIds } }, { variantId: { in: variantIds } }] },
  });
  const variants = await prisma.productVariant.deleteMany({
    where: { id: { in: variantIds } },
  });
  const deleted = await prisma.product.deleteMany({ where: { id: { in: productIds } } });

  console.log(
    `cleanup-conc: removed ${deleted.count} product(s) [${products
      .map((p) => p.sku)
      .join(', ')}], ${variants.count} variant(s), ${cartItems.count} cart line(s), ${orderItems.count} order line(s)`,
  );
}

main()
  .catch((error) => {
    console.error('cleanup-conc failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
