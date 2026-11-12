import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const total = await prisma.auditLog.count();
  console.log('AuditLog total rows:', total);
  const rows = await prisma.auditLog.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' },
  });
  for (const r of rows) {
    console.log(
      JSON.stringify({
        userId: r.userId,
        action: r.action,
        entity: r.entity,
        entityId: r.entityId,
        ipAddress: r.ipAddress,
        createdAt: r.createdAt,
      }),
    );
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
