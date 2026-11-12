/**
 * `/api/v1/cart/*` — the signed-in cart.
 *
 * A guest cart lives in localStorage and is merged here at login. Every route
 * below requires a session; the guest path is `POST /cart/sync` after auth.
 */

import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { csrfProtection } from '../../middleware/session.js';
import { LIMITS, slidingWindowLimit } from '../../middleware/rateLimiter.js';
import { ok } from '../../types/api.js';
import {
  addItem,
  getCart,
  removeItem,
  syncCart,
  updateItem,
} from '../../services/cart.service.js';
import {
  cartItemBody,
  cartQuantityBody,
  cartSyncBody,
  idParams,
} from '../../validators/auth.schema.js';

export const cartRouter: Router = Router();

cartRouter.use(requireAuth);

/** Cart writes are limited per user, not per IP — one household shares an IP. */
const cartWriteLimit = slidingWindowLimit(LIMITS.cart, (req) => `user:${req.session?.id ?? 'anon'}`);

/** GET /cart */
cartRouter.get('/', async (req, res, next) => {
  try {
    res.json(ok(await getCart(req.session!.id)));
  } catch (error) {
    next(error);
  }
});

/**
 * POST /cart/sync
 *
 * Merges a guest cart. Not rate limited as tightly as a write — a login can
 * legitimately send one large batch.
 */
cartRouter.post('/sync', csrfProtection, validate({ body: cartSyncBody }), async (req, res, next) => {
  try {
    const { items } = req.body as {
      items: Array<{ productId: string; variantId?: string | null; quantity: number }>;
    };
    const result = await syncCart(req.session!.id, items);
    res.json(ok(result));
  } catch (error) {
    next(error);
  }
});

/** POST /cart/items */
cartRouter.post('/items', cartWriteLimit, csrfProtection, validate({ body: cartItemBody }), async (req, res, next) => {
  try {
    const body = req.body as {
      productId: string;
      variantId?: string | null;
      quantity: number;
    };
    const cart = await addItem(req.session!.id, body);
    res.status(201).json(ok(cart));
  } catch (error) {
    next(error);
  }
});

/** PUT /cart/items/:id — quantity 0 removes the line. */
cartRouter.put(
  '/items/:id',
  cartWriteLimit,
  csrfProtection,
  validate({ params: idParams, body: cartQuantityBody }),
  async (req, res, next) => {
    try {
      const { id } = req.params as { id: string };
      const { quantity } = req.body as { quantity: number };
      res.json(ok(await updateItem(req.session!.id, id, quantity)));
    } catch (error) {
      next(error);
    }
  },
);

/** DELETE /cart/items/:id */
cartRouter.delete('/items/:id', cartWriteLimit, csrfProtection, validate({ params: idParams }), async (req, res, next) => {
  try {
    const { id } = req.params as { id: string };
    res.json(ok(await removeItem(req.session!.id, id)));
  } catch (error) {
    next(error);
  }
});
