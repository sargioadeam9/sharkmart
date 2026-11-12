/**
 * Test staff accounts — LOCAL VERIFICATION ONLY.
 *
 * Phase 9 needs a SUPER_ADMIN, an INVENTORY_STAFF and a CUSTOMER to prove the
 * three gates (302 / 403 / 200). The seed creates no users at all, by design
 * ("reviews: 0 — real reviews only" and no demo accounts), so this script
 * creates them on demand.
 *
 * It is NOT part of `db:seed` and must never run against production: the
 * password is a known constant. Run it manually:
 *
 *     npx tsx prisma/seed-test-users.ts
 *
 * Idempotent — upsert on email, so re-running resets the password and role
 * rather than failing on the unique constraint.
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const PASSWORD = 'Admin@12345';

const USERS = [
  { email: 'super@sharkmart.test', name: 'Rahim Hossain', role: 'SUPER_ADMIN' as const },
  { email: 'inventory@sharkmart.test', name: 'Inventory Staff', role: 'INVENTORY_STAFF' as const },
  { email: 'customer@sharkmart.test', name: 'Test Customer', role: 'CUSTOMER' as const },
];

async function main(): Promise<void> {
  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  for (const user of USERS) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: { role: user.role, passwordHash, isActive: true },
      create: {
        email: user.email,
        name: user.name,
        role: user.role,
        passwordHash,
        isActive: true,
        emailVerified: true,
      },
    });
    console.log(`  ${user.role.padEnd(16)} ${user.email}`);
  }

  console.log(`\nPassword for all three: ${PASSWORD}`);
  console.log('Local verification only — never run this against production.');
}

main()
  .catch((error: unknown) => {
    console.error('Failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
