'use client';

/**
 * The admin shell — sidebar, topbar, dark mode, mobile drawer, bottom nav.
 *
 * This is a client component because it owns interactive state: the mobile
 * drawer, the two popovers, the theme toggle and the "/" search shortcut. The
 * *authorization* decision is not made here — the layout already made it on the
 * server and passed down the permission list. This component only decides what
 * to draw.
 *
 * Dark mode is applied as `data-theme="dark"` on the shell root, and the
 * stylesheet scopes every dark rule to `.admin-root[data-theme=dark]`. That is
 * what keeps a dark admin tab from darkening the storefront: the attribute
 * never reaches `<html>` or `<body>`.
 *
 * The theme choice persists in localStorage under an admin-specific key
 * (`sm_admin_theme`), not the storefront's — the two surfaces have independent
 * preferences and one must not flip the other.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  BadgeCheck,
  Bell,
  Boxes,
  FolderTree,
  Gift,
  LayoutDashboard,
  Lock,
  LogOut,
  Menu,
  Moon,
  ScrollText,
  Search,
  Settings,
  ShoppingCart,
  Star,
  Sun,
  Tag,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

import { BRAND } from '@/lib/brand';
import { formatMoneyAdmin } from '@/lib/format';
import { bottomNavItems, visibleNav, type AdminNavItem } from '@/lib/admin/nav';

/** Icon registry — the nav file stores names, this resolves them. */
const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard,
  ShoppingCart,
  Users,
  Tag,
  FolderTree,
  BadgeCheck,
  Boxes,
  Star,
  Gift,
  ScrollText,
  Settings,
  Lock,
  Wallet,
};

const THEME_KEY = 'sm_admin_theme';

export interface AdminUser {
  id: string;
  name: string;
  email: string | null;
  role: string;
}

export interface AdminNotification {
  id: string;
  title: string;
  detail: string;
  tone: 'info' | 'warn' | 'bad';
  href: string;
}

interface AdminShellProps {
  user: AdminUser;
  permissions: string[];
  lang: 'en' | 'bn';
  /**
   * The wordmark, from store settings. Falls back to the BRAND constant so the
   * shell still renders if the settings read fails — a sidebar is not a place to
   * throw.
   */
  brand?: { first: string; second: string };
  /** Live counts for the nav badges and the bell. */
  notifications: AdminNotification[];
  orderCount: number;
  children: React.ReactNode;
}

/** "Super admin" from "SUPER_ADMIN" — the reference shows a human label. */
function roleLabel(role: string): string {
  return role
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** Two-letter avatar initials from a name. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'SM';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  const first = parts[0]![0] ?? '';
  const last = parts[parts.length - 1]![0] ?? '';
  return (first + last).toUpperCase();
}

export function AdminShell({
  user,
  permissions,
  lang,
  brand,
  notifications,
  orderCount,
  children,
}: AdminShellProps) {
  const pathname = usePathname();
  const router = useRouter();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [meOpen, setMeOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const [query, setQuery] = useState('');

  const searchRef = useRef<HTMLInputElement>(null);
  const bellRef = useRef<HTMLDivElement>(null);
  const meRef = useRef<HTMLDivElement>(null);

  const groups = visibleNav(permissions);
  const bottom = bottomNavItems(permissions);
  const unread = notifications.length;

  /**
   * Restore the saved theme on mount.
   *
   * Read in an effect, not during render: `localStorage` does not exist on the
   * server, and reading it during render would make the server and client
   * markup disagree (a hydration error). The brief flash is avoided by the
   * inline script in the layout, which sets the attribute before paint.
   *
   * The setState here is a one-shot sync from an external system (localStorage)
   * after mount, which is the documented use of an effect. The lint rule that
   * flags it is suppressed deliberately rather than restructured: reading
   * localStorage in a lazy initialiser would run on the server and crash.
   */
  useEffect(() => {
    const saved = window.localStorage.getItem(THEME_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot external read
    if (saved === 'dark') setDark(true);
  }, []);

  const toggleTheme = useCallback(() => {
    setDark((previous) => {
      const next = !previous;
      window.localStorage.setItem(THEME_KEY, next ? 'dark' : 'light');
      return next;
    });
  }, []);

  /** "/" focuses the search box, as the reference's `kbd /` promises. */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;

      if (event.key === '/' && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === 'Escape') {
        setBellOpen(false);
        setMeOpen(false);
        setDrawerOpen(false);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  /** Click-outside closes the popovers. */
  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (bellRef.current && !bellRef.current.contains(target)) setBellOpen(false);
      if (meRef.current && !meRef.current.contains(target)) setMeOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  /**
   * Close the mobile drawer whenever the route changes.
   *
   * Adjusted during render rather than in an effect: this is React's documented
   * pattern for "reset state when a value changes", and an effect would render
   * the open drawer once more before closing it.
   */
  const [drawerPath, setDrawerPath] = useState(pathname);
  if (drawerPath !== pathname) {
    setDrawerPath(pathname);
    if (drawerOpen) setDrawerOpen(false);
  }

  function onSearchSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length === 0) return;
    router.push(`/admin/orders?q=${encodeURIComponent(trimmed)}`);
  }

  async function signOut() {
    try {
      await fetch('/api/v1/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'X-CSRF-Token': document.cookie
            .split(';')
            .map((part) => part.trim())
            .find((part) => part.startsWith('csrf_token='))
            ?.slice('csrf_token='.length) ?? '',
        },
      });
    } finally {
      router.push('/admin/login');
      router.refresh();
    }
  }

  const isActive = (href: string) =>
    href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);

  function renderNavItem(item: AdminNavItem) {
    const Icon = ICONS[item.icon] ?? LayoutDashboard;
    const active = isActive(item.href);

    return (
      <Link
        key={item.href}
        href={item.href}
        className={active ? 'active' : undefined}
        aria-current={active ? 'page' : undefined}
      >
        <Icon className="ic" size={18} strokeWidth={2} aria-hidden />
        <span>{lang === 'bn' ? item.labelBn : item.labelEn}</span>
        {item.href === '/admin/orders' && orderCount > 0 && (
          <span className="count">{orderCount}</span>
        )}
      </Link>
    );
  }

  return (
    <div className="admin-root" data-theme={dark ? 'dark' : 'light'} lang={lang}>
      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside
        className={drawerOpen ? 'sidebar open' : 'sidebar'}
        aria-label={lang === 'bn' ? 'প্রধান নেভিগেশন' : 'Main navigation'}
      >
        <div className="brand">
          <div className="logo" aria-hidden>
            {/* The reference draws a ring; the shark glyph is the brand swap
                (AGENTS.md §2.1). Kept as a mark, not the full wordmark, because
                the sidebar is 264px and the wordmark is 2073px wide. */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M2 14c3-1 5-4 8-6 2-1.4 4-2 6-2 2.2 0 4 1 6 3-1.4.3-2.4 1-3 2 1 .6 1.6 1.4 2 2.4-2.6.6-4.6 2-6 4-1.6 2.2-3.6 3-6 3-3 0-5.4-1.6-7-4.4z"
                fill="#fff"
              />
            </svg>
          </div>
          <span>
            {(brand ?? BRAND.nameParts).first}
            <b>{(brand ?? BRAND.nameParts).second}</b>
          </span>
        </div>

        <nav className="nav">
          {groups.map((group) => (
            <div key={group.headingEn || 'root'}>
              {group.headingEn && <h6>{lang === 'bn' ? group.headingBn : group.headingEn}</h6>}
              {group.items.map(renderNavItem)}
            </div>
          ))}
        </nav>

        <div className="side-foot">
          <div className="me">
            <div className="avatar" aria-hidden>
              {initials(user.name)}
            </div>
            <div style={{ minWidth: 0 }}>
              <b className="ellip">{user.name}</b>
              <small>{roleLabel(user.role)}</small>
            </div>
          </div>
        </div>
      </aside>

      {/* Scrim — mobile only, closes the drawer. */}
      <div
        className={drawerOpen ? 'scrim open' : 'scrim'}
        onClick={() => setDrawerOpen(false)}
        aria-hidden
      />

      <div className="main">
        {/* ── Topbar ────────────────────────────────────────────────────── */}
        <header className="topbar">
          <button
            className="menu-btn"
            onClick={() => setDrawerOpen(true)}
            aria-label={lang === 'bn' ? 'মেনু খুলুন' : 'Open menu'}
          >
            <Menu size={20} aria-hidden />
          </button>

          <form className="search" onSubmit={onSearchSubmit} role="search">
            <Search size={18} aria-hidden />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                lang === 'bn'
                  ? 'অর্ডার, পণ্য, গ্রাহক, SKU খুঁজুন'
                  : 'Search orders, products, customers, SKU'
              }
              aria-label={lang === 'bn' ? 'খুঁজুন' : 'Search'}
            />
            <kbd aria-hidden>/</kbd>
          </form>

          <div className="top-right">
            <button
              className="icon-btn"
              onClick={toggleTheme}
              aria-label={
                dark
                  ? lang === 'bn'
                    ? 'লাইট মোডে যান'
                    : 'Switch to light mode'
                  : lang === 'bn'
                    ? 'ডার্ক মোডে যান'
                    : 'Switch to dark mode'
              }
              aria-pressed={dark}
            >
              {dark ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
            </button>

            <div className="rel" ref={bellRef}>
              <button
                className="icon-btn"
                onClick={() => {
                  setBellOpen((open) => !open);
                  setMeOpen(false);
                }}
                aria-label={lang === 'bn' ? 'নোটিফিকেশন' : 'Notifications'}
                aria-expanded={bellOpen}
              >
                <Bell size={18} aria-hidden />
                {unread > 0 && <span className="dot" />}
              </button>

              <div className={bellOpen ? 'pop open' : 'pop'}>
                <div className="pop-head">
                  <b>{lang === 'bn' ? 'নোটিফিকেশন' : 'Notifications'}</b>
                </div>
                {notifications.length === 0 ? (
                  <p className="empty">
                    {lang === 'bn' ? 'কিছু নেই — সব ঠিক আছে।' : 'Nothing here — all clear.'}
                  </p>
                ) : (
                  notifications.map((note) => (
                    <Link
                      key={note.id}
                      href={note.href}
                      className="item unread"
                      onClick={() => setBellOpen(false)}
                    >
                      <span className="chip">
                        <Bell size={16} aria-hidden />
                      </span>
                      <div>
                        {note.title}
                        <small>{note.detail}</small>
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </div>

            <div className="rel" ref={meRef}>
              <button
                className="avatar"
                onClick={() => {
                  setMeOpen((open) => !open);
                  setBellOpen(false);
                }}
                aria-label={lang === 'bn' ? 'অ্যাকাউন্ট মেনু' : 'Account menu'}
                aria-expanded={meOpen}
              >
                {initials(user.name)}
              </button>

              <div className={meOpen ? 'pop small open' : 'pop small'}>
                <div className="item" style={{ cursor: 'default' }}>
                  <div>
                    <b>{user.name}</b>
                    <small>{roleLabel(user.role)}</small>
                  </div>
                </div>
                <hr />
                <button className="item" onClick={toggleTheme}>
                  {dark ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />}
                  {dark
                    ? lang === 'bn'
                      ? 'লাইট মোড'
                      : 'Light mode'
                    : lang === 'bn'
                      ? 'ডার্ক মোড'
                      : 'Dark mode'}
                </button>
                <hr />
                <button className="item danger" onClick={signOut}>
                  <LogOut size={16} aria-hidden />
                  {lang === 'bn' ? 'সাইন আউট' : 'Sign out'}
                </button>
              </div>
            </div>
          </div>
        </header>

        <main className="page">{children}</main>
      </div>

      {/* ── Mobile bottom nav ───────────────────────────────────────────── */}
      {bottom.length > 0 && (
        <nav className="bottom-nav" aria-label={lang === 'bn' ? 'দ্রুত নেভিগেশন' : 'Quick navigation'}>
          {bottom.map((item) => {
            const Icon = ICONS[item.icon] ?? LayoutDashboard;
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? 'active' : undefined}
                aria-current={active ? 'page' : undefined}
              >
                <Icon className="ic" size={22} aria-hidden />
                <span>{lang === 'bn' ? item.labelBn : item.labelEn}</span>
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}

/** Re-exported so a page can render the same money format the shell uses. */
export { formatMoneyAdmin };
