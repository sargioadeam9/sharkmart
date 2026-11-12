'use client';

/**
 * The product editor — one client component for both `/new` and `/[id]`.
 *
 * ── Why one component ──────────────────────────────────────────────────────
 *
 * Create and edit are the same form with a different submit. Splitting them
 * would duplicate every section and let the two drift, which is how a field ends
 * up editable on create and silently dropped on update.
 *
 * ── Money ──────────────────────────────────────────────────────────────────
 *
 * The wire and the database carry integer poisha. The inputs are in taka,
 * because that is what an operator types. `toPoisha`/`toTaka` convert at the
 * boundary and nowhere else, and every displayed figure goes through
 * `formatMoneyAdmin` (en-IN lakh grouping) — never `formatMoney`, which is the
 * storefront's convention and reads wrong at lakh scale.
 *
 * ── What is NOT editable here ──────────────────────────────────────────────
 *
 * Publish state. Publishing has preconditions (name, category, price, image) and
 * its own endpoint, so it is a button in the publish panel, not a checkbox in
 * the form. A checkbox would let the operator "save" a published product that
 * the API then refuses, with the form showing it as saved.
 */

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, ImagePlus, Plus, Star, Trash2 } from 'lucide-react';

import { formatMoneyAdmin, toPoisha, toTaka } from '@/lib/format';
import {
  addImage,
  archiveProduct,
  createProduct,
  createVariant,
  deleteImage,
  deleteProduct,
  deleteVariant,
  reorderImages,
  setPublished,
  updateImage,
  updateProduct,
  updateVariant,
  type AdminProductDetail,
  type ProductFormOptions,
  type ProductWritePayload,
} from '@/lib/api/admin-products';

type Lang = 'en' | 'bn';

interface EditorProps {
  lang: Lang;
  /** Null on `/new`. */
  product: AdminProductDetail | null;
  options: ProductFormOptions;
}

/** The form's own state. Money is in taka here; converted on submit. */
interface FormState {
  nameEn: string;
  nameBn: string;
  slug: string;
  slugManual: boolean;
  sku: string;
  barcode: string;
  categoryId: string;
  brandId: string;
  descriptionEn: string;
  descriptionBn: string;
  basePriceTaka: string;
  discountPercent: string;
  originalPriceTaka: string;
  metaTitleEn: string;
  metaTitleBn: string;
  metaDescEn: string;
  metaDescBn: string;
  isFeatured: boolean;
  isFlashSale: boolean;
  flashSalePriceTaka: string;
  flashSaleStart: string;
  flashSaleEnd: string;
  flashSaleStock: string;
}

/** Lowercase slug from a name — mirrors the server's derivation. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

/** ISO → the `datetime-local` value shape. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** `datetime-local` → ISO, or null when empty. */
function fromLocalInput(value: string): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}

function initialState(product: AdminProductDetail | null): FormState {
  return {
    nameEn: product?.nameEn ?? '',
    nameBn: product?.nameBn ?? '',
    slug: product?.slug ?? '',
    slugManual: Boolean(product?.slug),
    sku: product?.sku ?? '',
    barcode: product?.barcode ?? '',
    categoryId: product?.categoryId ?? '',
    brandId: product?.brandId ?? '',
    descriptionEn: product?.descriptionEn ?? '',
    descriptionBn: product?.descriptionBn ?? '',
    basePriceTaka: product ? String(toTaka(product.basePricePoisha)) : '',
    discountPercent: product ? String(product.discountPercent) : '0',
    originalPriceTaka: product ? String(toTaka(product.originalPricePoisha)) : '0',
    metaTitleEn: product?.metaTitleEn ?? '',
    metaTitleBn: product?.metaTitleBn ?? '',
    metaDescEn: product?.metaDescEn ?? '',
    metaDescBn: product?.metaDescBn ?? '',
    isFeatured: product?.isFeatured ?? false,
    isFlashSale: product?.isFlashSale ?? false,
    flashSalePriceTaka: product?.flashSalePricePoisha
      ? String(toTaka(product.flashSalePricePoisha))
      : '',
    flashSaleStart: toLocalInput(product?.flashSaleStart ?? null),
    flashSaleEnd: toLocalInput(product?.flashSaleEnd ?? null),
    flashSaleStock: product?.flashSaleStock !== null && product?.flashSaleStock !== undefined
      ? String(product.flashSaleStock)
      : '',
  };
}

export function ProductEditor({ lang, product, options }: EditorProps) {
  const router = useRouter();
  const isNew = product === null;

  const [form, setForm] = useState<FormState>(() => initialState(product));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  /** The live record, so image and variant writes can update it in place. */
  const [record, setRecord] = useState<AdminProductDetail | null>(product);

  const [imageUrl, setImageUrl] = useState('');
  const [imageBusy, setImageBusy] = useState(false);

  const [variantDraft, setVariantDraft] = useState({
    sku: '',
    nameEn: '',
    nameBn: '',
    priceTaka: '',
    stock: '0',
  });

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  /** nameEn drives the slug until the operator takes it over. */
  function onNameEnChange(value: string) {
    setForm((previous) => ({
      ...previous,
      nameEn: value,
      slug: previous.slugManual ? previous.slug : slugify(value),
    }));
  }

  /** The customer's price, computed for display only — the server is authoritative. */
  const customerPaysPoisha = useMemo(() => {
    const base = Number(form.basePriceTaka);
    if (!Number.isFinite(base) || base <= 0) return null;
    return toPoisha(base);
  }, [form.basePriceTaka]);

  const discountPreview = useMemo(() => {
    const base = Number(form.basePriceTaka);
    const percent = Number(form.discountPercent);
    if (!Number.isFinite(base) || base <= 0) return null;
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return null;
    return toPoisha(base * (1 - percent / 100));
  }, [form.basePriceTaka, form.discountPercent]);

  /** Builds the payload. Only fields the operator actually filled are sent. */
  const buildPayload = useCallback((): ProductWritePayload => {
    const payload: ProductWritePayload = {
      nameEn: form.nameEn.trim(),
      nameBn: form.nameBn.trim(),
      sku: form.sku.trim(),
      categoryId: form.categoryId,
      basePricePoisha: toPoisha(Number(form.basePriceTaka) || 0),
      discountPercent: Number(form.discountPercent) || 0,
      originalPricePoisha: toPoisha(Number(form.originalPriceTaka) || 0),
      isFeatured: form.isFeatured,
      isFlashSale: form.isFlashSale,
    };

    if (form.slug.trim()) payload.slug = form.slug.trim();
    if (form.barcode.trim()) payload.barcode = form.barcode.trim();
    if (form.brandId) payload.brandId = form.brandId;
    if (form.descriptionEn.trim()) payload.descriptionEn = form.descriptionEn;
    if (form.descriptionBn.trim()) payload.descriptionBn = form.descriptionBn;
    if (form.metaTitleEn.trim()) payload.metaTitleEn = form.metaTitleEn;
    if (form.metaTitleBn.trim()) payload.metaTitleBn = form.metaTitleBn;
    if (form.metaDescEn.trim()) payload.metaDescEn = form.metaDescEn;
    if (form.metaDescBn.trim()) payload.metaDescBn = form.metaDescBn;

    if (form.isFlashSale) {
      if (form.flashSalePriceTaka) {
        payload.flashSalePricePoisha = toPoisha(Number(form.flashSalePriceTaka));
      }
      if (form.flashSaleStart) payload.flashSaleStart = fromLocalInput(form.flashSaleStart);
      if (form.flashSaleEnd) payload.flashSaleEnd = fromLocalInput(form.flashSaleEnd);
      if (form.flashSaleStock) payload.flashSaleStock = Number(form.flashSaleStock);
    }

    return payload;
  }, [form]);

  async function onSave() {
    setSaving(true);
    setError(null);
    setFieldErrors({});

    try {
      const payload = buildPayload();

      if (isNew) {
        const created = await createProduct(payload);
        setRecord(created);
        setNotice(
          lang === 'bn'
            ? 'খসড়া তৈরি হয়েছে। ছবি যোগ করে প্রকাশ করুন।'
            : 'Draft created. Add an image, then publish.',
        );
        // Replace the URL so a refresh lands on the editor, not a second create.
        router.replace(`/admin/products/${created.id}`);
      } else {
        const updated = await updateProduct(product.id, payload);
        setRecord(updated);
        setNotice(lang === 'bn' ? 'সংরক্ষিত হয়েছে।' : 'Saved.');
      }

      router.refresh();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Save failed.';
      setError(message);

      // A 409 names the field; mark it so the operator sees which one.
      const details = (caught as { details?: unknown }).details;
      if (details && typeof details === 'object' && 'field' in details) {
        setFieldErrors({ [String((details as { field: unknown }).field)]: message });
      }
    } finally {
      setSaving(false);
    }
  }

  async function onPublish(publish: boolean) {
    if (!record) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await setPublished(record.id, publish);
      setRecord(updated);
      setNotice(
        publish
          ? lang === 'bn'
            ? 'প্রকাশিত হয়েছে।'
            : 'Published.'
          : lang === 'bn'
            ? 'অপ্রকাশিত হয়েছে।'
            : 'Unpublished.',
      );
      router.refresh();
    } catch (caught) {
      // A 422 lists every missing requirement; show them all.
      const details = (caught as { details?: unknown }).details;
      if (Array.isArray(details)) {
        setError(
          details
            .map((item: { message?: string }) => item.message)
            .filter(Boolean)
            .join(' '),
        );
      } else {
        setError(caught instanceof Error ? caught.message : 'Publish failed.');
      }
    } finally {
      setSaving(false);
    }
  }

  async function onAddImage() {
    if (!record || !imageUrl.trim()) return;
    setImageBusy(true);
    setError(null);
    try {
      const updated = await addImage(record.id, { url: imageUrl.trim() });
      setRecord(updated);
      setImageUrl('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not add the image.');
    } finally {
      setImageBusy(false);
    }
  }

  async function onMoveImage(index: number, direction: -1 | 1) {
    if (!record) return;
    const next = [...record.images];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;

    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);

    setImageBusy(true);
    try {
      setRecord(await reorderImages(record.id, next.map((image) => image.id)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Reorder failed.');
    } finally {
      setImageBusy(false);
    }
  }

  async function onSetMain(imageId: string) {
    if (!record) return;
    setImageBusy(true);
    try {
      setRecord(await updateImage(record.id, imageId, { isMain: true }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not set the main image.');
    } finally {
      setImageBusy(false);
    }
  }

  async function onDeleteImage(imageId: string) {
    if (!record) return;
    setImageBusy(true);
    try {
      setRecord(await deleteImage(record.id, imageId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete the image.');
    } finally {
      setImageBusy(false);
    }
  }

  async function onAddVariant() {
    if (!record) return;
    setImageBusy(true);
    setError(null);
    try {
      const updated = await createVariant(record.id, {
        sku: variantDraft.sku.trim(),
        nameEn: variantDraft.nameEn.trim(),
        nameBn: variantDraft.nameBn.trim(),
        pricePoisha: toPoisha(Number(variantDraft.priceTaka) || 0),
        stock: Number(variantDraft.stock) || 0,
      });
      setRecord(updated);
      setVariantDraft({ sku: '', nameEn: '', nameBn: '', priceTaka: '', stock: '0' });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not add the variant.');
    } finally {
      setImageBusy(false);
    }
  }

  async function onToggleVariant(variantId: string, isActive: boolean) {
    if (!record) return;
    setImageBusy(true);
    try {
      setRecord(await updateVariant(record.id, variantId, { isActive }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update the variant.');
    } finally {
      setImageBusy(false);
    }
  }

  async function onDeleteVariant(variantId: string) {
    if (!record) return;
    setImageBusy(true);
    try {
      setRecord(await deleteVariant(record.id, variantId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete the variant.');
    } finally {
      setImageBusy(false);
    }
  }

  async function onArchive() {
    if (!record) return;
    setSaving(true);
    try {
      setRecord(await archiveProduct(record.id));
      setNotice(lang === 'bn' ? 'সংরক্ষিত হয়েছে।' : 'Archived.');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Archive failed.');
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!record) return;
    setSaving(true);
    try {
      await deleteProduct(record.id);
      router.push('/admin/products');
    } catch (caught) {
      // A 409 means it is in an order; the message already says to archive.
      setError(caught instanceof Error ? caught.message : 'Delete failed.');
      setSaving(false);
    }
  }

  const status = record?.status ?? 'draft';

  return (
    <div className="editor-grid">
      {/* ── Left column: the form ─────────────────────────────────────────── */}
      <div className="editor-main">
        {error && (
          <div className="card editor-alert" role="alert">
            {error}
          </div>
        )}
        {notice && <div className="card editor-notice">{notice}</div>}

        {/* Basics */}
        <section className="card editor-section">
          <h2>{lang === 'bn' ? 'মৌলিক তথ্য' : 'Basics'}</h2>

          <div className="form">
            <label className="field full">
              <span>{lang === 'bn' ? 'নাম (বাংলা)' : 'Name (Bangla)'}</span>
              <input
                value={form.nameBn}
                onChange={(event) => set('nameBn', event.target.value)}
                lang="bn"
              />
            </label>

            <label className={`field full ${fieldErrors.nameEn ? 'err' : ''}`}>
              <span>{lang === 'bn' ? 'নাম (ইংরেজি)' : 'Name (English)'}</span>
              <input value={form.nameEn} onChange={(event) => onNameEnChange(event.target.value)} />
              {fieldErrors.nameEn && <span className="msg">{fieldErrors.nameEn}</span>}
            </label>

            <label className="field">
              <span>
                Slug
                <button
                  type="button"
                  className="editor-link"
                  onClick={() =>
                    setForm((previous) => ({
                      ...previous,
                      slugManual: !previous.slugManual,
                      slug: previous.slugManual ? slugify(previous.nameEn) : previous.slug,
                    }))
                  }
                >
                  {form.slugManual
                    ? lang === 'bn'
                      ? 'স্বয়ংক্রিয়'
                      : 'auto'
                    : lang === 'bn'
                      ? 'নিজে লিখুন'
                      : 'edit'}
                </button>
              </span>
              <input
                value={form.slug}
                onChange={(event) => set('slug', event.target.value)}
                readOnly={!form.slugManual}
                placeholder="auto-from-name"
              />
            </label>

            <label className={`field ${fieldErrors.sku ? 'err' : ''}`}>
              <span>SKU</span>
              <input value={form.sku} onChange={(event) => set('sku', event.target.value)} />
              {fieldErrors.sku && <span className="msg">{fieldErrors.sku}</span>}
            </label>

            <label className="field">
              <span>{lang === 'bn' ? 'বারকোড' : 'Barcode'}</span>
              <input value={form.barcode} onChange={(event) => set('barcode', event.target.value)} />
            </label>

            <label className="field">
              <span>{lang === 'bn' ? 'ক্যাটাগরি' : 'Category'}</span>
              <select
                value={form.categoryId}
                onChange={(event) => set('categoryId', event.target.value)}
              >
                <option value="">{lang === 'bn' ? 'নির্বাচন করুন' : 'Select a category'}</option>
                {options.categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {lang === 'bn' ? category.nameBn : category.nameEn}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>{lang === 'bn' ? 'ব্র্যান্ড' : 'Brand'}</span>
              <select value={form.brandId} onChange={(event) => set('brandId', event.target.value)}>
                <option value="">{lang === 'bn' ? 'কোনো ব্র্যান্ড নেই' : 'No brand'}</option>
                {options.brands.map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {lang === 'bn' ? brand.nameBn : brand.nameEn}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        {/* Pricing */}
        <section className="card editor-section">
          <h2>{lang === 'bn' ? 'মূল্য' : 'Pricing'}</h2>

          <div className="form">
            <label className="field">
              <span>{lang === 'bn' ? 'বেস দাম (৳)' : 'Base price (৳)'}</span>
              <input
                type="number"
                min="0"
                step="1"
                value={form.basePriceTaka}
                onChange={(event) => set('basePriceTaka', event.target.value)}
              />
            </label>

            <label className="field">
              <span>{lang === 'bn' ? 'ছাড় (%)' : 'Discount (%)'}</span>
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                value={form.discountPercent}
                onChange={(event) => set('discountPercent', event.target.value)}
              />
            </label>

            <label className="field">
              <span>{lang === 'bn' ? 'আগের দাম (৳)' : 'Original price (৳)'}</span>
              <input
                type="number"
                min="0"
                step="1"
                value={form.originalPriceTaka}
                onChange={(event) => set('originalPriceTaka', event.target.value)}
              />
            </label>

            <div className="field">
              <span>{lang === 'bn' ? 'গ্রাহক দিবে' : 'Customer pays'}</span>
              <div className="editor-payable">
                {customerPaysPoisha !== null ? formatMoneyAdmin(customerPaysPoisha) : '—'}
                {discountPreview !== null && (
                  <small>
                    {lang === 'bn' ? 'ছাড়ের পর' : 'after discount'}{' '}
                    {formatMoneyAdmin(discountPreview)}
                  </small>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Description */}
        <section className="card editor-section">
          <h2>{lang === 'bn' ? 'বিবরণ' : 'Description'}</h2>

          <div className="form">
            <label className="field full">
              <span>{lang === 'bn' ? 'বিবরণ (বাংলা)' : 'Description (Bangla)'}</span>
              <textarea
                rows={5}
                lang="bn"
                value={form.descriptionBn}
                onChange={(event) => set('descriptionBn', event.target.value)}
              />
            </label>

            <label className="field full">
              <span>{lang === 'bn' ? 'বিবরণ (ইংরেজি)' : 'Description (English)'}</span>
              <textarea
                rows={5}
                value={form.descriptionEn}
                onChange={(event) => set('descriptionEn', event.target.value)}
              />
            </label>
          </div>
        </section>

        {/* Images */}
        <section className="card editor-section">
          <h2>{lang === 'bn' ? 'ছবি' : 'Images'}</h2>

          {!record ? (
            <p className="editor-hint">
              {lang === 'bn'
                ? 'ছবি যোগ করতে আগে পণ্যটি সংরক্ষণ করুন।'
                : 'Save the product first, then add images.'}
            </p>
          ) : (
            <>
              <div className="editor-img-add">
                <input
                  value={imageUrl}
                  onChange={(event) => setImageUrl(event.target.value)}
                  placeholder="https://cdn.example.com/photo.jpg"
                  aria-label={lang === 'bn' ? 'ছবির URL' : 'Image URL'}
                />
                <button
                  type="button"
                  className="btn sm"
                  onClick={onAddImage}
                  disabled={imageBusy || !imageUrl.trim()}
                >
                  <ImagePlus size={14} aria-hidden />
                  {lang === 'bn' ? 'যোগ করুন' : 'Add'}
                </button>
              </div>

              <p className="editor-hint">
                {lang === 'bn'
                  ? 'ছবি URL দিয়ে যোগ হয়। আপলোড এখনো নেই।'
                  : 'Images are added by URL. There is no file upload yet.'}
              </p>

              {record.images.length === 0 ? (
                <p className="editor-hint">
                  {lang === 'bn'
                    ? 'প্রকাশ করতে অন্তত একটি ছবি দরকার।'
                    : 'At least one image is required to publish.'}
                </p>
              ) : (
                <ul className="editor-imgs">
                  {record.images.map((image, index) => (
                    <li key={image.id} className="editor-img">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={image.url} alt={image.altEn ?? ''} />

                      <div className="editor-img-meta">
                        {image.isMain && (
                          <span className="badge ok">
                            {lang === 'bn' ? 'প্রধান' : 'Main'}
                          </span>
                        )}
                        <small className="ellip">{image.url}</small>
                      </div>

                      <div className="editor-img-actions">
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => onMoveImage(index, -1)}
                          disabled={imageBusy || index === 0}
                          aria-label={lang === 'bn' ? 'উপরে নিন' : 'Move up'}
                        >
                          <ArrowUp size={14} aria-hidden />
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => onMoveImage(index, 1)}
                          disabled={imageBusy || index === record.images.length - 1}
                          aria-label={lang === 'bn' ? 'নিচে নিন' : 'Move down'}
                        >
                          <ArrowDown size={14} aria-hidden />
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => onSetMain(image.id)}
                          disabled={imageBusy || image.isMain}
                          aria-label={lang === 'bn' ? 'প্রধান করুন' : 'Set as main'}
                        >
                          <Star size={14} aria-hidden />
                        </button>
                        <button
                          type="button"
                          className="icon-btn danger"
                          onClick={() => onDeleteImage(image.id)}
                          disabled={imageBusy}
                          aria-label={lang === 'bn' ? 'মুছুন' : 'Delete image'}
                        >
                          <Trash2 size={14} aria-hidden />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>

        {/* Variants */}
        <section className="card editor-section">
          <h2>{lang === 'bn' ? 'ভ্যারিয়েন্ট' : 'Variants'}</h2>

          {!record ? (
            <p className="editor-hint">
              {lang === 'bn'
                ? 'ভ্যারিয়েন্ট যোগ করতে আগে পণ্যটি সংরক্ষণ করুন।'
                : 'Save the product first, then add variants.'}
            </p>
          ) : (
            <>
              {record.variants.length > 0 && (
                <div className="table-wrap">
                  <table className="prod-table">
                    <thead>
                      <tr>
                        <th>SKU</th>
                        <th>{lang === 'bn' ? 'নাম' : 'Name'}</th>
                        <th className="num">{lang === 'bn' ? 'দাম' : 'Price'}</th>
                        <th className="num">{lang === 'bn' ? 'স্টক' : 'Stock'}</th>
                        <th>{lang === 'bn' ? 'সক্রিয়' : 'Active'}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {record.variants.map((variant) => (
                        <tr key={variant.id}>
                          <td data-label="SKU">
                            <code className="prod-sku">{variant.sku}</code>
                          </td>
                          <td data-label={lang === 'bn' ? 'নাম' : 'Name'}>
                            {lang === 'bn' ? variant.nameBn : variant.nameEn}
                          </td>
                          <td className="num" data-label={lang === 'bn' ? 'দাম' : 'Price'}>
                            {formatMoneyAdmin(variant.pricePoisha)}
                          </td>
                          <td className="num" data-label={lang === 'bn' ? 'স্টক' : 'Stock'}>
                            {variant.stock}
                          </td>
                          <td data-label={lang === 'bn' ? 'সক্রিয়' : 'Active'}>
                            <input
                              type="checkbox"
                              checked={variant.isActive}
                              onChange={(event) => onToggleVariant(variant.id, event.target.checked)}
                              aria-label={
                                lang === 'bn' ? `${variant.sku} সক্রিয়` : `Activate ${variant.sku}`
                              }
                            />
                          </td>
                          <td>
                            <button
                              type="button"
                              className="icon-btn danger"
                              onClick={() => onDeleteVariant(variant.id)}
                              disabled={imageBusy}
                              aria-label={lang === 'bn' ? 'মুছুন' : 'Delete variant'}
                            >
                              <Trash2 size={14} aria-hidden />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="editor-variant-add">
                <input
                  value={variantDraft.sku}
                  onChange={(event) => setVariantDraft((d) => ({ ...d, sku: event.target.value }))}
                  placeholder="SKU"
                  aria-label="Variant SKU"
                />
                <input
                  value={variantDraft.nameEn}
                  onChange={(event) => setVariantDraft((d) => ({ ...d, nameEn: event.target.value }))}
                  placeholder={lang === 'bn' ? 'নাম (EN)' : 'Name (EN)'}
                  aria-label="Variant name EN"
                />
                <input
                  value={variantDraft.nameBn}
                  lang="bn"
                  onChange={(event) => setVariantDraft((d) => ({ ...d, nameBn: event.target.value }))}
                  placeholder={lang === 'bn' ? 'নাম (বাংলা)' : 'Name (BN)'}
                  aria-label="Variant name BN"
                />
                <input
                  type="number"
                  min="0"
                  value={variantDraft.priceTaka}
                  onChange={(event) =>
                    setVariantDraft((d) => ({ ...d, priceTaka: event.target.value }))
                  }
                  placeholder={lang === 'bn' ? 'দাম (৳)' : 'Price (৳)'}
                  aria-label="Variant price"
                />
                <input
                  type="number"
                  min="0"
                  value={variantDraft.stock}
                  onChange={(event) => setVariantDraft((d) => ({ ...d, stock: event.target.value }))}
                  placeholder={lang === 'bn' ? 'স্টক' : 'Stock'}
                  aria-label="Variant stock"
                />
                <button
                  type="button"
                  className="btn sm"
                  onClick={onAddVariant}
                  disabled={
                    imageBusy ||
                    !variantDraft.sku.trim() ||
                    !variantDraft.nameEn.trim() ||
                    !variantDraft.nameBn.trim()
                  }
                >
                  <Plus size={14} aria-hidden />
                  {lang === 'bn' ? 'যোগ' : 'Add'}
                </button>
              </div>
            </>
          )}
        </section>

        {/* SEO */}
        <section className="card editor-section">
          <h2>SEO</h2>

          <div className="form">
            <label className="field">
              <span>{lang === 'bn' ? 'মেটা টাইটেল (বাংলা)' : 'Meta title (BN)'}</span>
              <input
                value={form.metaTitleBn}
                lang="bn"
                onChange={(event) => set('metaTitleBn', event.target.value)}
              />
            </label>

            <label className="field">
              <span>{lang === 'bn' ? 'মেটা টাইটেল (ইংরেজি)' : 'Meta title (EN)'}</span>
              <input
                value={form.metaTitleEn}
                onChange={(event) => set('metaTitleEn', event.target.value)}
              />
            </label>

            <label className="field full">
              <span>{lang === 'bn' ? 'মেটা বর্ণনা (বাংলা)' : 'Meta description (BN)'}</span>
              <textarea
                rows={2}
                lang="bn"
                value={form.metaDescBn}
                onChange={(event) => set('metaDescBn', event.target.value)}
              />
            </label>

            <label className="field full">
              <span>{lang === 'bn' ? 'মেটা বর্ণনা (ইংরেজি)' : 'Meta description (EN)'}</span>
              <textarea
                rows={2}
                value={form.metaDescEn}
                onChange={(event) => set('metaDescEn', event.target.value)}
              />
            </label>
          </div>
        </section>
      </div>

      {/* ── Right column: publish panel ───────────────────────────────────── */}
      <aside className="editor-side">
        <section className="card editor-section">
          <h2>{lang === 'bn' ? 'প্রকাশ' : 'Publish'}</h2>

          <div className="editor-status">
            <span
              className={`badge ${
                status === 'published' ? 'ok' : status === 'archived' ? 'mute' : 'warn'
              }`}
            >
              {status === 'published'
                ? lang === 'bn'
                  ? 'প্রকাশিত'
                  : 'Published'
                : status === 'archived'
                  ? lang === 'bn'
                    ? 'সংরক্ষিত'
                    : 'Archived'
                  : lang === 'bn'
                    ? 'খসড়া'
                    : 'Draft'}
            </span>
            {record && (
              <small>
                {lang === 'bn' ? 'ছবি' : 'Images'} {record.images.length} ·{' '}
                {lang === 'bn' ? 'ভ্যারিয়েন্ট' : 'Variants'} {record.variants.length}
              </small>
            )}
          </div>

          <button type="button" className="btn" onClick={onSave} disabled={saving}>
            {saving
              ? lang === 'bn'
                ? 'সংরক্ষণ হচ্ছে…'
                : 'Saving…'
              : isNew
                ? lang === 'bn'
                  ? 'খসড়া সংরক্ষণ'
                  : 'Save draft'
                : lang === 'bn'
                  ? 'সংরক্ষণ করুন'
                  : 'Save changes'}
          </button>

          {record && status !== 'archived' && (
            <button
              type="button"
              className="btn ghost"
              onClick={() => onPublish(status !== 'published')}
              disabled={saving}
            >
              {status === 'published'
                ? lang === 'bn'
                  ? 'অপ্রকাশ করুন'
                  : 'Unpublish'
                : lang === 'bn'
                  ? 'প্রকাশ করুন'
                  : 'Publish'}
            </button>
          )}

          {record && (
            <Link href={`/admin/products/${record.id}`} className="btn ghost" prefetch={false}>
              {lang === 'bn' ? 'স্টোরে দেখুন' : 'View on store'}
            </Link>
          )}
        </section>

        <section className="card editor-section">
          <h2>{lang === 'bn' ? 'ফিচার ও ফ্ল্যাশ সেল' : 'Featured & flash sale'}</h2>

          <label className="editor-check">
            <input
              type="checkbox"
              checked={form.isFeatured}
              onChange={(event) => set('isFeatured', event.target.checked)}
            />
            <span>{lang === 'bn' ? 'ফিচার্ড পণ্য' : 'Featured product'}</span>
          </label>

          <label className="editor-check">
            <input
              type="checkbox"
              checked={form.isFlashSale}
              onChange={(event) => set('isFlashSale', event.target.checked)}
            />
            <span>{lang === 'bn' ? 'ফ্ল্যাশ সেলে' : 'In flash sale'}</span>
          </label>

          {form.isFlashSale && (
            <div className="form">
              <label className="field full">
                <span>{lang === 'bn' ? 'ফ্ল্যাশ দাম (৳)' : 'Flash price (৳)'}</span>
                <input
                  type="number"
                  min="0"
                  value={form.flashSalePriceTaka}
                  onChange={(event) => set('flashSalePriceTaka', event.target.value)}
                />
              </label>

              <label className="field full">
                <span>{lang === 'bn' ? 'শুরু' : 'Starts'}</span>
                <input
                  type="datetime-local"
                  value={form.flashSaleStart}
                  onChange={(event) => set('flashSaleStart', event.target.value)}
                />
              </label>

              <label className="field full">
                <span>{lang === 'bn' ? 'শেষ' : 'Ends'}</span>
                <input
                  type="datetime-local"
                  value={form.flashSaleEnd}
                  onChange={(event) => set('flashSaleEnd', event.target.value)}
                />
              </label>

              <label className="field full">
                <span>{lang === 'bn' ? 'ফ্ল্যাশ স্টক' : 'Flash stock'}</span>
                <input
                  type="number"
                  min="0"
                  value={form.flashSaleStock}
                  onChange={(event) => set('flashSaleStock', event.target.value)}
                />
              </label>
            </div>
          )}
        </section>

        {record && (
          <section className="card editor-section">
            <h2>{lang === 'bn' ? 'বিপজ্জনক' : 'Danger zone'}</h2>

            {status !== 'archived' && (
              <button type="button" className="btn ghost" onClick={onArchive} disabled={saving}>
                {lang === 'bn' ? 'সংরক্ষণ করুন (আর্কাইভ)' : 'Archive'}
              </button>
            )}

            <button
              type="button"
              className="btn ghost danger"
              onClick={onDelete}
              disabled={saving}
            >
              {lang === 'bn' ? 'মুছে ফেলুন' : 'Delete'}
            </button>

            <p className="editor-hint">
              {lang === 'bn'
                ? 'অর্ডারে থাকা পণ্য মোছা যায় না — আর্কাইভ করুন।'
                : 'A product in an order cannot be deleted — archive it instead.'}
            </p>
          </section>
        )}
      </aside>
    </div>
  );
}
