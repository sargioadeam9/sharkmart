/**
 * `/api/v1/admin/marketing` — Phase 10 pass H (SMS and email).
 *
 * ── What this module does, and what it refuses to pretend ──────────────────
 *
 * It owns the templates, the composer and the **queue**. A send does not deliver
 * anything inline: it writes one `Notification` row per recipient with status
 * PENDING, and `tools/dispatch-notifications.mjs` drains them. That split is what
 * makes "1,000 recipients" a database insert rather than a 1,000-request loop
 * inside an HTTP handler.
 *
 * There is no SMTP client in this project and no gateway contract to code against,
 * so the dispatcher **dry-runs by default**: it marks rows SENT with `sentAt` and
 * a note saying nothing left the building. A real SMS gateway is used only when
 * `SMS_GATEWAY_URL` is set, and it posts `{ to, message }` — the shape must match
 * whatever provider is chosen. Email is deliberately not implemented: adding a
 * mail dependency is a decision, not a detail, and a dispatcher that silently
 * marks mail as sent would be worse than one that says it cannot.
 *
 * ── Segments ───────────────────────────────────────────────────────────────
 *
 * The recipient query mirrors the CRM segments. It is a separate query rather
 * than a call into `customers.ts` because the projection is different — a campaign
 * needs `phone` and `email` for every row, not page-sized rows with aggregates.
 * Both use the same `HAVING` definitions, and the CRM screen is the place those are
 * explained.
 */

import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { ok } from '../../types/api.js';
import { prisma } from '../../config/database.js';
import { HttpError, notFound } from '../../middleware/errorHandler.js';
import { withAudit } from '../../services/audit.service.js';

export const marketingRouter: Router = Router();

function actorFrom(req: { session?: { id: string }; ip?: string }) {
  return { userId: req.session!.id, ipAddress: req.ip ?? null };
}

const segmentEnum = z.enum(['all', 'new', 'returning', 'high_value', 'inactive']);

const templateParams = z.object({ id: z.string().uuid() }).strict();

const smsTemplateBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    templateEn: z.string().trim().min(1).max(1000),
    templateBn: z.string().trim().min(1).max(1000),
    type: z.enum(['TRANSACTIONAL', 'PROMOTIONAL']).default('PROMOTIONAL'),
  })
  .strict();

const emailTemplateBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    subjectEn: z.string().trim().min(1).max(200),
    subjectBn: z.string().trim().min(1).max(200),
    bodyEn: z.string().trim().min(1).max(20000),
    bodyBn: z.string().trim().min(1).max(20000),
    type: z.enum(['TRANSACTIONAL', 'PROMOTIONAL']).default('PROMOTIONAL'),
  })
  .strict();

const composeBody = z
  .object({
    channel: z.enum(['SMS', 'EMAIL']),
    templateId: z.string().uuid(),
    segment: segmentEnum.default('all'),
    language: z.enum(['bn', 'en']).default('bn'),
    /** Preview only — no rows are written. */
    preview: z.boolean().default(false),
  })
  .strict();

const reportQuery = z
  .object({
    channel: z.enum(['SMS', 'EMAIL']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

/** `{name}` and `{shop}` are the only placeholders; anything else is left alone. */
function render(template: string, values: { name: string; shop: string }): string {
  return template.replace(/\{(name|shop)\}/g, (_match, key: 'name' | 'shop') => values[key]);
}

/** The `HAVING` clause for a segment — same definitions as the CRM screen. */
function segmentHaving(segment: string): Prisma.Sql {
  switch (segment) {
    case 'new':
      return Prisma.sql`MAX(u.createdAt) >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 DAY)`;
    case 'returning':
      return Prisma.sql`COUNT(o.id) >= 2`;
    case 'high_value':
      return Prisma.sql`COALESCE(SUM(o.totalAmountPoisha), 0) >= ${1_000_000}`;
    case 'inactive':
      return Prisma.sql`(
        (MAX(o.createdAt) IS NULL AND MAX(u.createdAt) < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 90 DAY))
        OR MAX(o.createdAt) < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 90 DAY)
      )`;
    default:
      return Prisma.sql`1 = 1`;
  }
}

interface RecipientRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
}

/** Every reachable recipient in a segment, with the contact detail the channel needs. */
async function recipientsFor(segment: string, channel: 'SMS' | 'EMAIL'): Promise<RecipientRow[]> {
  const contact = channel === 'SMS' ? Prisma.sql`u.phone IS NOT NULL` : Prisma.sql`u.email IS NOT NULL`;

  return prisma.$queryRaw<RecipientRow[]>`
    SELECT u.id, u.name, u.phone, u.email
    FROM \`User\` u
    LEFT JOIN \`Order\` o
      ON o.userId = u.id AND o.currentStatus NOT IN ('CANCELLED', 'RETURNED')
    WHERE u.role = 'CUSTOMER' AND u.isActive = true AND ${contact}
    GROUP BY u.id
    HAVING ${segmentHaving(segment)}
    ORDER BY u.id ASC
  `;
}

// ─── Templates ─────────────────────────────────────────────────────────────

marketingRouter.get('/templates', requirePermission('marketing:read'), async (_req, res, next) => {
  try {
    const [sms, email] = await Promise.all([
      prisma.sMSTemplate.findMany({ orderBy: { name: 'asc' } }),
      prisma.emailTemplate.findMany({ orderBy: { name: 'asc' } }),
    ]);

    res.json(
      ok({
        sms: sms.map((row) => ({
          id: row.id,
          name: row.name,
          templateEn: row.templateEn,
          templateBn: row.templateBn,
          type: row.type,
        })),
        email: email.map((row) => ({
          id: row.id,
          name: row.name,
          subjectEn: row.subjectEn,
          subjectBn: row.subjectBn,
          bodyEn: row.bodyEn,
          bodyBn: row.bodyBn,
          type: row.type,
        })),
      }),
    );
  } catch (error) {
    next(error);
  }
});

marketingRouter.post(
  '/templates/sms',
  requirePermission('marketing:write'),
  validate({ body: smsTemplateBody }),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof smsTemplateBody>;
      const actor = actorFrom(req);

      const created = await withAudit(
        (row: { id: string }) => ({
          userId: actor.userId,
          action: 'template.sms.create',
          entity: 'smsTemplate',
          entityId: row.id,
          changes: { name: body.name, type: body.type },
          ipAddress: actor.ipAddress,
        }),
        async (tx) => tx.sMSTemplate.create({ data: body, select: { id: true } }),
      );

      res.status(201).json(ok(created));
    } catch (error) {
      next(error);
    }
  },
);

marketingRouter.patch(
  '/templates/sms/:id',
  requirePermission('marketing:write'),
  validate({ params: templateParams, body: smsTemplateBody.partial() }),
  async (req, res, next) => {
    try {
      const id = req.params.id!;
      const body = req.body as Partial<z.infer<typeof smsTemplateBody>>;
      const actor = actorFrom(req);

      const exists = await prisma.sMSTemplate.findUnique({ where: { id }, select: { id: true } });
      if (!exists) throw notFound('Template');

      await withAudit(
        {
          userId: actor.userId,
          action: 'template.sms.update',
          entity: 'smsTemplate',
          entityId: id,
          changes: body,
          ipAddress: actor.ipAddress,
        },
        async (tx) => {
          await tx.sMSTemplate.update({ where: { id }, data: body });
        },
      );

      res.json(ok({ updated: true }));
    } catch (error) {
      next(error);
    }
  },
);

marketingRouter.delete(
  '/templates/sms/:id',
  requirePermission('marketing:write'),
  validate({ params: templateParams }),
  async (req, res, next) => {
    try {
      const id = req.params.id!;
      const actor = actorFrom(req);

      const exists = await prisma.sMSTemplate.findUnique({ where: { id }, select: { id: true } });
      if (!exists) throw notFound('Template');

      await withAudit(
        {
          userId: actor.userId,
          action: 'template.sms.delete',
          entity: 'smsTemplate',
          entityId: id,
          changes: {},
          ipAddress: actor.ipAddress,
        },
        async (tx) => {
          await tx.sMSTemplate.delete({ where: { id } });
        },
      );

      res.json(ok({ deleted: true }));
    } catch (error) {
      next(error);
    }
  },
);

marketingRouter.post(
  '/templates/email',
  requirePermission('marketing:write'),
  validate({ body: emailTemplateBody }),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof emailTemplateBody>;
      const actor = actorFrom(req);

      const created = await withAudit(
        (row: { id: string }) => ({
          userId: actor.userId,
          action: 'template.email.create',
          entity: 'emailTemplate',
          entityId: row.id,
          changes: { name: body.name, type: body.type },
          ipAddress: actor.ipAddress,
        }),
        async (tx) => tx.emailTemplate.create({ data: body, select: { id: true } }),
      );

      res.status(201).json(ok(created));
    } catch (error) {
      next(error);
    }
  },
);

marketingRouter.patch(
  '/templates/email/:id',
  requirePermission('marketing:write'),
  validate({ params: templateParams, body: emailTemplateBody.partial() }),
  async (req, res, next) => {
    try {
      const id = req.params.id!;
      const body = req.body as Partial<z.infer<typeof emailTemplateBody>>;
      const actor = actorFrom(req);

      const exists = await prisma.emailTemplate.findUnique({ where: { id }, select: { id: true } });
      if (!exists) throw notFound('Template');

      await withAudit(
        {
          userId: actor.userId,
          action: 'template.email.update',
          entity: 'emailTemplate',
          entityId: id,
          changes: body,
          ipAddress: actor.ipAddress,
        },
        async (tx) => {
          await tx.emailTemplate.update({ where: { id }, data: body });
        },
      );

      res.json(ok({ updated: true }));
    } catch (error) {
      next(error);
    }
  },
);

marketingRouter.delete(
  '/templates/email/:id',
  requirePermission('marketing:write'),
  validate({ params: templateParams }),
  async (req, res, next) => {
    try {
      const id = req.params.id!;
      const actor = actorFrom(req);

      const exists = await prisma.emailTemplate.findUnique({ where: { id }, select: { id: true } });
      if (!exists) throw notFound('Template');

      await withAudit(
        {
          userId: actor.userId,
          action: 'template.email.delete',
          entity: 'emailTemplate',
          entityId: id,
          changes: {},
          ipAddress: actor.ipAddress,
        },
        async (tx) => {
          await tx.emailTemplate.delete({ where: { id } });
        },
      );

      res.json(ok({ deleted: true }));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Compose ───────────────────────────────────────────────────────────────

/**
 * Preview or enqueue.
 *
 * `preview: true` returns the recipient count and one rendered sample and writes
 * nothing — the operator should see what the message looks like before 2,000
 * people do. `preview: false` writes one PENDING Notification per recipient, in
 * batches, and returns the count. Nothing is delivered here.
 */
marketingRouter.post(
  '/compose',
  requirePermission('marketing:write'),
  validate({ body: composeBody }),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof composeBody>;

      const shop = await prisma.setting.findUnique({ where: { key: 'site.name' }, select: { value: true } });
      const shopName = shop?.value ?? 'SharkMart';

      const template =
        body.channel === 'SMS'
          ? await prisma.sMSTemplate.findUnique({ where: { id: body.templateId } })
          : await prisma.emailTemplate.findUnique({ where: { id: body.templateId } });

      if (!template) throw notFound('Template');

      const recipients = await recipientsFor(body.segment, body.channel);

      const textFor = (name: string) =>
        body.channel === 'SMS'
          ? render(
              body.language === 'bn'
                ? (template as { templateBn: string }).templateBn
                : (template as { templateEn: string }).templateEn,
              { name, shop: shopName },
            )
          : render(
              body.language === 'bn'
                ? (template as { bodyBn: string }).bodyBn
                : (template as { bodyEn: string }).bodyEn,
              { name, shop: shopName },
            );

      const subjectFor = () =>
        body.channel === 'EMAIL'
          ? render(
              body.language === 'bn'
                ? (template as { subjectBn: string }).subjectBn
                : (template as { subjectEn: string }).subjectEn,
              { name: shopName, shop: shopName },
            )
          : null;

      if (body.preview) {
        res.json(
          ok({
            recipients: recipients.length,
            sample: {
              to: body.channel === 'SMS' ? (recipients[0]?.phone ?? null) : (recipients[0]?.email ?? null),
              name: recipients[0]?.name ?? null,
              subject: subjectFor(),
              body: recipients[0] ? textFor(recipients[0].name) : '',
            },
          }),
        );
        return;
      }

      if (recipients.length === 0) {
        throw new HttpError(422, 'VALIDATION_ERROR', 'That segment has no reachable recipients.', {
          field: 'segment',
        });
      }

      const actor = actorFrom(req);
      const subject = subjectFor();
      const batch = 500;

      const created = await withAudit(
        {
          userId: actor.userId,
          action: 'campaign.send',
          entity: 'campaign',
          entityId: body.templateId,
          changes: {
            channel: body.channel,
            segment: body.segment,
            language: body.language,
            recipients: recipients.length,
          },
          ipAddress: actor.ipAddress,
        },
        async (tx) => {
          let written = 0;

          for (let index = 0; index < recipients.length; index += batch) {
            const slice = recipients.slice(index, index + batch);
            await tx.notification.createMany({
              data: slice.map((recipient) => ({
                type: body.channel === 'SMS' ? 'campaign_sms' : 'campaign_email',
                recipientId: recipient.id,
                channel: body.channel,
                subject,
                body: textFor(recipient.name),
                status: 'PENDING',
              })),
            });
            written += slice.length;
          }

          return written;
        },
      );

      res.status(201).json(
        ok({
          queued: created,
          note:
            'Queued, not sent. Run tools/dispatch-notifications.mjs to drain the queue.',
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

// ─── Delivery report ───────────────────────────────────────────────────────

marketingRouter.get(
  '/report',
  requirePermission('marketing:read'),
  validate({ query: reportQuery }),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as z.infer<typeof reportQuery>;
      const where: Prisma.NotificationWhereInput = {
        type: { in: ['campaign_sms', 'campaign_email'] },
        ...(query.channel ? { channel: query.channel } : {}),
      };

      const [grouped, recent] = await Promise.all([
        prisma.notification.groupBy({
          by: ['channel', 'status'],
          where,
          _count: { _all: true },
        }),
        prisma.notification.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: query.limit,
          select: {
            id: true,
            channel: true,
            subject: true,
            status: true,
            createdAt: true,
            sentAt: true,
            recipient: { select: { name: true } },
          },
        }),
      ]);

      const counts: Record<string, number> = {};
      for (const row of grouped) {
        counts[`${row.channel}_${row.status}`] = row._count._all;
      }

      res.json(
        ok({
          counts,
          recent: recent.map((row) => ({
            id: row.id,
            channel: row.channel,
            subject: row.subject,
            status: row.status,
            recipientName: row.recipient?.name ?? null,
            createdAt: row.createdAt.toISOString(),
            sentAt: row.sentAt?.toISOString() ?? null,
          })),
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);
