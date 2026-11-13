/**
 * The role → permission map — security.md §6.
 *
 * This is data, not a chain of `if` statements. A route declares the permission
 * it needs (`requirePermission('catalog:write')`) and this table decides which
 * roles satisfy it. Adding a role means editing one object; adding a permission
 * means editing one object. Neither means hunting through route files.
 *
 * The role names are the exact `Role` enum values from `schema.prisma`. There is
 * no `PRODUCT_MANAGER`, no `STAFF`, no `MANAGER` — those are the *columns* of
 * the security.md matrix, not enum values. The mapping below is the translation
 * between the document's vocabulary and the database's.
 *
 *   security.md column | enum value(s)
 *   -------------------|--------------------------------------------
 *   customer           | CUSTOMER
 *   staff              | INVENTORY_STAFF, MARKETING_STAFF
 *   manager            | ORDER_MANAGER
 *   admin              | ADMIN
 *   super admin        | SUPER_ADMIN
 *
 * Two rules from security.md §6 that the shape of this file enforces:
 *
 *   1. "Middleware checks the permission, not just the role name." Hence
 *      `requirePermission`, not `requireRole('ADMIN')` scattered around.
 *   2. "The UI may hide a control. The API must still reject it." The nav reads
 *      this same map, so the sidebar and the endpoint can never disagree about
 *      who is allowed to do what — but the endpoint is the one that enforces it.
 */

import type { Role } from '@prisma/client';

/** Every permission an admin route can require. */
export type Permission =
  // Orders
  | 'orders:read'
  | 'orders:write'
  | 'orders:refund'
  // Catalog
  | 'catalog:read'
  | 'catalog:write'
  // Customers
  | 'customers:read'
  | 'customers:write'
  // Marketing
  | 'marketing:read'
  | 'marketing:write'
  // Settings
  | 'settings:read'
  | 'settings:write'
  // Staff and roles
  | 'staff:manage'
  // Audit
  | 'audit:read'
  // Reports
  | 'reports:read'
  // Inventory
  | 'inventory:read'
  | 'inventory:write'
  // Reviews
  | 'reviews:read'
  | 'reviews:moderate'
  // Dashboard
  | 'dashboard:read';

/**
 * The matrix, transcribed from security.md §6.
 *
 * Read it as "this role holds these permissions". A role absent from a
 * permission's list does not hold it — there is no inheritance, no wildcard,
 * and no implicit "admins can do everything". SUPER_ADMIN is listed explicitly
 * on every line precisely so that a future permission cannot be silently
 * granted to it by a `*` rule.
 */
export const PERMISSIONS_BY_ROLE: Record<Role, readonly Permission[]> = {
  CUSTOMER: [],

  /** staff — read catalog and orders, write catalog, no money, no settings. */
  INVENTORY_STAFF: [
    'dashboard:read',
    'orders:read',
    'catalog:read',
    'catalog:write',
    'inventory:read',
    'inventory:write',
    'reviews:read',
  ],

  /** staff — the marketing lane: catalog and campaigns, no orders, no money. */
  MARKETING_STAFF: [
    'dashboard:read',
    'catalog:read',
    'catalog:write',
    'marketing:read',
    'marketing:write',
    'reviews:read',
    'reviews:moderate',
  ],

  /** manager — orders, refunds, customers, campaigns, audit. Not settings. */
  ORDER_MANAGER: [
    'dashboard:read',
    'orders:read',
    'orders:write',
    'orders:refund',
    'catalog:read',
    'catalog:write',
    'customers:read',
    'customers:write',
    'marketing:read',
    'marketing:write',
    'inventory:read',
    'inventory:write',
    'reviews:read',
    'reviews:moderate',
    'audit:read',
    'reports:read',
  ],

  /** admin — everything except managing staff and roles. */
  ADMIN: [
    'dashboard:read',
    'orders:read',
    'orders:write',
    'orders:refund',
    'catalog:read',
    'catalog:write',
    'customers:read',
    'customers:write',
    'marketing:read',
    'marketing:write',
    'settings:read',
    'settings:write',
    'inventory:read',
    'inventory:write',
    'reviews:read',
    'reviews:moderate',
    'audit:read',
    'reports:read',
  ],

  /** super admin — the only role that may manage staff and roles. */
  SUPER_ADMIN: [
    'dashboard:read',
    'orders:read',
    'orders:write',
    'orders:refund',
    'catalog:read',
    'catalog:write',
    'customers:read',
    'customers:write',
    'marketing:read',
    'marketing:write',
    'settings:read',
    'settings:write',
    'staff:manage',
    'inventory:read',
    'inventory:write',
    'reviews:read',
    'reviews:moderate',
    'audit:read',
    'reports:read',
  ],
};

/** True when the role holds the permission. */
export function can(role: string, permission: Permission): boolean {
  const held = PERMISSIONS_BY_ROLE[role as Role];
  if (!held) return false;
  return held.includes(permission);
}

/** The permission list for a role — what `GET /admin/me` returns to the nav. */
export function permissionsFor(role: string): Permission[] {
  const held = PERMISSIONS_BY_ROLE[role as Role];
  return held ? [...held] : [];
}

/**
 * True when the role may enter the admin panel at all.
 *
 * A CUSTOMER holds zero permissions, so this is equivalent to "holds at least
 * one" — but it is written explicitly because it is the gate the layout uses,
 * and "at least one permission" would silently admit a future role that was
 * given a single innocuous permission by accident.
 */
export const ADMIN_ROLES: readonly Role[] = [
  'SUPER_ADMIN',
  'ADMIN',
  'ORDER_MANAGER',
  'INVENTORY_STAFF',
  'MARKETING_STAFF',
];

export function isAdminRole(role: string): boolean {
  return (ADMIN_ROLES as readonly string[]).includes(role);
}
