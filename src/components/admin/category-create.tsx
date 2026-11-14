'use client';

/**
 * "New category" — the button and its drawer.
 *
 * ── Why this is a separate island ──────────────────────────────────────────
 *
 * The categories page is a server component that renders a tree; the tree is
 * built for reordering and toggling, not for creating. Rather than grow it, this
 * sits in the page header with its own form and calls the same
 * `POST /admin/categories` the API has always had — the endpoint existed and had
 * no caller, which is why the panel could show 98 categories and not let you add
 * the 99th.
 *
 * State is local, not URL-driven: a create form that closes on refresh is the
 * right trade for a three-field dialog, and it avoids the empty-state trap the
 * suppliers page fell into.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, X } from 'lucide-react';

import { adminFetch } from '@/lib/api/admin-client';
import type { CategoryTreeNode } from './categories-tree';

type Lang = 'en' | 'bn';

/** `My New Category!` -> `my-new-category`. Matches the API's slug rule. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function NewCategoryButton({
  lang,
  roots,
  canWrite,
}: {
  lang: Lang;
  roots: CategoryTreeNode[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [nameEn, setNameEn] = useState('');
  const [nameBn, setNameBn] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [parentId, setParentId] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset(): void {
    setNameEn('');
    setNameBn('');
    setSlug('');
    setSlugTouched(false);
    setParentId('');
    setIsActive(true);
    setError(null);
  }

  function close(): void {
    setOpen(false);
    reset();
  }

  const effectiveSlug = slugTouched ? slug : slugify(nameEn);

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await adminFetch('/admin/categories', {
        method: 'POST',
        body: {
          slug: effectiveSlug,
          nameEn: nameEn.trim(),
          nameBn: (nameBn.trim() || nameEn).trim(),
          parentId: parentId || null,
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
        {lang === 'bn' ? 'নতুন ক্যাটাগরি' : 'New category'}
      </button>

      {open && (
        <div className="overlay side open" onClick={close}>
          <div
            className="drawer cpn-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={lang === 'bn' ? 'নতুন ক্যাটাগরি' : 'New category'}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="drawer-head">
              <h2>{lang === 'bn' ? 'নতুন ক্যাটাগরি' : 'New category'}</h2>
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
                <input
                  value={nameBn}
                  onChange={(event) => setNameBn(event.target.value)}
                  maxLength={80}
                  placeholder={lang === 'bn' ? 'খালি রাখলে ইংরেজি নামটি ব্যবহার হবে' : 'Falls back to the English name'}
                />
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
                  placeholder="my-new-category"
                />
              </label>

              <label className="field">
                <span>{lang === 'bn' ? 'মূল ক্যাটাগরি' : 'Parent'}</span>
                <select value={parentId} onChange={(event) => setParentId(event.target.value)}>
                  <option value="">{lang === 'bn' ? 'কোনোটি নয় (মূল)' : 'None (top level)'}</option>
                  {roots.map((root) => (
                    <option key={root.id} value={root.id}>
                      {lang === 'bn' ? root.nameBn : root.nameEn}
                    </option>
                  ))}
                </select>
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
