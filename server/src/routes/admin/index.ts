/**
 * Admin API — `/api/v1/admin`.
 *
 * Every route below sits behind `requireAuth` (who is this?) and a permission
 * gate (may they?). The router-level `requireAuth` is mounted once here so a
 * new admin route cannot ship without a session; each route then declares the
 * permission it needs.
 *
 * The rate limit is the `admin` bucket (200/min). It is applied at the router
 * root for the same reason: a route added later inherits it without the author
 * having to remember.
 *
 * Phase 9 pass A ships `/me` and the dashboard aggregates. Pass B adds the
 * module routers (products, orders, categories, inventory, reviews) as
 * sub-routers mounted here.
 */

import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { rateLimit, LIMITS } from '../../middleware/rateLimiter.js';
import { ok } from '../../types/api.js';
import { prisma } from '../../config/database.js';
import { notFound } from '../../middleware/errorHandler.js';
import { isAdminRole, permissionsFor } from '../../services/permissions.js';
import { dashboardRouter } from './dashboard.js';
import { productsRouter } from './products.js';
import { ordersRouter } from './orders.js';
import { inventoryRouter } from './inventory.js';
import { reviewsRouter } from './reviews.js';
import { categoriesRouter } from './categories.js';
import { brandsRouter } from './brands.js';
import { couponsRouter } from './coupons.js';

export const adminRouter: Router = Router();

// ── Every admin route: rate limited, authenticated, staff only ───────────────
adminRouter.use(rateLimit(LIMITS.admin));
adminRouter.use(requireAuth);

/**
 * Staff gate, applied to the whole admin surface.
 *
 * A CUSTOMER with a valid session reaches this line and is refused. That is the
 * "GET /admin as CUSTOMER -> 403" gate, enforced server-side — the layout's
 * check is a second, independent one, because a layout redirect is UX and this
 * is the control.
 *
 * `requireRole` is used here rather than `requirePermission` because "is this
 * person staff at all" is a role question, not a permission question. The
 * per-route gates below are the permission questions.
 */
adminRouter.use((req, res, next) => {
  if (!req.session || !isAdminRole(req.session.role)) {
    res.status(403).json({
      success: false,
      error: { code: 'FORBIDDEN', message: 'You do not have access to the admin panel.' },
    });
    return;
  }
  next();
});

/**
 * GET /admin/me — who am I, and what may I do?
 *
 * This is the endpoint the admin layout calls to make its decision, and the one
 * the sidebar calls to decide what to render. Returning the permission list
 * rather than making the client re-implement the matrix means there is exactly
 * one copy of the rules, on the server.
 *
 * It is deliberately NOT permission-gated: every staff member may ask who they
 * are. Gating it would mean the layout could not render a "you have no access"
 * page for a staff member with an empty permission set.
 */
adminRouter.get('/me', async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.session!.id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        language: true,
        createdAt: true,
      },
    });

    if (!user) throw notFound('Account');

    res.json(
      ok({
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          language: user.language,
          createdAt: user.createdAt.toISOString(),
        },
        // The nav renders from this. The API still enforces independently —
        // hiding a control is UX, rejecting the call is the control.
        permissions: permissionsFor(user.role),
      }),
    );
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/audit — the audit trail, newest first.
 *
 * `audit:read` is held by ORDER_MANAGER and above (security.md §6). Included in
 * pass A because it is the read side of the audit helper, and verifying that a
 * mutation wrote a row is much easier through an endpoint than through a SQL
 * client.
 */
adminRouter.get('/audit', requirePermission('audit:read'), async (req, res, next) => {
  try {
    const take = Math.min(Number(req.query.limit) || 50, 200);
    const rows = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take,
      include: { user: { select: { id: true, name: true, role: true } } },
    });

    res.json(
      ok({
        entries: rows.map((row) => ({
          id: row.id,
          userId: row.userId,
          userName: row.user?.name ?? null,
          userRole: row.user?.role ?? null,
          action: row.action,
          entity: row.entity,
          entityId: row.entityId,
          changes: row.changes,
          ipAddress: row.ipAddress,
          createdAt: row.createdAt.toISOString(),
        })),
      }),
    );
  } catch (error) {
    next(error);
  }
});

// ── Module routers ──────────────────────────────────────────────────────────
adminRouter.use('/dashboard', dashboardRouter);
adminRouter.use('/products', productsRouter);
adminRouter.use('/orders', ordersRouter);
adminRouter.use('/inventory', inventoryRouter);
adminRouter.use('/reviews', reviewsRouter);
adminRouter.use('/categories', categoriesRouter);
adminRouter.use('/brands', brandsRouter);
adminRouter.use('/coupons', couponsRouter);
