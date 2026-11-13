/**
 * TopBar — the reference's `.topbar` (oshoppingbd.html L35-41, markup L607).
 *
 * Navy strip: phone + free-delivery line on the left, Track / Help / Return and
 * the language toggle on the right. Hidden below 760px, where the mobile
 * header takes over.
 */

'use client';

import Link from 'next/link';
import { useLang } from '@/lib/hooks';
import { useStore } from '@/components/providers/store-provider';
import { LanguageToggle } from './language-toggle';

export function TopBar() {
  const { t } = useLang();
  const store = useStore();

  return (
    <div className="topbar">
      <div className="wrap">
        <span>
          📞 {store.phone} &nbsp;·&nbsp; {t('inc')}
        </span>
        <nav>
          <Link href="/track">{t('track')}</Link>
          <Link href="/help">{t('help')}</Link>
          <Link href="/return">{t('ret')}</Link>
          <LanguageToggle />
        </nav>
      </div>
    </div>
  );
}
