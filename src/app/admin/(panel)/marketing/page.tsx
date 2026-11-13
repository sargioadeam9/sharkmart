/**
 * Marketing — `/admin/marketing` (Phase 10 pass H).
 *
 * Server component: fetches the templates and the delivery report, then hands both
 * to the island. Nothing here writes.
 */

import type { Metadata } from 'next';

import { adminFetchServer, AdminApiError } from '@/lib/api/admin';
import { getLang } from '@/lib/locale';
import type { CampaignReport, TemplatesResponse } from '@/lib/api/admin-marketing';
import { MarketingScreen } from '@/components/admin/marketing-screen';

export const metadata: Metadata = {
  title: 'SMS and email',
  robots: { index: false, follow: false },
};

export default async function MarketingPage() {
  const lang = await getLang();

  let templates: TemplatesResponse = { sms: [], email: [] };
  let report: CampaignReport = { counts: {}, recent: [] };
  let error: string | null = null;

  try {
    const [list, summary] = await Promise.all([
      adminFetchServer<TemplatesResponse>('/admin/marketing/templates'),
      adminFetchServer<CampaignReport>('/admin/marketing/report?limit=10'),
    ]);
    templates = list.data;
    report = summary.data;
  } catch (caught) {
    error =
      caught instanceof AdminApiError
        ? caught.message
        : lang === 'bn'
          ? 'মার্কেটিং লোড করা যায়নি।'
          : 'Could not load marketing.';
  }

  return (
    <>
      <div className="title-row">
        <div>
          <h1>{lang === 'bn' ? 'SMS ও ইমেইল' : 'SMS and email'}</h1>
          <p className="sub">
            {lang === 'bn'
              ? 'টেমপ্লেট, সেগমেন্ট ও সারি — পাঠানো হয় dispatch script দিয়ে'
              : 'Templates, segments and the queue — delivery happens in the dispatch script'}
          </p>
        </div>
      </div>

      {error ? (
        <div className="card">
          <p style={{ color: 'var(--bad)' }}>{error}</p>
        </div>
      ) : (
        <MarketingScreen lang={lang} templates={templates} report={report} />
      )}
    </>
  );
}
