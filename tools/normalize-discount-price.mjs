/**
 * One-off data normalisation: clear a `discountPricePoisha` that equals the base
 * price. Dev/maintenance tool — never part of `db:seed`.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * `seed.ts` writes `discountPricePoisha` from the reference catalog, and in that
 * catalog the field equals `basePricePoisha` on all 168 rows. That value means
 * "discounted to exactly the same price", which is not a discount — it is a
 * duplicate of the base price with no reader.
 *
 * `mappers.ts` proves nothing prices off it: `payablePrice()` returns
 * `basePricePoisha` only, and the storefront never references the field. It is
 * vestigial. What it *did* do was trip the admin update guard: a PATCH that
 * touched no price at all was compared against the stored pair and rejected with
 * "discountPricePoisha must be less than basePricePoisha". Every product was
 * read-only from the admin panel.
 *
 * The guard itself is fixed in `product.service.ts` (a partial update is now
 * validated against the patch, not the merged row). This script cleans the data
 * so the field stops carrying a meaningless value and so the product editor does
 * not pre-fill one if it ever grows the input.
 *
 * ── What it does ────────────────────────────────────────────────────────────
 *
 *   UPDATE Product SET discountPricePoisha = NULL
 *    WHERE discountPricePoisha IS NOT NULL
 *      AND discountPricePoisha = basePricePoisha
 *
 * `originalPricePoisha` is deliberately untouched: that one is the struck-through
 * "was" price and the storefront uses it.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *
 *     node tools/normalize-discount-price.mjs            # dry run, prints counts
 *     node tools/normalize-discount-price.mjs --apply    # writes
 *
 * Idempotent: a second run finds nothing to change.
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(here, '..', 'server');

/** Resolve @prisma/client the way the server does, so versions cannot drift. */
const requireFromServer = createRequire(path.join(serverDir, 'package.json'));
const { PrismaClient } = requireFromServer('@prisma/client');

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

async function main() {
  const total = await prisma.product.count();

  // Prisma cannot compare two columns in a `where`, so the comparison happens in
  // memory over the (small, bounded) set of rows that carry a discount price.
  const candidates = await prisma.product.findMany({
    where: { discountPricePoisha: { not: null } },
    select: { id: true, nameEn: true, basePricePoisha: true, discountPricePoisha: true },
  });

  const redundant = candidates.filter((row) => row.discountPricePoisha === row.basePricePoisha);

  console.log(`products                       : ${total}`);
  console.log(`with a discount price          : ${candidates.length}`);
  console.log(`equal to the base price        : ${redundant.length}`);
  console.log(`genuinely below the base price : ${candidates.length - redundant.length}`);

  if (redundant.length === 0) {
    console.log('\nNothing to do — already normalised.');
    return;
  }

  for (const row of redundant.slice(0, 5)) {
    console.log(`  would clear: ${row.nameEn} (${row.basePricePoisha} poisha)`);
  }
  if (redundant.length > 5) console.log(`  … and ${redundant.length - 5} more`);

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to write.');
    return;
  }

  const result = await prisma.product.updateMany({
    where: { id: { in: redundant.map((row) => row.id) } },
    data: { discountPricePoisha: null },
  });

  console.log(`\nCleared ${result.count} rows.`);

  const remaining = await prisma.product.count({
    where: { discountPricePoisha: { not: null } },
  });
  console.log(`Products still carrying a discount price: ${remaining}`);
}

main()
  .catch((error) => {
    console.error('FAILED:', error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
