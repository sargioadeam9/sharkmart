/**
 * The till — `/admin/pos` (Phase 10 pass M).
 *
 * Server component: it asks one question ("is there an open shift?") and hands
 * the answer to the island. Everything after that — search, basket, payment —
 * is client state, because a till is a sequence of keystrokes, not a document.
 *
 * The shift read is the only thing that has to happen on the server: rendering
 * the "start a shift" gate for a cashier who already has one open would make
 * them think their drawer was lost.
 */

import type { Metadata } from 'next';

import { adminFetchServer, AdminApiError } from '@/lib/api/admin';
import { getLang } from '@/lib/locale';
import { PosScreen } from '@/components/admin/pos-screen';
import type { PosSession } from '@/lib/api/admin-pos';

export const metadata: Metadata = {
  title: 'Till',
  robots: { index: false, follow: false },
};

export default async function PosPage() {
  const lang = await getLang();

  let session: PosSession | null = null;
  let error: string | null = null;

  try {
    const response = await adminFetchServer<{ session: PosSession | null }>(
      '/admin/pos/session/current',
    );
    session = response.data.session;
  } catch (caught) {
    error =
      caught instanceof AdminApiError
        ? caught.message
        : lang === 'bn'
          ? 'শিফটের অবস্থা জানা যায়নি।'
          : 'Could not read the shift state.';
  }

  return (
    <>
      <div className="title-row no-print">
        <div>
          <h1>{lang === 'bn' ? 'কাউন্টার' : 'Till'}</h1>
          <p className="sub">
            {lang === 'bn'
              ? 'দোকানের কাউন্টার থেকে বিক্রয় — স্টক ও হিসাব একই জায়গায়'
              : 'Counter sales — the same stock and the same books as the website'}
          </p>
        </div>
      </div>

      {error ? (
        <div className="ord-notice is-error" role="alert">
          <span>{error}</span>
        </div>
      ) : (
        <PosScreen lang={lang} initialSession={session} />
      )}
    </>
  );
}
