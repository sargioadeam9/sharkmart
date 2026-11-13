/**
 * dev fixture for verifying the moderation screen; not seed data, never run
 * against production.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * `seed.ts:496` refuses to create reviews on purpose: "a fabricated customer
 * review is not demo data, it is a lie with a name on it. The empty state is the
 * honest answer." That is the right call for the seed and it means the reviews
 * screen has nothing to render until a real customer writes something.
 *
 * A moderation screen cannot be verified against an empty table. This script
 * creates reviews for exactly that purpose — to look at the queue, click
 * Approve, and watch the state change. It is a fixture, it lives in `tools/`
 * rather than `prisma/`, and it is never part of `db:seed`.
 *
 * ── What it does ────────────────────────────────────────────────────────────
 *
 *   - picks one product (or takes --product=<id>)
 *   - creates N reviewer accounts (customers) so the per-product/user unique
 *     constraint is satisfied — Review has @@unique([productId, userId]), so
 *     twelve reviews on one product needs twelve distinct users
 *   - spreads ratings 1–5, flags some, approves some, leaves the rest pending
 *   - prints the product id and a per-state tally so the next step is obvious
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *
 *     node tools/review-fixture.mjs 12
 *     node tools/review-fixture.mjs 12 --product=<productId>
 *     node tools/review-fixture.mjs --clean        # remove fixture rows only
 *
 * `--clean` deletes only rows whose reviewer email ends in `@fixture.local`, so
 * it cannot touch a real review.
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * `@prisma/client` and `bcrypt` are installed in `server/node_modules`, not the
 * repo root. ESM resolution is anchored to THIS file's directory, so a bare
 * `import '@prisma/client'` from `tools/` cannot find them — it looks in
 * `tools/node_modules` and the root, and neither has the package.
 *
 * `createRequire` pointed at `server/package.json` resolves the way the server
 * itself does, which is the only version that keeps working if the dependency
 * tree moves.
 */
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'server');
const requireFromServer = createRequire(path.join(serverDir, 'package.json'));

const { PrismaClient } = requireFromServer('@prisma/client');
const bcrypt = requireFromServer('bcrypt');

const prisma = new PrismaClient();

/** Every fixture reviewer carries this domain, which is what --clean keys on. */
const FIXTURE_DOMAIN = '@fixture.local';

const TITLES = [
  ['Exactly as described', 'ঠিক যেমন বর্ণনা করা হয়েছে'],
  ['Good value for the price', 'দামের তুলনায় ভালো'],
  ['Arrived damaged', 'ভাঙা অবস্থায় এসেছে'],
  ['Would buy again', 'আবার কিনব'],
  ['Not what I expected', 'যা ভেবেছিলাম তা নয়'],
  ['Delivery was fast', 'ডেলিভারি দ্রুত ছিল'],
  ['Quality could be better', 'মান আরও ভালো হতে পারত'],
  ['Perfect for daily use', 'প্রতিদিন ব্যবহারের জন্য উপযুক্ত'],
  ['Colour is different from the photo', 'ছবির থেকে রং আলাদা'],
  ['Solid build', 'মজবুত তৈরি'],
  ['Size runs small', 'সাইজ ছোট হয়'],
  ['Very happy with this', 'এটি নিয়ে খুব খুশি'],
];

const BODIES = [
  [
    'The stitching is neat and the fabric feels heavier than I expected at this price. Arrived two days early.',
    'সেলাই পরিষ্কার এবং এই দামে কাপড় প্রত্যাশার চেয়ে ভারী মনে হয়েছে। দুই দিন আগে পৌঁছেছে।',
  ],
  [
    'Works fine but the packaging was crushed on one corner. Product itself is undamaged.',
    'ঠিকঠাক কাজ করে তবে প্যাকেজিংয়ের এক কোণা চ্যাপ্টা ছিল। পণ্য নিজে অক্ষত।',
  ],
  [
    'Ordered a medium and it fits like a small. Check the size guide before you buy.',
    'মিডিয়াম অর্ডার করেছিলাম কিন্তু ছোটের মতো ফিট হয়। কেনার আগে সাইজ গাইড দেখুন।',
  ],
  [
    'Been using it daily for three weeks with no issues. Would recommend to a friend.',
    'তিন সপ্তাহ ধরে প্রতিদিন ব্যবহার করছি, কোনো সমস্যা নেই। বন্ধুকে সুপারিশ করব।',
  ],
  [
    'The colour in the listing photo is much brighter than what arrived. Sending it back.',
    'লিস্টিং ছবির রং এসেছে তার চেয়ে অনেক উজ্জ্বল। ফেরত দিচ্ছি।',
  ],
];

async function main() {
  const args = process.argv.slice(2);
  const clean = args.includes('--clean');
  const productArg = args.find((a) => a.startsWith('--product='))?.split('=')[1];
  const count = Number(args.find((a) => /^\d+$/.test(a)) ?? 12);

  if (clean) {
    const removed = await prisma.review.deleteMany({
      where: { user: { email: { endsWith: FIXTURE_DOMAIN } } },
    });
    const users = await prisma.user.deleteMany({
      where: { email: { endsWith: FIXTURE_DOMAIN } },
    });
    console.log(`removed ${removed.count} fixture reviews and ${users.count} fixture users`);
    return;
  }

  const product = productArg
    ? await prisma.product.findUnique({ where: { id: productArg }, select: { id: true, nameEn: true, sku: true } })
    : await prisma.product.findFirst({
        where: { isPublished: true, isDraft: false },
        select: { id: true, nameEn: true, sku: true },
        orderBy: { sku: 'asc' },
      });

  if (!product) throw new Error('no product found — seed the database first');

  /**
   * One hash for every fixture reviewer. The password is never used to sign in
   * as a reviewer (they are not staff), so bcrypt cost 4 keeps the script fast
   * while still storing something that is not a plaintext placeholder.
   */
  const passwordHash = await bcrypt.hash('Fixture@12345', 4);

  let created = 0;
  for (let i = 0; i < count; i += 1) {
    const email = `reviewer${i + 1}${FIXTURE_DOMAIN}`;

    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        name: `Fixture Reviewer ${i + 1}`,
        role: 'CUSTOMER',
        passwordHash,
        isActive: true,
        emailVerified: true,
      },
      select: { id: true },
    });

    const rating = (i % 5) + 1;
    const [titleEn, titleBn] = TITLES[i % TITLES.length];
    const [contentEn, contentBn] = BODIES[i % BODIES.length];

    /**
     * The spread is deliberate and is what makes the screen verifiable:
     *
     *   every 4th   -> approved  (so the Approved tab is not empty)
     *   every 5th   -> flagged   (so the Flagged tab is not empty)
     *   every 6th   -> rejected  (moderatedAt set, isApproved false)
     *   the rest    -> pending   (moderatedAt null, isApproved false)
     *
     * Rejected and pending differ only by `moderatedAt` — that is the whole
     * point of the column, and this fixture is the only place both states exist
     * side by side before real moderation traffic does.
     */
    const approved = i % 4 === 0;
    const flagged = i % 5 === 0;
    const rejected = !approved && i % 6 === 0;

    await prisma.review.upsert({
      where: { productId_userId: { productId: product.id, userId: user.id } },
      update: {},
      create: {
        productId: product.id,
        userId: user.id,
        rating,
        titleEn,
        titleBn,
        contentEn,
        contentBn,
        isVerifiedPurchase: i % 3 === 0,
        isApproved: approved,
        isFlagged: flagged,
        moderatedAt: approved || rejected ? new Date(Date.now() - i * 3600_000) : null,
        helpfulCount: i % 7,
      },
    });

    created += 1;
  }

  const grouped = await prisma.review.groupBy({
    by: ['isApproved', 'isFlagged', 'moderatedAt'],
    where: { productId: product.id },
    _count: { _all: true },
  });

  const tally = { pending: 0, approved: 0, rejected: 0, flagged: 0 };
  for (const row of grouped) {
    const n = row._count._all;
    if (row.isFlagged) tally.flagged += n;
    else if (row.isApproved) tally.approved += n;
    else if (row.moderatedAt) tally.rejected += n;
    else tally.pending += n;
  }

  console.log(`product : ${product.sku} — ${product.nameEn}`);
  console.log(`product : ${product.id}`);
  console.log(`created : ${created} reviews from ${count} fixture reviewers`);
  console.log(`states  : ${JSON.stringify(tally)}`);
  console.log('');
  console.log('open    : http://localhost:3000/admin/reviews');
}

main()
  .catch((error) => {
    console.error('fixture failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
