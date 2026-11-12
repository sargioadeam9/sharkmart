/**
 * `/api/v1/checkout` — the money path.
 *
 * Two things live here that are not in the service:
 *
 *   1. **Idempotency.** A double-submit with the same `Idempotency-Key` must
 *      return the same order, not create a second one. The unique index on
 *      `(scope, key)` is the enforcement; this route reads the stored response
 *      and replays it.
 *   2. **Guest vs signed-in.** A guest may check out (Bangladesh is COD-heavy
 *      and forcing an account loses sales), but a guest cannot use a saved
 *      address or a per-user-limited coupon.
 */

import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { validate } from '../../middleware/validate.js';
import { optionalAuth } from '../../middleware/auth.js';
import { csrfProtection } from '../../middleware/session.js';
import { LIMITS, slidingWindowLimit } from '../../middleware/rateLimiter.js';
import { ok } from '../../types/api.js';
import { HttpError } from '../../middleware/errorHandler.js';
import { prisma } from '../../config/database.js';
import { placeOrder, verifyPayment } from '../../services/order.service.js';
import { checkoutBody, verifyPaymentBody } from '../../validators/auth.schema.js';

export const checkoutRouter: Router = Router();

/** Checkout is limited per user when signed in, per IP for a guest. */
const checkoutLimit = slidingWindowLimit(LIMITS.checkout, (req) =>
  req.session ? `user:${req.session.id}` : `ip:${req.ip ?? 'unknown'}`,
);

/**
 * POST /checkout
 *
 * Idempotency protocol:
 *   - No header → the request is processed normally. A double-submit creates
 *     two orders, which is why the client is expected to send the header.
 *   - Header, first time → a PROCESSING row is claimed, the order is placed,
 *     the response is stored, the row becomes COMPLETED.
 *   - Header, replay → the stored response is returned verbatim.
 *   - Header, concurrent second request → the row is PROCESSING, so the second
 *     request gets a 409 telling it to retry, rather than racing into a
 *     duplicate order.
 */
checkoutRouter.post(
  '/',
  optionalAuth,
  checkoutLimit,
  csrfProtection,
  validate({ body: checkoutBody }),
  async (req, res, next) => {
    try {
      const body = req.body as Parameters<typeof placeOrder>[1];
      const userId = req.session?.id ?? null;

      const rawKey = req.headers['idempotency-key'];
      const idempotencyKey = Array.isArray(rawKey) ? rawKey[0] : rawKey;

      // ── No idempotency key: straight through ──────────────────────────
      if (!idempotencyKey) {
        const order = await placeOrder(userId, body, { ipAddress: req.ip });
        res.status(201).json(ok(order));
        return;
      }

      if (idempotencyKey.length > 200) {
        throw new HttpError(422, 'VALIDATION_ERROR', 'Idempotency-Key is too long.');
      }

      // ── Claim the key ─────────────────────────────────────────────────
      let claim;
      try {
        claim = await prisma.idempotencyKey.create({
          data: {
            userId,
            key: idempotencyKey,
            scope: 'checkout',
            status: 'PROCESSING',
          },
        });
      } catch (error) {
        // Unique violation → this key has been seen before.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const existing = await prisma.idempotencyKey.findUnique({
            where: { scope_key: { scope: 'checkout', key: idempotencyKey } },
          });

          if (!existing) {
            throw new HttpError(500, 'INTERNAL_ERROR', 'Could not resolve the idempotency key.');
          }

          /**
           * A key belongs to the user who claimed it. A different user
           * presenting the same key must not read someone else's order, so it
           * is treated as a fresh conflict rather than a replay.
           */
          if (existing.userId !== userId) {
            throw new HttpError(409, 'CONFLICT', 'This idempotency key is already in use.');
          }

          if (existing.status === 'COMPLETED' && existing.responseJson) {
            // The replay. Same body, same status — a client retrying after a
            // dropped response gets exactly what it would have got.
            res.status(201).json(existing.responseJson);
            return;
          }

          throw new HttpError(
            409,
            'CONFLICT',
            'This order is already being processed. Please wait a moment.',
          );
        }
        throw error;
      }

      // ── Place the order, then complete the key ────────────────────────
      try {
        const order = await placeOrder(userId, body, {
          ipAddress: req.ip,
          idempotencyKey,
        });

        const payload = ok(order);

        await prisma.idempotencyKey.update({
          where: { id: claim.id },
          data: {
            status: 'COMPLETED',
            responseJson: payload as unknown as Prisma.InputJsonValue,
            completedAt: new Date(),
          },
        });

        res.status(201).json(payload);
      } catch (error) {
        // Mark the key FAILED so a retry with the same key is not stuck behind
        // a PROCESSING row that will never complete. Deleting it would let the
        // same key be reused for a different cart, which defeats the purpose.
        await prisma.idempotencyKey
          .update({ where: { id: claim.id }, data: { status: 'FAILED', completedAt: new Date() } })
          .catch(() => undefined);
        throw error;
      }
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /checkout/verify-payment
 *
 * Verifies a gateway result **server-side**. The redirect that brings the buyer
 * back is not trusted (AGENTS.md §7.10, security.md §10) — this endpoint takes
 * the gateway's transaction id and status, and in production would call the
 * gateway's own query API to confirm before flipping the order to PAID.
 *
 * In this phase there is no live gateway credential, so the verification step
 * is a documented stub: the transaction id is recorded and the status applied,
 * and the `verifyWithGateway()` seam in the service is where the real API call
 * goes. That seam is deliberately a single named function so wiring it later
 * cannot accidentally bypass the amount reconciliation.
 */
checkoutRouter.post(
  '/verify-payment',
  optionalAuth,
  csrfProtection,
  validate({ body: verifyPaymentBody }),
  async (req, res, next) => {
    try {
      const body = req.body as {
        orderNumber: string;
        gateway: 'BKASH' | 'NAGAD' | 'SSLCOMMERZ';
        transactionId: string;
        status: 'SUCCESS' | 'FAILED' | 'CANCELLED';
      };

      const order = await verifyPayment(body, req.session?.id ?? null);
      res.json(ok(order));
    } catch (error) {
      next(error);
    }
  },
);
