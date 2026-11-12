/**
 * AuthShell — the card wrapper shared by `/login`, `/register` and the reset
 * flows.
 *
 * It is a client component purely so the heading and subtitle can come from the
 * bilingual dictionary. A server page could not call `useLang`, and hardcoding
 * English here would ship a half-translated auth surface — the exact thing the
 * Phase 8 gate rejects.
 */

'use client';

import { useLang } from '@/lib/hooks';
import type { UiKey } from '@/lib/i18n/ui';

export function AuthShell({
  titleKey,
  subtitleKey,
  children,
}: {
  titleKey: UiKey;
  subtitleKey?: UiKey;
  children: React.ReactNode;
}) {
  const { tu } = useLang();

  return (
    <div className="acct-auth-wrap">
      <div className="acct-card">
        <h2>{tu(titleKey)}</h2>
        {subtitleKey && <p className="acct-card-sub">{tu(subtitleKey)}</p>}
        {children}
      </div>
    </div>
  );
}
