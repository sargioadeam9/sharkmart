'use client';

/**
 * Marketing — the client island for `/admin/marketing`.
 *
 * Three sections in one screen because they are one workflow: write a template,
 * compose against a segment, watch the queue. Splitting them into routes would
 * mean losing the template you just wrote when you go to compose with it.
 *
 * The compose button says **Queue**, not Send. Nothing is delivered from this
 * screen; `tools/dispatch-notifications.mjs` drains the queue. Labelling it "Send"
 * would be the first lie in a delivery report.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Send, X } from 'lucide-react';

import {
  compose,
  createSmsTemplate,
  type CampaignReport,
  type CampaignSegment,
  type Channel,
  type ComposePreview,
  type TemplatesResponse,
} from '@/lib/api/admin-marketing';

type Lang = 'en' | 'bn';

const SEGMENTS: Array<{ key: CampaignSegment; en: string; bn: string }> = [
  { key: 'all', en: 'All customers', bn: 'সব ক্রেতা' },
  { key: 'new', en: 'New', bn: 'নতুন' },
  { key: 'returning', en: 'Returning', bn: 'ফিরে আসা' },
  { key: 'high_value', en: 'High value', bn: 'বেশি খরচ' },
  { key: 'inactive', en: 'Inactive', bn: 'নিষ্ক্রিয়' },
];

export function MarketingScreen({
  lang,
  templates,
  report,
}: {
  lang: Lang;
  templates: TemplatesResponse;
  report: CampaignReport;
}) {
  const router = useRouter();
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);

  // template form
  const [name, setName] = useState('');
  const [bodyEn, setBodyEn] = useState('Hi {name}, ');
  const [bodyBn, setBodyBn] = useState('হ্যালো {name}, ');
  const [busy, setBusy] = useState(false);

  // compose
  const [channel, setChannel] = useState<Channel>('SMS');
  const [templateId, setTemplateId] = useState('');
  const [segment, setSegment] = useState<CampaignSegment>('all');
  const [language, setLanguage] = useState<'bn' | 'en'>('bn');
  const [preview, setPreview] = useState<ComposePreview | null>(null);

  const channelTemplates = channel === 'SMS' ? templates.sms : templates.email;

  async function saveTemplate(): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      await createSmsTemplate({ name: name.trim(), templateEn: bodyEn, templateBn: bodyBn });
      setName('');
      setBodyEn('Hi {name}, ');
      setBodyBn('হ্যালো {name}, ');
      setNotice({ text: lang === 'bn' ? 'টেমপ্লেট তৈরি হয়েছে' : 'Template created', tone: 'ok' });
      router.refresh();
    } catch (error) {
      setNotice({ text: (error as Error).message, tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function run(previewOnly: boolean): Promise<void> {
    if (!templateId) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await compose({ channel, templateId, segment, language, preview: previewOnly });
      if (previewOnly) {
        setPreview(result as ComposePreview);
      } else {
        const queued = (result as { queued: number }).queued;
        setPreview(null);
        setNotice({
          text:
            lang === 'bn'
              ? `${queued}টি সারিতে ঢুকেছে — পাঠানো হয়নি`
              : `${queued} queued — nothing sent yet`,
          tone: 'ok',
        });
        router.refresh();
      }
    } catch (error) {
      setNotice({ text: (error as Error).message, tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {notice && (
        <div
          className={`ord-notice${notice.tone === 'error' ? ' is-error' : ''}`}
          role={notice.tone === 'error' ? 'alert' : 'status'}
        >
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">
            <X size={14} aria-hidden />
          </button>
        </div>
      )}

      <div className="mkt-grid">
        <section className="card rep-card">
          <h2>{lang === 'bn' ? 'কম্পোজ' : 'Compose'}</h2>

          <label className="field">
            <span>{lang === 'bn' ? 'চ্যানেল' : 'Channel'}</span>
            <select
              value={channel}
              onChange={(event) => {
                setChannel(event.target.value as Channel);
                setTemplateId('');
                setPreview(null);
              }}
            >
              <option value="SMS">SMS</option>
              <option value="EMAIL">Email</option>
            </select>
          </label>

          <label className="field">
            <span>{lang === 'bn' ? 'টেমপ্লেট' : 'Template'}</span>
            <select value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
              <option value="">{lang === 'bn' ? 'বেছে নিন' : 'Choose'}</option>
              {channelTemplates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>

          <div className="field-row">
            <label className="field">
              <span>{lang === 'bn' ? 'সেগমেন্ট' : 'Segment'}</span>
              <select
                value={segment}
                onChange={(event) => setSegment(event.target.value as CampaignSegment)}
              >
                {SEGMENTS.map((entry) => (
                  <option key={entry.key} value={entry.key}>
                    {lang === 'bn' ? entry.bn : entry.en}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>{lang === 'bn' ? 'ভাষা' : 'Language'}</span>
              <select
                value={language}
                onChange={(event) => setLanguage(event.target.value as 'bn' | 'en')}
              >
                <option value="bn">বাংলা</option>
                <option value="en">English</option>
              </select>
            </label>
          </div>

          <div className="sup-order-actions">
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => void run(true)}
              disabled={busy || !templateId}
            >
              {lang === 'bn' ? 'প্রিভিউ' : 'Preview'}
            </button>
            <button
              type="button"
              className="btn sm"
              onClick={() => void run(false)}
              disabled={busy || !templateId}
            >
              <Send size={14} aria-hidden />
              {lang === 'bn' ? 'সারিতে দিন' : 'Queue'}
            </button>
          </div>

          {preview && (
            <div className="mkt-preview">
              <div className="cpn-sub">
                {preview.recipients} {lang === 'bn' ? 'জন প্রাপক' : 'recipients'}
                {preview.sample.to ? ` · ${preview.sample.to}` : ''}
              </div>
              {preview.sample.subject && <b>{preview.sample.subject}</b>}
              <p>{preview.sample.body}</p>
            </div>
          )}

          <p className="cpn-hint">
            {lang === 'bn'
              ? 'Queue মানে এখনো পাঠানো হয়নি। dispatch script চালালে সারি খালি হবে।'
              : 'Queue means nothing is sent yet. The dispatch script drains it.'}
          </p>
        </section>

        <section className="card rep-card">
          <h2>{lang === 'bn' ? 'নতুন SMS টেমপ্লেট' : 'New SMS template'}</h2>

          <label className="field">
            <span>{lang === 'bn' ? 'নাম' : 'Name'}</span>
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
          </label>

          <label className="field">
            <span>English</span>
            <input value={bodyEn} onChange={(event) => setBodyEn(event.target.value)} maxLength={1000} />
          </label>

          <label className="field">
            <span>বাংলা</span>
            <input value={bodyBn} onChange={(event) => setBodyBn(event.target.value)} maxLength={1000} />
          </label>

          <button
            type="button"
            className="btn sm"
            onClick={() => void saveTemplate()}
            disabled={busy || name.trim().length === 0 || bodyEn.trim().length === 0 || bodyBn.trim().length === 0}
          >
            <Plus size={14} aria-hidden />
            {lang === 'bn' ? 'তৈরি করুন' : 'Create'}
          </button>

          <p className="cpn-hint">
            {lang === 'bn'
              ? 'প্লেসহোল্ডার: {name} এবং {shop}'
              : 'Placeholders: {name} and {shop}'}
          </p>

          <h3 className="mkt-subhead">{lang === 'bn' ? 'বিদ্যমান টেমপ্লেট' : 'Existing templates'}</h3>
          {templates.sms.length === 0 ? (
            <p className="cpn-hint">{lang === 'bn' ? 'কোনো SMS টেমপ্লেট নেই।' : 'No SMS templates.'}</p>
          ) : (
            <ul className="sup-list">
              {templates.sms.map((template) => (
                <li key={template.id}>
                  <div>
                    <b>{template.name}</b>
                    <div className="cpn-sub">{template.templateBn}</div>
                  </div>
                  <span className="badge mute">{template.type}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card rep-card">
          <h2>{lang === 'bn' ? 'ডেলিভারি রিপোর্ট' : 'Delivery report'}</h2>

          <div className="mkt-counts">
            {Object.entries(report.counts).length === 0 ? (
              <p className="cpn-hint">{lang === 'bn' ? 'কোনো ক্যাম্পেইন নেই।' : 'No campaigns yet.'}</p>
            ) : (
              Object.entries(report.counts).map(([key, value]) => (
                <div key={key} className="exp-summary-item">
                  <span>{key.replace('_', ' ')}</span>
                  <b>{value}</b>
                </div>
              ))
            )}
          </div>

          {report.recent.length > 0 && (
            <ul className="sup-list">
              {report.recent.slice(0, 8).map((row) => (
                <li key={row.id}>
                  <div>
                    <b>{row.recipientName ?? '—'}</b>
                    <div className="cpn-sub">
                      {row.channel} · {row.subject ?? ''}
                    </div>
                  </div>
                  <span className={`badge ${row.status === 'SENT' ? 'ok' : 'warn'}`}>
                    {row.status}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <p className="cpn-hint">
            {lang === 'bn'
              ? 'SENT মানে dispatch script সারিটা প্রসেস করেছে — ডেলিভারি নিশ্চিত নয়।'
              : 'SENT means the dispatcher processed the row — not that it was delivered.'}
          </p>
        </section>
      </div>
    </>
  );
}
