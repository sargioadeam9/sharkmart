'use client';

/**
 * The settings form.
 *
 * Renders whatever the server's registry returns — no field list here. Adding a
 * setting is a one-line change in `settings.service.ts` and it appears on this
 * screen with its label, hint, type and default.
 *
 * Only changed values are sent. A PATCH carrying every field would make the audit
 * row claim the operator edited fourteen things when they edited one, and would
 * fail validation on an untouched field they cannot even see.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, RotateCcw, X } from 'lucide-react';

import { saveSettings, type SettingGroup, type SettingItem, type SettingsGroup } from '@/lib/api/admin-settings';

type Lang = 'en' | 'bn';

const GROUP_LABEL: Record<SettingGroup, { en: string; bn: string }> = {
  general: { en: 'Store', bn: 'দোকান' },
  contact: { en: 'Contact', bn: 'যোগাযোগ' },
  commerce: { en: 'Delivery and pricing', bn: 'ডেলিভারি ও মূল্য' },
  branding: { en: 'Branding', bn: 'ব্র্যান্ডিং' },
};

const GROUP_HINT: Partial<Record<SettingGroup, { en: string; bn: string }>> = {
  commerce: {
    en: 'These are the numbers checkout charges. Fees are in poisha: 100 poisha = ৳1.',
    bn: 'চেকআউট এই সংখ্যাগুলোই নেয়। চার্জ পয়সায়: ১০০ পয়সা = ৳১।',
  },
  branding: {
    en: 'The wordmark is two fields because the two halves are different colours.',
    bn: 'ওয়ার্ডমার্ক দুই ফিল্ডে, কারণ দুই অংশের রঙ আলাদা।',
  },
};

interface Props {
  lang: Lang;
  groups: SettingsGroup[];
  canWrite: boolean;
}

export function SettingsForm({ lang, groups, canWrite }: Props) {
  const router = useRouter();

  const initial = useMemo(() => {
    const map: Record<string, string> = {};
    for (const group of groups) for (const item of group.items) map[item.key] = item.value;
    return map;
  }, [groups]);

  const [values, setValues] = useState<Record<string, string>>(initial);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);

  const changed = useMemo(() => {
    const diff: Record<string, string> = {};
    for (const [key, value] of Object.entries(values)) {
      if (value !== initial[key]) diff[key] = value;
    }
    return diff;
  }, [values, initial]);

  const dirtyCount = Object.keys(changed).length;

  async function save(): Promise<void> {
    if (dirtyCount === 0) return;
    setSaving(true);
    setNotice(null);
    try {
      await saveSettings(changed);
      setNotice({
        text:
          lang === 'bn'
            ? `${dirtyCount}টি সেটিংস সংরক্ষিত হয়েছে`
            : `${dirtyCount} setting${dirtyCount === 1 ? '' : 's'} saved`,
        tone: 'ok',
      });
      router.refresh();
    } catch (error) {
      setNotice({ text: (error as Error).message, tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  function reset(): void {
    setValues(initial);
    setNotice(null);
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

      <div className="set-bar">
        <span className="set-dirty">
          {dirtyCount === 0
            ? lang === 'bn'
              ? 'কোনো পরিবর্তন নেই'
              : 'No changes'
            : lang === 'bn'
              ? `${dirtyCount}টি পরিবর্তন`
              : `${dirtyCount} unsaved change${dirtyCount === 1 ? '' : 's'}`}
        </span>
        <div className="set-bar-actions">
          <button type="button" className="btn ghost sm" onClick={reset} disabled={dirtyCount === 0 || saving}>
            <RotateCcw size={14} aria-hidden />
            {lang === 'bn' ? 'ফিরিয়ে নিন' : 'Discard'}
          </button>
          <button
            type="button"
            className="btn sm"
            onClick={() => void save()}
            disabled={dirtyCount === 0 || saving || !canWrite}
          >
            <Check size={14} aria-hidden />
            {saving ? (lang === 'bn' ? 'সংরক্ষণ…' : 'Saving…') : lang === 'bn' ? 'সংরক্ষণ' : 'Save changes'}
          </button>
        </div>
      </div>

      {!canWrite && (
        <div className="ord-notice is-warn" role="status">
          <span>
            {lang === 'bn'
              ? 'আপনি শুধু দেখতে পারবেন, পরিবর্তন করতে পারবেন না।'
              : 'You can view these settings but not change them.'}
          </span>
        </div>
      )}

      {groups.map((group) => (
        <section key={group.group} className="card set-card">
          <div className="set-card-head">
            <h2>{GROUP_LABEL[group.group][lang]}</h2>
            {GROUP_HINT[group.group] && (
              <p className="cpn-hint">{GROUP_HINT[group.group]![lang]}</p>
            )}
          </div>

          <div className="form set-grid">
            {group.items.map((item) => (
              <SettingField
                key={item.key}
                lang={lang}
                item={item}
                value={values[item.key] ?? ''}
                disabled={!canWrite}
                onChange={(next) => setValues((prev) => ({ ...prev, [item.key]: next }))}
              />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

function SettingField({
  lang,
  item,
  value,
  disabled,
  onChange,
}: {
  lang: Lang;
  item: SettingItem;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const label = lang === 'bn' ? item.labelBn : item.labelEn;
  const hint = lang === 'bn' ? item.hintBn : item.hintEn;
  const wide = item.type === 'text';

  const id = `set-${item.key.replace(/\./g, '-')}`;

  return (
    <div className={`field${wide ? ' full' : ''}`}>
      <label htmlFor={id}>
        {label}
        {item.isDefault && (
          <span className="set-default" title={lang === 'bn' ? 'ডিফল্ট মান' : 'Default value'}>
            {lang === 'bn' ? 'ডিফল্ট' : 'default'}
          </span>
        )}
      </label>

      {item.type === 'text' ? (
        <textarea
          id={id}
          value={value}
          disabled={disabled}
          rows={2}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          id={id}
          value={value}
          disabled={disabled}
          type={item.type === 'int' ? 'number' : 'text'}
          inputMode={item.type === 'int' ? 'numeric' : undefined}
          min={item.type === 'int' ? 0 : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      )}

      {hint && <small className="cpn-hint">{hint}</small>}
    </div>
  );
}
