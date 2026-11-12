/**
 * `GET /api/v1/admin/dashboard` — the whole dashboard in one round trip.
 *
 * One endpoint rather than eight, because the dashboard is one screen: eight
 * parallel calls from the browser would each pay the rate-limit and auth cost,
 * and a partial failure would render a half-populated dashboard with no clear
 * signal about which panel was stale. Server-side, the eight queries run in
 * parallel against the database and either all resolve or the request fails
 * honestly.
 *
 * The range comes from the query string: `?range=today|7d|30d|custom` with
 * `from`/`to` for a custom range. Anything unrecognised falls back to 7d rather
 * than erroring — a dashboard that 422s because a segmented control sent an
 * unexpected value is worse than one that shows the default.
 */

import { Router } from 'express';
import { requirePermission } from '../../middleware/auth.js';
import { ok } from '../../types/api.js';
import { dashboardPayload, resolveRange } from './dashboard.service.js';

export const dashboardRouter: Router = Router();

dashboardRouter.get('/', requirePermission('dashboard:read'), async (req, res, next) => {
  try {
    const preset = typeof req.query.range === 'string' ? req.query.range : '7d';
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;

    const range = resolveRange(preset, from, to);
    const payload = await dashboardPayload(range);

    res.json(ok(payload));
  } catch (error) {
    next(error);
  }
});
