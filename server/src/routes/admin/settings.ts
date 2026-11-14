/**
 * `/api/v1/admin/settings` — Phase 10 pass B.
 *
 * Three endpoints, and the split matters:
 *
 *   GET  /          the full registry, grouped, with current values
 *   PATCH /         a validated bulk write, one audit row, cache invalidated
 *   GET  /profile   the display-safe subset the admin shell needs
 *
 * `/profile` exists so the admin layout can render the store's own name without
 * fetching the whole settings payload (which includes fees it has no use for) and
 * without a second endpoint that returns the same rows in a different shape.
 *
 * Permission is `settings:read` / `settings:write`, which only ADMIN and
 * SUPER_ADMIN hold — `ORDER_MANAGER` does not, which is why the nav hides this
 * entry from them and the API would reject them anyway.
 */

import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { ok } from '../../types/api.js';
import {
  getStoreProfile,
  settingsForAdmin,
  updateSettings,
  type Actor,
} from '../../services/settings.service.js';
import {
  adminEmail,
  formatTaka,
  itemsTable,
  renderEmail,
  sendEmail,
  sendTelegram,
} from '../../services/notify/index.js';

export const settingsRouter: Router = Router();

/**
 * A bulk patch. Values are strings on the wire because that is what the column
 * stores and what an `<input>` produces; the service validates each one against
 * its registered type.
 *
 * `.strict()` on the object, but the record inside is deliberately open — the
 * service rejects unknown keys with a per-key message, which is more useful than
 * a generic "unrecognized key" from zod.
 */
const settingsPatchBody = z
  .object({
    values: z.record(z.string().max(64), z.string().max(500)),
  })
  .strict()
  .refine((value) => Object.keys(value.values).length > 0, {
    message: 'at least one setting must be provided',
  });

function actorFrom(req: { session?: { id: string }; ip?: string }): Actor {
  return { userId: req.session!.id, ipAddress: req.ip ?? null };
}

settingsRouter.get('/', requirePermission('settings:read'), async (_req, res, next) => {
  try {
    res.json(ok({ groups: await settingsForAdmin() }));
  } catch (error) {
    next(error);
  }
});

settingsRouter.get('/profile', requirePermission('settings:read'), async (_req, res, next) => {
  try {
    res.json(ok(await getStoreProfile()));
  } catch (error) {
    next(error);
  }
});

settingsRouter.patch(
  '/',
  requirePermission('settings:write'),
  validate({ body: settingsPatchBody }),
  async (req, res, next) => {
    try {
      const body = req.body as { values: Record<string, string> };
      const groups = await updateSettings(body.values, actorFrom(req));
      res.json(ok({ groups }));
    } catch (error) {
      next(error);
    }
  },
);

// ─── Notification tests (Phase 12) ─────────────────────────────────────────
//
// The keys live in `.env`, which means an operator cannot see whether they
// worked by looking at the panel. These two endpoints are the answer: press the
// button, get a real send, and read the provider's own error if it fails.
//
// `settings:write`, because a test send costs money and reaches a real inbox.

const testEmailBody = z
  .object({
    /** Defaults to the admin alert address. */
    to: z.string().trim().email().max(254).optional(),
  })
  .strict();

settingsRouter.post(
  '/test-email',
  requirePermission('settings:write'),
  validate({ body: testEmailBody }),
  async (req, res, next) => {
    try {
      const body = req.body as { to?: string };
      const recipient = body.to?.trim() || (await adminEmail());

      if (!recipient) {
        res.status(422).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message:
              'No address to send to. Set the admin alert address above, or pass one in the request.',
          },
        });
        return;
      }

      const rendered = await renderEmail('admin_new_order', 'en', {
        orderNumber: 'TEST-0001',
        total: formatTaka(150_000),
        paymentMethod: 'COD',
        customerName: 'Test customer',
        customerPhone: '01700000000',
        address: 'Dhaka',
        itemsTable: itemsTable([{ name: 'Test item', quantity: 1, lineTotal: formatTaka(150_000) }]),
      });

      const result = await sendEmail({
        to: recipient,
        subject: `Test — ${rendered.subject}`,
        html: rendered.html,
        text: rendered.text,
      });

      if (!result.ok) {
        /**
         * 502, not 500: the shop's own code is fine, the upstream provider is
         * what refused. The reason is passed through verbatim because "domain is
         * not verified" is the sentence that fixes the problem.
         */
        res.status(502).json({
          success: false,
          error: { code: 'UPSTREAM_ERROR', message: result.reason ?? 'Send failed.' },
        });
        return;
      }

      res.json(ok({ sent: true, to: recipient, id: result.id ?? null }));
    } catch (error) {
      next(error);
    }
  },
);

settingsRouter.post(
  '/test-telegram',
  requirePermission('settings:write'),
  async (_req, res, next) => {
    try {
      const result = await sendTelegram(
        '✅ <b>SharkMart</b> test alert — Telegram is connected.',
      );

      if (!result.ok) {
        res.status(502).json({
          success: false,
          error: { code: 'UPSTREAM_ERROR', message: result.reason ?? 'Send failed.' },
        });
        return;
      }

      res.json(ok({ sent: true }));
    } catch (error) {
      next(error);
    }
  },
);
