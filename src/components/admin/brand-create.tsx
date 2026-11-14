'use client';

/**
 * "New brand" — the button and its drawer.
 *
 * Same reasoning as `category-create.tsx`: `POST /admin/brands` has existed since
 * Phase 10 and had no caller, so the Brands screen could list 25 brands and not
 * add a 26th.
 *
 * The logo field is a URL, not an upload — there is no file storage in this
 * project (README, "Limitations"), and a file picker that silently does nothing
 * would be worse than a text box that says so.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, X } from 'lucide-react';

import { adminFetch } from '@/lib/api/admin-client';

type Lang = 'en' | 'bn';

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function NewBrandButton({ lang, canWrite }: { lang: Lang; canWrite: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [nameEn, setNameEn] = useState('');
  const [nameBn, setNameBn] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [taglineEn, setTaglineEn] = useState('');
  const [logo, setLogo] = useState('');
  const [isOwnBrand, setIsOwnBrand] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveSlug = slugTouched ? slug : slugify(nameEn);

  function close(): void {
    setOpen(false);
    setNameEn('');
    setNameBn('');
    setSlug('');
    setSlugTouched(false);
    setTaglineEn('');
    setLogo('');
    setIsOwnBrand(false);
    setIsActive(true);
    setError(null);
  }

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await adminFetch('/admin/brands', {
        method: 'POST',
        body: {
          slug: effectiveSlug,
          nameEn: nameEn.trim(),
          nameBn: (nameBn.trim() || nameEn).trim(),
          ...(taglineEn.trim() ? { taglineEn: taglineEn.trim() } : {}),
          ...(logo.trim() ? { logo: logo.trim() } : {}),
          isOwnBrand,
          isActive,
        },
      });
      close();
      router.refresh();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!canWrite) return null;

  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        <Plus size={16} aria-hidden />
        {lang === 'bn' ? 'নতুন ব্র্যান্ড' : 'New brand'}
      </button>

      {open && (
        <div className="overlay side open" onClick={close}>
          <div
            className="drawer cpn-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={lang === 'bn' ? 'নতুন ব্র্যান্ড' : 'New brand'}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="drawer-head">
              <h2>{lang === 'bn' ? 'নতুন ব্র্যান্ড' : 'New brand'}</h2>
              <button type="button" className="x" onClick={close} aria-label="Close">
                <X size={18} aria-hidden />
              </button>
            </div>

            <div className="drawer-body">
              {error && (
                <div className="ord-notice is-error" role="alert">
                  <span>{error}</span>
                </div>
              )}

              <label className="field">
                <span>{lang === 'bn' ? 'নাম (ইংরেজি)' : 'Name (English)'}</span>
                <input
                  value={nameEn}
                  onChange={(event) => setNameEn(event.target.value)}
                  maxLength={80}
                  autoFocus
                />
              </label>

              <label className="field">
                <span>{lang === 'bn' ? 'নাম (বাংলা)' : 'Name (Bangla)'}</span>
                <input value={nameBn} onChange={(event) => setNameBn(event.target.value)} maxLength={80} />
              </label>

              <label className="field">
                <span>{lang === 'bn' ? 'স্লাগ' : 'Slug'}</span>
                <input
                  value={effectiveSlug}
                  onChange={(event) => {
                    setSlugTouched(true);
                    setSlug(event.target.value);
                  }}
                  maxLength={80}
                  placeholder="my-brand"
                />
              </label>

              <label className="field">
                <span>{lang === 'bn' ? 'ট্যাগলাইন' : 'Tagline'}</span>
                <input value={taglineEn} onChange={(event) => setTaglineEn(event.target.value)} maxLength={160} />
              </label>

              <label className="field">
                <span>{lang === 'bn' ? 'লোগো URL' : 'Logo URL'}</span>
                <input
                  value={logo}
                  onChange={(event) => setLogo(event.target.value)}
                  maxLength={500}
                  placeholder="/brand/logo.png"
                />
                <small className="cpn-hint">
                  {lang === 'bn'
                    ? 'ফাইল আপলোড নেই — পাথ বা লিংক দিন।'
                    : 'No upload storage — paste a path or a link.'}
                </small>
              </label>

              <label className="cpn-switch">
                <input
                  type="checkbox"
                  checked={isOwnBrand}
                  onChange={(event) => setIsOwnBrand(event.target.checked)}
                />
                <span>{lang === 'bn' ? 'নিজস্ব ব্র্যান্ড' : 'Own brand'}</span>
              </label>

              <label className="cpn-switch">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(event) => setIsActive(event.target.checked)}
                />
                <span>{lang === 'bn' ? 'সক্রিয়' : 'Active'}</span>
              </label>
            </div>

            <div className="drawer-foot">
              <button type="button" className="btn ghost" onClick={close} disabled={busy}>
                {lang === 'bn' ? 'বাতিল' : 'Cancel'}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => void save()}
                disabled={busy || nameEn.trim().length < 2 || effectiveSlug.length < 2}
              >
                {busy ? (lang === 'bn' ? 'সংরক্ষণ…' : 'Saving…') : lang === 'bn' ? 'তৈরি করুন' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
