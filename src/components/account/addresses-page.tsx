/**
 * `/profile/addresses` — saved addresses.
 *
 * The division → district cascade is the point of this page: a district select
 * is disabled until a division is chosen, and changing the division clears the
 * district. A district from a different division would be accepted by the form
 * and then rejected by nothing — the server stores whatever it is given — so
 * the cascade is the only thing keeping the data coherent.
 *
 * Deleting the default address is allowed; the server promotes the next one.
 * The UI does not try to guess which that will be, it just refetches.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';

import type { AddressDto, AddressInput } from '@/types/account';
import { useLang } from '@/lib/hooks';
import {
  createAddress,
  deleteAddress,
  listAddresses,
  updateAddress,
} from '@/lib/api/account';
import { isValidBdPhone, normaliseBdPhone, required } from '@/lib/account-validation';
import {
  DIVISIONS,
  areaSuggestions,
  districtsOf,
  divisionLabel,
  districtLabel,
} from '@/lib/geo';
import { toast } from '@/components/shared/toast';
import { EmptyState } from '@/components/shared/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Field, SelectField, TextAreaField, FormAlert } from '@/components/account/form-fields';
import { AccountNav } from '@/components/account/account-nav';
import { cn } from '@/lib/utils';

interface FormState {
  label: string;
  recipientName: string;
  phone: string;
  division: string;
  district: string;
  area: string;
  address: string;
  postalCode: string;
  isDefault: boolean;
}

const EMPTY: FormState = {
  label: '',
  recipientName: '',
  phone: '',
  division: '',
  district: '',
  area: '',
  address: '',
  postalCode: '',
  isDefault: false,
};

export function AddressesPage() {
  const { lang, tu } = useLang();

  const [addresses, setAddresses] = useState<AddressDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    try {
      setAddresses(await listAddresses());
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * `loading` starts true, so there is nothing to set before the first fetch.
   * The fetch is inlined rather than calling `load()` because the rule cannot
   * see through a callback and treats the call as a synchronous setState.
   */
  useEffect(() => {
    let cancelled = false;

    listAddresses()
      .then((next) => {
        if (cancelled) return;
        setAddresses(next);
        setFailed(false);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const resetForm = useCallback(() => {
    setForm(EMPTY);
    setErrors({});
    setFormError(null);
    setEditingId(null);
    setShowForm(false);
  }, []);

  const startEdit = useCallback((address: AddressDto) => {
    setForm({
      label: address.label ?? '',
      recipientName: address.recipientName,
      phone: address.phone,
      division: address.division,
      district: address.district,
      area: address.area,
      address: address.address,
      postalCode: address.postalCode ?? '',
      isDefault: address.isDefault,
    });
    setEditingId(address.id);
    setShowForm(true);
    setErrors({});
    setFormError(null);
  }, []);

  const validate = useCallback((): boolean => {
    const next: Partial<Record<keyof FormState, string>> = {};

    if (!required(form.recipientName)) next.recipientName = tu('recipientName');
    if (!isValidBdPhone(form.phone)) next.phone = tu('invalidPhone');
    if (!required(form.division)) next.division = tu('selectDivision');
    if (!required(form.district)) next.district = tu('selectDistrict');
    if (!required(form.area)) next.area = tu('area');
    if (!required(form.address)) next.address = tu('addressLine');

    setErrors(next);
    return Object.keys(next).length === 0;
  }, [form, tu]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setFormError(null);
      if (!validate()) return;

      const payload: AddressInput = {
        recipientName: form.recipientName.trim(),
        phone: normaliseBdPhone(form.phone),
        division: form.division,
        district: form.district,
        area: form.area.trim(),
        address: form.address.trim(),
        isDefault: form.isDefault,
        ...(form.label.trim() ? { label: form.label.trim() } : {}),
        ...(form.postalCode.trim() ? { postalCode: form.postalCode.trim() } : {}),
      };

      setSaving(true);
      try {
        if (editingId) {
          await updateAddress(editingId, payload);
        } else {
          await createAddress(payload);
        }
        await load();
        resetForm();
        toast(tu('saved'));
      } catch {
        setFormError(tu('errorBody'));
      } finally {
        setSaving(false);
      }
    },
    [form, validate, editingId, load, resetForm, tu],
  );

  const handleDelete = useCallback(
    async (address: AddressDto) => {
      if (!window.confirm(tu('confirmDeleteAddress'))) return;

      try {
        await deleteAddress(address.id);
        await load();
        toast(tu('saved'));
      } catch {
        toast(tu('errorBody'));
      }
    },
    [load, tu],
  );

  const handleSetDefault = useCallback(
    async (address: AddressDto) => {
      try {
        await updateAddress(address.id, {
          recipientName: address.recipientName,
          phone: address.phone,
          division: address.division,
          district: address.district,
          area: address.area,
          address: address.address,
          isDefault: true,
          ...(address.label ? { label: address.label } : {}),
          ...(address.postalCode ? { postalCode: address.postalCode } : {}),
        });
        await load();
      } catch {
        toast(tu('errorBody'));
      }
    },
    [load, tu],
  );

  const districts = districtsOf(form.division);
  const suggestions = areaSuggestions(form.district);

  return (
    <div className="wrap acct-page">
      <div className="acct-head">
        <h1>{tu('myAddresses')}</h1>
      </div>

      <div className="acct-split">
        <div>
          {loading && <Skeleton className="h-[220px] w-full" />}

          {!loading && failed && (
            <EmptyState
              tone="error"
              title={tu('errorTitle')}
              body={tu('errorBody')}
              action={
                <button type="button" className="btn red" onClick={() => void load()}>
                  {tu('retry')}
                </button>
              }
            />
          )}

          {!loading && !failed && addresses.length === 0 && !showForm && (
            <EmptyState
              tone="empty"
              title={tu('noAddresses')}
              body={tu('noAddressesBody')}
              action={
                <button type="button" className="btn red" onClick={() => setShowForm(true)}>
                  {tu('addAddress')}
                </button>
              }
            />
          )}

          {!loading && !failed && addresses.length > 0 && (
            <div className="acct-panel">
              <div className="acct-panel-head">
                <h2>{tu('myAddresses')}</h2>
                {!showForm && (
                  <button
                    type="button"
                    className="acct-link"
                    onClick={() => {
                      resetForm();
                      setShowForm(true);
                    }}
                    style={{ background: 'none', border: 0, cursor: 'pointer' }}
                  >
                    + {tu('addAddress')}
                  </button>
                )}
              </div>

              <div className="acct-panel-body">
                <div className="acct-address-list">
                  {addresses.map((address) => (
                    <div
                      key={address.id}
                      className={cn('acct-address-card', address.isDefault && 'is-default')}
                    >
                      <div className="acct-address-name">
                        {address.recipientName}
                        {address.label && (
                          <span className="acct-muted">· {address.label}</span>
                        )}
                        {address.isDefault && (
                          <span className="acct-pill">{tu('defaultAddress')}</span>
                        )}
                      </div>

                      <div className="acct-address-body">
                        {address.address}, {address.area},{' '}
                        {districtLabel(address.district, lang)},{' '}
                        {divisionLabel(address.division, lang)}
                        {address.postalCode ? ` — ${address.postalCode}` : ''}
                        <br />
                        {address.phone}
                      </div>

                      <div className="acct-actions" style={{ marginTop: 10 }}>
                        <button
                          type="button"
                          className="acct-link"
                          onClick={() => startEdit(address)}
                          style={{ background: 'none', border: 0, cursor: 'pointer' }}
                        >
                          {tu('editAddress')}
                        </button>

                        {!address.isDefault && (
                          <button
                            type="button"
                            className="acct-link"
                            onClick={() => void handleSetDefault(address)}
                            style={{ background: 'none', border: 0, cursor: 'pointer' }}
                          >
                            {tu('setDefault')}
                          </button>
                        )}

                        <button
                          type="button"
                          className="acct-line-remove"
                          onClick={() => void handleDelete(address)}
                        >
                          {tu('deleteAddress')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {showForm && (
            <div className="acct-panel">
              <div className="acct-panel-head">
                <h2>{editingId ? tu('editAddress') : tu('addAddress')}</h2>
              </div>
              <div className="acct-panel-body">
                <form className="acct-form" onSubmit={handleSubmit} noValidate>
                  {formError && <FormAlert tone="error">{formError}</FormAlert>}

                  <Field
                    label={tu('addressLabel')}
                    value={form.label}
                    onChange={(value) => setForm((prev) => ({ ...prev, label: value }))}
                    placeholder="Home"
                    maxLength={40}
                  />

                  <Field
                    label={tu('recipientName')}
                    value={form.recipientName}
                    onChange={(value) => setForm((prev) => ({ ...prev, recipientName: value }))}
                    autoComplete="name"
                    error={errors.recipientName}
                    required
                  />

                  <Field
                    label={tu('phone')}
                    value={form.phone}
                    onChange={(value) => setForm((prev) => ({ ...prev, phone: value }))}
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="01712345678"
                    hint={tu('phoneHint')}
                    error={errors.phone}
                    required
                  />

                  <SelectField
                    label={tu('division')}
                    value={form.division}
                    onChange={(value) =>
                      setForm((prev) => ({ ...prev, division: value, district: '' }))
                    }
                    options={DIVISIONS.map((division) => ({
                      value: division.value,
                      label: division[lang],
                    }))}
                    placeholder={tu('selectDivision')}
                    error={errors.division}
                    required
                  />

                  <SelectField
                    label={tu('district')}
                    value={form.district}
                    onChange={(value) => setForm((prev) => ({ ...prev, district: value }))}
                    options={districts.map((district) => ({
                      value: district.value,
                      label: district[lang],
                    }))}
                    placeholder={tu('selectDistrict')}
                    error={errors.district}
                    disabled={!form.division}
                    required
                  />

                  <div className="acct-field">
                    <label htmlFor="addr-area" className="acct-label">
                      {tu('area')}
                      <span aria-hidden="true" className="acct-req">
                        *
                      </span>
                    </label>
                    <div className={cn('acct-input-wrap', errors.area && 'has-error')}>
                      <input
                        id="addr-area"
                        className="acct-input"
                        value={form.area}
                        onChange={(event) =>
                          setForm((prev) => ({ ...prev, area: event.target.value }))
                        }
                        list={suggestions.length > 0 ? 'addr-area-suggestions' : undefined}
                        aria-invalid={errors.area ? true : undefined}
                        aria-describedby={errors.area ? 'addr-area-error' : undefined}
                      />
                    </div>
                    {suggestions.length > 0 && (
                      <datalist id="addr-area-suggestions">
                        {suggestions.map((area) => (
                          <option key={area} value={area} />
                        ))}
                      </datalist>
                    )}
                    {errors.area && (
                      <p id="addr-area-error" className="acct-error" role="alert">
                        {errors.area}
                      </p>
                    )}
                  </div>

                  <TextAreaField
                    label={tu('addressLine')}
                    value={form.address}
                    onChange={(value) => setForm((prev) => ({ ...prev, address: value }))}
                    hint={tu('addressLineHint')}
                    error={errors.address}
                    rows={2}
                    required
                  />

                  <Field
                    label={tu('postalCode')}
                    value={form.postalCode}
                    onChange={(value) => setForm((prev) => ({ ...prev, postalCode: value }))}
                    inputMode="numeric"
                    autoComplete="postal-code"
                    maxLength={6}
                  />

                  <label className="acct-option" style={{ padding: 12 }}>
                    <input
                      type="checkbox"
                      checked={form.isDefault}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, isDefault: event.target.checked }))
                      }
                    />
                    <div className="acct-option-body">
                      <div className="acct-option-title">
                        <span>{tu('setDefault')}</span>
                      </div>
                    </div>
                  </label>

                  <div className="acct-actions">
                    <button type="submit" className="btn red" disabled={saving}>
                      {saving ? tu('loading') : tu('saveChanges')}
                    </button>
                    <button type="button" className="btn line" onClick={resetForm}>
                      {tu('close')}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>

        <aside className="acct-aside">
          <AccountNav active="addresses" />
        </aside>
      </div>
    </div>
  );
}
