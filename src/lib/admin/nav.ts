/**
 * Admin navigation — one definition, three consumers.
 *
 * The sidebar, the mobile bottom nav and the topbar search all read this. The
 * permission on each item is the same string the API route requires, so the
 * sidebar and the endpoint cannot disagree about who may see what.
 *
 * That said: this file decides what is *rendered*, not what is *allowed*. A
 * user who types `/admin/settings` directly gets a 403 from the API and the
 * layout's own check. Hiding a link is UX; the API is the control
 * (security.md §6).
 *
 * Icons are lucide names resolved in the component, not components here — this
 * module is imported by a server component, and keeping it plain data means it
 * can be too.
 */

export type AdminPermission =
  | 'dashboard:read'
  | 'orders:read'
  | 'orders:write'
  | 'orders:refund'
  | 'catalog:read'
  | 'catalog:write'
  | 'customers:read'
  | 'customers:write'
  | 'marketing:read'
  | 'marketing:write'
  | 'settings:read'
  | 'settings:write'
  | 'reports:read'
  | 'staff:manage'
  | 'audit:read'
  | 'inventory:read'
  | 'inventory:write'
  | 'reviews:read'
  | 'reviews:moderate';

export interface AdminNavItem {
  /** Route path. */
  href: string;
  /** English label. */
  labelEn: string;
  /** Bangla label — the panel is bilingual like the storefront. */
  labelBn: string;
  /** lucide-react icon name. */
  icon: string;
  /** The permission that reveals this item. */
  permission: AdminPermission;
  /** Shown in the mobile bottom nav (max 5, so pick the most-used). */
  bottomNav?: boolean;
}

export interface AdminNavGroup {
  /** Group heading. Empty string means no heading (the first item). */
  headingEn: string;
  headingBn: string;
  items: AdminNavItem[];
}

/**
 * The 17 modules from the reference, grouped exactly as the reference groups
 * them. `Roles and security` is the one that only SUPER_ADMIN sees — it is
 * gated on `staff:manage`, which the matrix reserves for that role alone.
 */
export const ADMIN_NAV: AdminNavGroup[] = [
  {
    headingEn: '',
    headingBn: '',
    items: [
      {
        href: '/admin',
        labelEn: 'Dashboard',
        labelBn: 'ড্যাশবোর্ড',
        icon: 'LayoutDashboard',
        permission: 'dashboard:read',
        bottomNav: true,
      },
    ],
  },
  {
    headingEn: 'Sell',
    headingBn: 'বিক্রয়',
    items: [
      {
        href: '/admin/orders',
        labelEn: 'Orders',
        labelBn: 'অর্ডার',
        icon: 'ShoppingCart',
        permission: 'orders:read',
        bottomNav: true,
      },
      {
        href: '/admin/customers',
        labelEn: 'Customers',
        labelBn: 'গ্রাহক',
        icon: 'Users',
        permission: 'customers:read',
      },
    ],
  },
  {
    headingEn: 'Catalog',
    headingBn: 'ক্যাটালগ',
    items: [
      {
        href: '/admin/products',
        labelEn: 'Products',
        labelBn: 'পণ্য',
        icon: 'Tag',
        permission: 'catalog:read',
        bottomNav: true,
      },
      {
        href: '/admin/categories',
        labelEn: 'Categories',
        labelBn: 'ক্যাটাগরি',
        icon: 'FolderTree',
        permission: 'catalog:read',
      },
      {
        href: '/admin/brands',
        labelEn: 'Brands',
        labelBn: 'ব্র্যান্ড',
        icon: 'BadgeCheck',
        permission: 'catalog:read',
      },
      {
        href: '/admin/inventory',
        labelEn: 'Inventory',
        labelBn: 'স্টক',
        icon: 'Boxes',
        permission: 'inventory:read',
        bottomNav: true,
      },
    ],
  },
  {
    headingEn: 'Grow',
    headingBn: 'প্রবৃদ্ধি',
    items: [
      {
        href: '/admin/marketing',
        labelEn: 'SMS and email',
        labelBn: 'SMS ও ইমেইল',
        icon: 'Megaphone',
        permission: 'marketing:write',
      },
      {
        href: '/admin/reviews',
        labelEn: 'Reviews',
        labelBn: 'পর্যালোচনা',
        icon: 'Star',
        permission: 'reviews:read',
      },
      {
        href: '/admin/offers',
        labelEn: 'Offers and coupons',
        labelBn: 'অফার ও কুপন',
        icon: 'Gift',
        permission: 'marketing:read',
      },
    ],
  },
  {
    headingEn: 'Operate',
    headingBn: 'পরিচালনা',
    items: [
      {
        href: '/admin/audit',
        labelEn: 'Audit log',
        labelBn: 'অডিট লগ',
        icon: 'ScrollText',
        permission: 'audit:read',
      },
      {
        href: '/admin/reports',
        labelEn: 'Reports',
        labelBn: 'রিপোর্ট',
        icon: 'ChartBar',
        permission: 'reports:read',
      },
      {
        href: '/admin/warehouses',
        labelEn: 'Warehouses',
        labelBn: 'গুদাম',
        icon: 'Boxes',
        permission: 'inventory:read',
      },
      {
        href: '/admin/suppliers',
        labelEn: 'Suppliers',
        labelBn: 'সরবরাহকারী',
        icon: 'Truck',
        permission: 'inventory:read',
      },
      {
        href: '/admin/expenses',
        labelEn: 'Expenses',
        labelBn: 'খরচ',
        icon: 'Wallet',
        permission: 'settings:read',
      },
      {
        href: '/admin/settings',
        labelEn: 'Settings',
        labelBn: 'সেটিংস',
        icon: 'Settings',
        permission: 'settings:read',
        bottomNav: true,
      },
      {
        href: '/admin/roles',
        labelEn: 'Roles and security',
        labelBn: 'রোল ও নিরাপত্তা',
        icon: 'Lock',
        permission: 'staff:manage',
      },
    ],
  },
];

/** The permission list the API returns, as a set for O(1) checks. */
export type PermissionSet = readonly string[];

/** True when the permission set satisfies the item. */
export function canSee(permissions: PermissionSet, item: AdminNavItem): boolean {
  return permissions.includes(item.permission);
}

/**
 * Filters the nav down to what this user may see.
 *
 * A group whose items are all hidden is dropped entirely — an empty "Operate"
 * heading with nothing under it reads as a rendering bug.
 */
export function visibleNav(permissions: PermissionSet): AdminNavGroup[] {
  return ADMIN_NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => canSee(permissions, item)),
  })).filter((group) => group.items.length > 0);
}

/** The five (or fewer) items for the mobile bottom nav. */
export function bottomNavItems(permissions: PermissionSet): AdminNavItem[] {
  return ADMIN_NAV.flatMap((group) => group.items)
    .filter((item) => item.bottomNav && canSee(permissions, item))
    .slice(0, 5);
}

/**
 * The label for a path, for the topbar breadcrumb.
 *
 * Longest match wins, so `/admin/products/new` resolves to Products rather than
 * to Dashboard.
 */
export function labelForPath(pathname: string, lang: 'en' | 'bn'): string {
  const all = ADMIN_NAV.flatMap((group) => group.items);
  const match = all
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];

  if (!match) return lang === 'bn' ? 'ড্যাশবোর্ড' : 'Dashboard';
  return lang === 'bn' ? match.labelBn : match.labelEn;
}
