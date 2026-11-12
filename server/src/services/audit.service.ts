/**
 * The audit log writer — security.md §12 and §14.
 *
 * §14 is blunt about the contract: "Every mutation writes to the audit log in
 * the same transaction as the change. A mutation that succeeds without an audit
 * row is a bug."
 *
 * That sentence drives the whole shape of this file. `audit()` takes a
 * transaction client as its first argument, not the global `prisma`. If it used
 * the global client, the audit row would be written on a different connection
 * from the change, and a rollback would leave an audit row describing something
 * that never happened — or a committed change with no row at all. Neither is
 * recoverable after the fact, which is the entire point of an audit trail.
 *
 * The correct call site is therefore always:
 *
 *     await prisma.$transaction(async (tx) => {
 *       const product = await tx.product.update({ ... });
 *       await audit(tx, { ... });          // same tx — commits or rolls back together
 *       return product;
 *     });
 *
 * `withAudit()` below packages that pattern so a route cannot get it wrong by
 * accident: it opens the transaction, runs the work, and writes the row before
 * committing. Prefer it over hand-rolling `$transaction` in a route.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../config/database.js';
import { logger } from '../middleware/requestLogger.js';

/**
 * Anything that can write an AuditLog: the global client or a transaction
 * client. Both expose `auditLog.create`, which is all this file needs.
 */
export type AuditClient = Prisma.TransactionClient | PrismaClient;

/** What a caller must supply. `ipAddress` is filled from the request. */
export interface AuditEntry {
  /** The acting user. Null only for a system action with no human behind it. */
  userId: string | null;
  /**
   * Dotted verb, past tense, stable enough to grep: `product.update`,
   * `order.status_change`, `inventory.adjust`. Not a sentence — the `changes`
   * payload carries the detail.
   */
  action: string;
  /** The model touched, lower-case: `product`, `order`, `category`. */
  entity: string;
  /** The primary key of the row. */
  entityId: string;
  /**
   * What changed. For an update, the before/after pair — not the whole row.
   * A full row snapshot turns the audit table into a second copy of the
   * database and makes a diff unreadable.
   */
  changes?: Prisma.InputJsonValue;
  /** Client IP from `req.ip`. Never a forwarded header read by hand. */
  ipAddress?: string | null;
}

/**
 * Writes one audit row. Must be called with the transaction client that is
 * performing the change.
 *
 * Deliberately NOT wrapped in try/catch. A failure here must fail the mutation:
 * an audit row that silently does not get written is exactly the bug §14 calls
 * out, and swallowing the error would hide it. If the audit insert fails, the
 * change rolls back with it, which is the correct outcome.
 */
export async function audit(client: AuditClient, entry: AuditEntry): Promise<void> {
  await client.auditLog.create({
    data: {
      userId: entry.userId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      changes: entry.changes,
      ipAddress: entry.ipAddress ?? null,
    },
  });
}

/**
 * Runs `work` and its audit row in one transaction.
 *
 * The callback receives the transaction client and must do every write through
 * it — a write on the global `prisma` inside this callback would commit
 * independently of the audit row, which is the failure mode this exists to
 * prevent.
 *
 * `entry` may be a function of the work's return value, for the common case
 * where the entity id is only known after the insert (a create).
 */
export async function withAudit<T>(
  entry: AuditEntry | ((result: T) => AuditEntry),
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const result = await work(tx);
    const resolved = typeof entry === 'function' ? entry(result) : entry;
    await audit(tx, resolved);
    return result;
  });
}

/**
 * Builds the before/after payload for an update.
 *
 * Only the keys that actually changed are kept. A row where `changes` lists
 * fifteen fields and one of them differs is a row nobody reads.
 */
export function diffChanges<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  for (const key of Object.keys(after)) {
    const from = before[key];
    const to = after[key];
    // Loose comparison on purpose: a Decimal and a number, or a Date and an ISO
    // string, are the same change to a human reading the log.
    if (String(from) !== String(to)) {
      changes[key] = { from, to };
    }
  }

  return changes;
}

/**
 * Logs an admin mutation that could not be audited.
 *
 * There is exactly one legitimate case: a read-only admin action that the
 * caller mistakenly routed through this path. Anything else reaching here means
 * an audit write failed, and §14 says that is a bug — so it is logged at `error`
 * with enough context to find the mutation.
 */
export function reportUnauditedMutation(action: string, entity: string, entityId: string): void {
  logger.error({ action, entity, entityId }, 'admin mutation committed without an audit row');
}
