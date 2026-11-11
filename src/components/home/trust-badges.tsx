/**
 * TrustBadges — the reference's `.trust` strip (oshoppingbd.html L116-120,
 * markup L655).
 *
 * Four items, each an icon tile plus a bold line and a muted sub-line. The
 * strings are the reference's `t1..t4` / `t1s..t4s` keys, so they translate
 * with everything else and nothing is retyped here.
 */

import { useLang } from '@/lib/hooks';

/** Icon + the two translation keys for each badge, in the reference's order. */
const BADGES = [
  { icon: '💵', title: 't1', sub: 't1s' },
  { icon: '↩️', title: 't2', sub: 't2s' },
  { icon: '✅', title: 't3', sub: 't3s' },
  { icon: '🚚', title: 't4', sub: 't4s' },
] as const;

export function TrustBadges() {
  const { t } = useLang();

  return (
    <div className="trust">
      {BADGES.map((badge) => (
        <div key={badge.title}>
          <span className="ti" aria-hidden="true">
            {badge.icon}
          </span>
          <span>
            <b>{t(badge.title)}</b>
            <small>{t(badge.sub)}</small>
          </span>
        </div>
      ))}
    </div>
  );
}
