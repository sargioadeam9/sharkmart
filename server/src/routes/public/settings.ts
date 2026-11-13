/**
 * `GET /api/v1/settings/public` — the storefront's copy of the store's identity
 * and delivery rules.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * The storefront used to hardcode the shop name and the delivery fee in three
 * places (`src/lib/brand.ts`, `src/lib/commerce.ts`, the footer). Once those
 * values became editable in the admin panel, that stopped being harmless: an
 * operator raising the flat fee to ৳77 made checkout charge ৳77 while the cart
 * drawer still showed ৳60. A customer-facing money mismatch is the one thing a
 * settings module must not introduce.
 *
 * This endpoint is the single read the storefront makes. It is public because a
 * header must render for a guest, and it carries only display values — no fees
 * that are not already printed on the page, no secrets, no settings keys.
 *
 * It is cached for five minutes at the HTTP layer on top of the server-side
 * cache in `settings.service.ts`, so a page render does not hit the database.
 */

import { Router } from 'express';
import { ok } from '../../types/api.js';
import { getDeliveryFees, getStoreProfile } from '../../services/settings.service.js';

export const settingsPublicRouter: Router = Router();

settingsPublicRouter.get('/', async (_req, res, next) => {
  try {
    const [profile, fees] = await Promise.all([getStoreProfile(), getDeliveryFees()]);

    // Public, short-lived. The value changes only when an admin saves, and the
    // write path invalidates the server cache, so five minutes is a ceiling on
    // staleness rather than a target.
    res.set('Cache-Control', 'public, max-age=300');

    res.json(
      ok({
        ...profile,
        delivery: {
          feePoisha: fees.standardFeePoisha,
          freeThresholdPoisha: fees.freeThresholdPoisha,
          expressSurchargePoisha: fees.expressSurchargePoisha,
        },
      }),
    );
  } catch (error) {
    next(error);
  }
});
