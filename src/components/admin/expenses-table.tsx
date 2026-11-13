'use client';

/**
 * Expenses — the client island.
 *
 * Toolbar, table, summary strip and one create/edit drawer. The drawer is opened
 * by the URL (`?new=1`, `?edit=<id>`) for the same reason every other admin
 * drawer is: a half-filled form survives a refresh, and the back button closes it.
 *
 * The summary strip reads the *filtered* total from the API, not a sum computed
 * here. Summing the visible rows would change as the operator paginates, which is
 * how a budget ends up built on the wrong number.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus, Search, Trash2, X } from 'lucide-react';

import { formatMoneyAdmin, toPoisha, toTaka } from '@/lib/format';
import {
  createExpense,
  deleteExpense,
  getExpenseCategories,
  updateExpense,
  type ExpenseItem,
  type ExpenseSort,
  type ExpenseSummary,
  type ExpenseWriteBody,
} from '@/lib/api/admin-expenses';

type Lang = 'en' | 'bn';

function formatDate(iso: string, lang: Lang): string {
  // `iso` is already a calendar day; parse it as UTC so the label cannot slip a
  // day in a negative-offset timezone.
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

const today = (): string => new Date().toISOString().slice(0, 10);

// ─── Toolbar ────────────────────────────────────────────────────────────────

interface ToolbarProps {
  lang: Lang;
  initialQuery: string;
  category: string;
  from: string;
  to: string;
  sort: ExpenseSort;
  categories: string[];
}

export function ExpensesToolbar({
  lang,
  initialQuery,
  category,
  from,
  to,
  sort,
  categories,
}: ToolbarProps) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  function build(overrides: Record<string, string | undefined>): string {
    const next = new URLSearchParams();
    if (category) next.set('category', category);
    if (from) next.set('from', from);
    if (to) next.set('to', to);
    if (sort !== 'newest') next.set('sort', sort);
    const q = overrides.q ?? initialQuery;
    if (q) next.set('q', q);
    for (const [key, value] of Object.entries(overrides)) {
      if (key === 'q') continue;
      if (value === undefined || value === '') next.delete(key);
      else next.set(key, value);
    }
    return `/admin/expenses?${next.toString()}`;
  }

  function onQueryChange(value: string) {
    setQuery(value);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => router.push(build({ q: value || undefined })), 350);
  }

  useEffect(() => () => {
    if (debounce.current) clearTimeout(debounce.current);
  }, []);

  const hasFilters = Boolean(initialQuery || category || from || to);

  return (
    <div className="prod-toolbar ord-toolbar">
      <div className="prod-search">
        <Search size={16} aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={lang === 'bn' ? 'বিবরণ বা খাত' : 'Description or category'}
          aria-label={lang === 'bn' ? 'খরচ খুঁজুন' : 'Search expenses'}
        />
      </div>

      <div className="prod-filters">
        <select
          value={category}
          onChange={(event) => router.push(build({ category: event.target.value || undefined }))}
          aria-label={lang === 'bn' ? 'খাত' : 'Category'}
        >
          <option value="">{lang === 'bn' ? 'সব খাত' : 'All categories'}</option>
          {categories.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>

        <input
          type="date"
          value={from}
          onChange={(event) => router.push(build({ from: event.target.value }))}
          aria-label={lang === 'bn' ? 'শুরুর তারিখ' : 'From date'}
          className="ord-date"
        />
        <input
          type="date"
          value={to}
          onChange={(event) => router.push(build({ to: event.target.value }))}
          aria-label={lang === 'bn' ? 'শেষ তারিখ' : 'To date'}
          className="ord-date"
        />

        <select
          value={sort}
          onChange={(event) => router.push(build({ sort: event.target.value }))}
          aria-label={lang === 'bn' ? 'সাজান' : 'Sort'}
        >
          <option value="newest">{lang === 'bn' ? 'নতুন আগে' : 'Newest first'}</option>
          <option value="oldest">{lang === 'bn' ? 'পুরোনো আগে' : 'Oldest first'}</option>
          <option value="amount_desc">{lang === 'bn' ? 'বেশি টাকা আগে' : 'Highest amount'}</option>
          <option value="amount_asc">{lang === 'bn' ? 'কম টাকা আগে' : 'Lowest amount'}</option>
        </select>

        {hasFilters && (
          <button type="button" className="btn ghost sm" onClick={() => router.push('/admin/expenses')}>
            <X size={14} aria-hidden />
            {lang === 'bn' ? 'মুছুন' : 'Clear'}
          </button>
        )}

        <button type="button" className="btn" onClick={() => router.push(build({ new: '1' }))}>
          <Plus size={16} aria-hidden />
          {lang === 'bn' ? 'নতুন খরচ' : 'Add expense'}
        </button>
      </div>
    </div>
  );
}

// ─── Summary strip ──────────────────────────────────────────────────────────

export function ExpenseSummaryStrip({ lang, summary }: { lang: Lang; summary: ExpenseSummary }) {
  return (
    <div className="exp-summary">
      <div className="exp-summary-total">
        <span>{lang === 'bn' ? 'মোট খরচ' : 'Total'}</span>
        <b>{formatMoneyAdmin(summary.totalPoisha)}</b>
        <small>
          {formatDate(summary.from, lang)} — {formatDate(summary.to, lang)} · {summary.count}{' '}
          {lang === 'bn' ? 'টি' : 'entries'}
        </small>
      </div>

      {summary.byCategory.slice(0, 4).map((row) => (
        <div key={row.category} className="exp-summary-item">
          <span>{row.category}</span>
          <b>{formatMoneyAdmin(row.totalPoisha)}</b>
          <small>{row.count}</small>
        </div>
      ))}
    </div>
  );
}

// ─── Table ──────────────────────────────────────────────────────────────────

interface TableProps {
  lang: Lang;
  items: ExpenseItem[];
  total: number;
  page: number;
  totalPages: number;
  prevHref: string | null;
  nextHref: string | null;
  queryString: string;
  openNew: boolean;
  editId: string | null;
  categories: string[];
}

export function ExpensesTable({
  lang,
  items,
  total,
  page,
  totalPages,
  prevHref,
  nextHref,
  queryString,
  openNew,
  editId,
  categories,
}: TableProps) {
  const router = useRouter();
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const editing = editId ? (items.find((row) => row.id === editId) ?? null) : null;

  function close(): void {
    const next = new URLSearchParams(queryString);
    next.delete('new');
    next.delete('edit');
    router.push(`/admin/expenses?${next.toString()}`);
  }

  async function remove(row: ExpenseItem): Promise<void> {
    try {
      await deleteExpense(row.id);
      setPendingDelete(null);
      setNotice({
        text: lang === 'bn' ? 'খরচ মুছে ফেলা হয়েছে' : 'Expense deleted',
        tone: 'ok',
      });
      router.refresh();
    } catch (error) {
      setPendingDelete(null);
      setNotice({ text: (error as Error).message, tone: 'error' });
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

      <div className="card">
        <div className="table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th scope="col">{lang === 'bn' ? 'তারিখ' : 'Date'}</th>
                <th scope="col">{lang === 'bn' ? 'খাত' : 'Category'}</th>
                <th scope="col">{lang === 'bn' ? 'বিবরণ' : 'Description'}</th>
                <th scope="col">{lang === 'bn' ? 'টাকা' : 'Amount'}</th>
                <th scope="col">{lang === 'bn' ? 'কাজ' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id}>
                  <td data-label={lang === 'bn' ? 'তারিখ' : 'Date'}>{formatDate(row.date, lang)}</td>
                  <td data-label={lang === 'bn' ? 'খাত' : 'Category'}>
                    <span className="badge info">{row.category}</span>
                  </td>
                  <td data-label={lang === 'bn' ? 'বিবরণ' : 'Description'}>
                    {row.description}
                    {row.receiptUrl && (
                      <a
                        className="cpn-sub"
                        href={row.receiptUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {lang === 'bn' ? 'রসিদ' : 'receipt'}
                      </a>
                    )}
                  </td>
                  <td data-label={lang === 'bn' ? 'টাকা' : 'Amount'}>
                    <b>{formatMoneyAdmin(row.amountPoisha)}</b>
                  </td>
                  <td data-label={lang === 'bn' ? 'কাজ' : 'Actions'}>
                    <div className="cpn-actions">
                      <button
                        type="button"
                        className="btn ghost sm"
                        onClick={() => {
                          const next = new URLSearchParams(queryString);
                          next.delete('new');
                          next.set('edit', row.id);
                          router.push(`/admin/expenses?${next.toString()}`);
                        }}
                      >
                        <Pencil size={14} aria-hidden />
                        {lang === 'bn' ? 'সম্পাদনা' : 'Edit'}
                      </button>

                      {pendingDelete === row.id ? (
                        <>
                          <button type="button" className="btn sm" onClick={() => void remove(row)}>
                            {lang === 'bn' ? 'নিশ্চিত মুছুন' : 'Confirm delete'}
                          </button>
                          <button
                            type="button"
                            className="btn ghost sm"
                            onClick={() => setPendingDelete(null)}
                          >
                            {lang === 'bn' ? 'বাতিল' : 'Cancel'}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="btn ghost sm"
                          onClick={() => setPendingDelete(row.id)}
                          aria-label={lang === 'bn' ? 'মুছুন' : 'Delete'}
                        >
                          <Trash2 size={14} aria-hidden />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="prod-pager">
          <span>
            {lang === 'bn'
              ? `${total}টি · পৃষ্ঠা ${page}/${totalPages}`
              : `${total} total · page ${page} of ${totalPages}`}
          </span>
          <div>
            {prevHref ? (
              <a className="btn ghost sm" href={prevHref}>
                {lang === 'bn' ? 'আগের' : 'Previous'}
              </a>
            ) : null}
            {nextHref ? (
              <a className="btn ghost sm" href={nextHref}>
                {lang === 'bn' ? 'পরের' : 'Next'}
              </a>
            ) : null}
          </div>
        </div>
      </div>

      {(openNew || editing) && (
        <ExpenseDrawer
          lang={lang}
          expense={editing}
          categories={categories}
          onClose={close}
          onSaved={(message) => {
            setNotice({ text: message, tone: 'ok' });
            close();
            router.refresh();
          }}
        />
      )}
    </>
  );
}

// ─── Drawer ─────────────────────────────────────────────────────────────────

function ExpenseDrawer({
  lang,
  expense,
  categories,
  onClose,
  onSaved,
}: {
  lang: Lang;
  expense: ExpenseItem | null;
  categories: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [category, setCategory] = useState(expense?.category ?? '');
  const [description, setDescription] = useState(expense?.description ?? '');
  const [amount, setAmount] = useState(expense ? String(toTaka(expense.amountPoisha)) : '');
  const [date, setDate] = useState(expense?.date ?? today());
  const [receiptUrl, setReceiptUrl] = useState(expense?.receiptUrl ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    setSaving(true);
    setError(null);

    const body: ExpenseWriteBody = {
      category: category.trim(),
      description: description.trim(),
      amountPoisha: toPoisha(Number(amount) || 0),
      date,
      receiptUrl: receiptUrl.trim() || null,
    };

    try {
      if (expense) {
        await updateExpense(expense.id, body);
        onSaved(lang === 'bn' ? 'খরচ সংরক্ষিত' : 'Expense saved');
      } else {
        await createExpense(body);
        onSaved(lang === 'bn' ? 'খরচ যোগ হয়েছে' : 'Expense added');
      }
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const valid = category.trim().length > 0 && description.trim().length > 0 && Number(amount) > 0;

  return (
    <div className="overlay side open" onClick={onClose}>
      <div
        className="drawer cpn-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={expense ? 'Edit expense' : 'New expense'}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="drawer-head">
          <h2>
            {expense
              ? lang === 'bn'
                ? 'খরচ সম্পাদনা'
                : 'Edit expense'
              : lang === 'bn'
                ? 'নতুন খরচ'
                : 'New expense'}
          </h2>
          <button type="button" className="x" onClick={onClose} aria-label="Close">
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
            <span>{lang === 'bn' ? 'খাত' : 'Category'}</span>
            <input
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              list="expense-categories"
              placeholder="Courier, Rent, Salary…"
              maxLength={60}
            />
            <datalist id="expense-categories">
              {categories.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          </label>

          <label className="field">
            <span>{lang === 'bn' ? 'বিবরণ' : 'Description'}</span>
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={lang === 'bn' ? 'কী জন্য খরচ' : 'What was it for'}
              maxLength={300}
            />
          </label>

          <div className="field-row">
            <label className="field">
              <span>{lang === 'bn' ? 'টাকা' : 'Amount (৳)'}</span>
              <input
                type="number"
                min={1}
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>

            <label className="field">
              <span>{lang === 'bn' ? 'তারিখ' : 'Date'}</span>
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </label>
          </div>

          <label className="field">
            <span>{lang === 'bn' ? 'রসিদের লিংক (ঐচ্ছিক)' : 'Receipt link (optional)'}</span>
            <input
              value={receiptUrl}
              onChange={(event) => setReceiptUrl(event.target.value)}
              placeholder="https://…"
            />
            <small className="cpn-hint">
              {lang === 'bn'
                ? 'ফাইল আপলোড নেই — Drive বা অন্য লিংক দিন।'
                : 'No upload storage — paste a Drive or other link.'}
            </small>
          </label>
        </div>

        <div className="drawer-foot">
          <button type="button" className="btn ghost" onClick={onClose}>
            {lang === 'bn' ? 'বাতিল' : 'Cancel'}
          </button>
          <button type="button" className="btn" onClick={() => void save()} disabled={saving || !valid}>
            {saving ? (lang === 'bn' ? 'সংরক্ষণ…' : 'Saving…') : lang === 'bn' ? 'সংরক্ষণ' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
