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
