/**
 * `/checkout` â€” the money path on the client.
 *
 * Four steps on one page, per `frontend.md` Â§6.8: address, delivery, payment,
 * review. The step indicator is navigation, not validation â€” a shopper can jump
 * back to fix an address, but cannot advance past a step whose required fields
 * are empty.
 *
 * Three decisions that matter:
 *
 * 1. **The idempotency key is minted once, when the form mounts, and reused for
 *    every retry of that submission.** A key generated per click would make the
 *    second click a second order â€” the exact bug the header exists to prevent.
 *    It is regenerated only after a *successful* order, so a shopper who lands
 *    back here for a second purchase is not reusing a spent key.
 *
 * 2. **Prices shown are the server's.** For a signed-in shopper the cart comes
 *    from `/cart` and every line carries its live DB price. The review total is
 *    computed from those, and the server recomputes it again â€” the number here
 *    is a preview, never an input.
 *
 * 3. **A guest can check out.** Bangladesh is COD-heavy and forcing an account
 *    loses sales, so an anonymous visitor gets the same flow with a phone
 *    field. What a guest cannot do is use a saved address or a per-user coupon;
 *    the server enforces that and the UI simply does not offer it.
 */

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import type {
  AddressDto,
  CheckoutAddressInput,
  DeliveryMethod,
  PaymentMethod,
  ServerCart,
} from '@/types/account';
import { useLang, useStoreHydrated } from '@/lib/hooks';
import { useCartStore } from '@/lib/store/cart-store';
import { useSessionStore } from '@/lib/store/session-store';
import {
  createAddress,
  getCart,
  listAddresses,
  placeOrder,
} from '@/lib/api/account';
import { deliveryFeePoisha, FREE_DELIVERY_THRESHOLD_POISHA } from '@/lib/commerce';
import { formatMoney } from '@/lib/format';
import {
  isValidBdPhone,
  normaliseBdPhone,
  required,
} from '@/lib/account-validation';
import { DIVISIONS, areaSuggestions, districtsOf, divisionLabel, districtLabel } from '@/lib/geo';
import { localized } from '@/types/catalog';
import { EmptyState } from '@/components/shared/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Field, SelectField, TextAreaField, FormAlert } from '@/components/account/form-fields';
import { cn } from '@/lib/utils';

/** Express surcharge, mirroring `EXPRESS_SURCHARGE_POISHA` on the server. */
const EXPRESS_SURCHARGE_POISHA = 10_000;

type Step = 'address' | 'delivery' | 'payment' | 'review';

const STEPS: Step[] = ['address', 'delivery', 'payment', 'review'];

interface AddressForm {
  recipientName: string;
  phone: string;
  division: string;
  district: string;
  area: string;
  address: string;
  postalCode: string;
}

const EMPTY_ADDRESS: AddressForm = {
  recipientName: '',
  phone: '',
  division: '',
  district: '',
  area: '',
  address: '',
  postalCode: '',
};

export function CheckoutPage() {
  const { lang, t, tu } = useLang();
  const router = useRouter();

  const sessionStatus = useSessionStore((s) => s.status);
  const signedIn = sessionStatus === 'authenticated';

  const localLines = useCartStore((s) => s.lines);
  const clearLocalCart = useCartStore((s) => s.clear);
  const hydrated = useStoreHydrated(useCartStore);

  const [cart, setCart] = useState<ServerCart | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const [savedAddresses, setSavedAddresses] = useState<AddressDto[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string>('');
  const [useNewAddress, setUseNewAddress] = useState(false);
  const [addressForm, setAddressForm] = useState<AddressForm>(EMPTY_ADDRESS);
  const [addressErrors, setAddressErrors] = useState<Partial<Record<keyof AddressForm, string>>>({});

  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('STANDARD');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('COD');
  const [couponCode, setCouponCode] = useState('');
  const [notes, setNotes] = useState('');

  const [step, setStep] = useState<Step>('address');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  /**
   * The idempotency key for THIS submission.
   *
   * `crypto.randomUUID` is available in every browser this storefront supports
   * and in Node 19+, so no polyfill. The fallback exists for an insecure
   * context (plain http on a LAN IP) where `crypto.randomUUID` is undefined.
   */
  const [idempotencyKey, setIdempotencyKey] = useState(() => newIdempotencyKey());

  // â”€â”€ load cart + addresses â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    if (sessionStatus === 'unknown') return;

    let cancelled = false;

    const load = async () => {
      if (signedIn) {
        const [serverCart, addresses] = await Promise.all([getCart(), listAddresses()]);
        if (cancelled) return;

        setCart(serverCart);
        setSavedAddresses(addresses);

        const preferred = addresses.find((a) => a.isDefault) ?? addresses[0];
        if (preferred) {
          setSelectedAddressId(preferred.id);
          setUseNewAddress(false);
        } else {
          setUseNewAddress(true);
        }
      }
      // A guest has no server cart; the local store is the cart.
    };

    load()
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [signedIn, sessionStatus]);

  // â”€â”€ derived money â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /** Lines as the checkout sees them â€” server cart when signed in, else local. */
  const lines = useMemo(() => {
    if (signedIn) return cart?.lines ?? [];
    return localLines.map((line) => ({
      id: `${line.productId}::${line.variantId ?? 'base'}`,
      productId: line.productId,
      variantId: line.variantId,
      quantity: line.quantity,
      slug: line.slug,
      sku: line.sku,
      nameEn: line.nameEn,
      nameBn: line.nameBn,
      imageUrl: line.imageUrl,
      unitPricePoisha: line.unitPricePoisha,
      originalUnitPricePoisha: line.originalUnitPricePoisha,
      stockQuantity: line.stockQuantity,
      insufficientStock: line.quantity > line.stockQuantity,
      unavailable: false,
      variantNameEn: line.variantNameEn,
      variantNameBn: line.variantNameBn,
    }));
  }, [signedIn, cart, localLines]);

  const subtotal = useMemo(
    () => lines.reduce((sum, line) => sum + line.unitPricePoisha * line.quantity, 0),
    [lines],
  );

  const baseDelivery = deliveryFeePoisha(subtotal);
  const delivery =
    deliveryMethod === 'EXPRESS' && subtotal > 0
      ? baseDelivery + EXPRESS_SURCHARGE_POISHA
      : baseDelivery;

  const total = subtotal + delivery;

  const hasIssues = signedIn
    ? Boolean(cart?.hasIssues)
    : lines.some((line) => line.insufficientStock);

  // â”€â”€ address validation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const validateAddress = useCallback((): boolean => {
    if (signedIn && !useNewAddress && selectedAddressId) return true;

    const errors: Partial<Record<keyof AddressForm, string>> = {};

    if (!required(addressForm.recipientName)) errors.recipientName = tu('recipientName');
    if (!isValidBdPhone(addressForm.phone)) errors.phone = tu('invalidPhone');
    if (!required(addressForm.division)) errors.division = tu('selectDivision');
    if (!required(addressForm.district)) errors.district = tu('selectDistrict');
    if (!required(addressForm.area)) errors.area = tu('area');
    if (!required(addressForm.address)) errors.address = tu('addressLine');

    setAddressErrors(errors);
    return Object.keys(errors).length === 0;
  }, [signedIn, useNewAddress, selectedAddressId, addressForm, tu]);

  // â”€â”€ step navigation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const goNext = useCallback(() => {
    setFormError(null);

    if (step === 'address' && !validateAddress()) return;

    const index = STEPS.indexOf(step);
    const nextStep = STEPS[index + 1];
    if (nextStep) setStep(nextStep);
  }, [step, validateAddress]);

  const goBack = useCallback(() => {
    setFormError(null);
    const index = STEPS.indexOf(step);
    const previousStep = STEPS[index - 1];
    if (previousStep) setStep(previousStep);
  }, [step]);

  // â”€â”€ place the order â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const handlePlaceOrder = useCallback(async () => {
    setFormError(null);

    if (lines.length === 0) {
      setFormError(tu('checkoutEmptyCart'));
      return;
    }

    if (hasIssues) {
      setFormError(tu('outOfStockError'));
      return;
    }

    setSubmitting(true);
    try {
      /**
       * A new address is saved to the account first, then referenced by id.
       *
       * Why not send the inline address: a signed-in shopper who typed one
       * expects to find it next time, and `/checkout` accepts `addressId` or
       * an inline `address` but not both. Saving first also means the address
       * is validated by the same endpoint the profile page uses.
       */
      let addressId: string | undefined;
      let inlineAddress: CheckoutAddressInput | undefined;

      if (signedIn && !useNewAddress && selectedAddressId) {
        addressId = selectedAddressId;
      } else if (signedIn) {
        const saved = await createAddress({
          recipientName: addressForm.recipientName.trim(),
          phone: normaliseBdPhone(addressForm.phone),
          division: addressForm.division,
          district: addressForm.district,
          area: addressForm.area.trim(),
          address: addressForm.address.trim(),
          ...(addressForm.postalCode.trim() ? { postalCode: addressForm.postalCode.trim() } : {}),
        });
        addressId = saved.id;
      } else {
        inlineAddress = {
          recipientName: addressForm.recipientName.trim(),
          phone: normaliseBdPhone(addressForm.phone),
          division: addressForm.division,
          district: addressForm.district,
          area: addressForm.area.trim(),
          address: addressForm.address.trim(),
          ...(addressForm.postalCode.trim() ? { postalCode: addressForm.postalCode.trim() } : {}),
        };
      }

      const order = await placeOrder(
        {
          items: lines.map((line) => ({
            productId: line.productId,
            variantId: line.variantId,
            quantity: line.quantity,
          })),
          ...(addressId ? { addressId } : {}),
          ...(inlineAddress ? { address: inlineAddress } : {}),
          deliveryMethod,
          paymentMethod,
          ...(couponCode.trim() ? { couponCode: couponCode.trim() } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
          ...(!signedIn && inlineAddress ? { guestPhone: inlineAddress.phone } : {}),
        },
        idempotencyKey,
      );

      // The local cart is now an order. Clear it and mint a fresh key so a
      // second purchase from this tab is not a replay of the first.
      clearLocalCart();
      setIdempotencyKey(newIdempotencyKey());

      router.push(`/checkout/success?order=${encodeURIComponent(order.orderNumber)}`);
    } catch (error) {
      setFormError(checkoutMessage(error, tu));
    } finally {
      setSubmitting(false);
    }
  }, [
    lines,
    hasIssues,
    signedIn,
    useNewAddress,
    selectedAddressId,
    addressForm,
    deliveryMethod,
    paymentMethod,
    couponCode,
    notes,
    idempotencyKey,
    clearLocalCart,
    router,
    tu,
  ]);

  // â”€â”€ states â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  if (loading || sessionStatus === 'unknown' || !hydrated) {
    return (
      <div className="wrap acct-page" aria-busy="true">
        <Skeleton className="h-[360px] w-full" />
      </div>
    );
  }

  if (loadFailed) {
    return (
      <div className="wrap acct-page">
        <EmptyState
          tone="error"
          title={tu('errorTitle')}
          body={tu('errorBody')}
          action={
            <button type="button" className="btn red" onClick={() => window.location.reload()}>
              {tu('retry')}
            </button>
          }
        />
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <div className="wrap acct-page">
        <EmptyState
          tone="empty"
          title={tu('cartEmpty')}
          body={tu('checkoutEmptyCart')}
          action={
            <Link className="btn red" href="/">
              {tu('continueShopping')}
            </Link>
          }
        />
      </div>
    );
  }

  const stepIndex = STEPS.indexOf(step);
  const stepLabels: Record<Step, string> = {
    address: tu('stepAddress'),
    delivery: tu('stepDelivery'),
    payment: tu('stepPayment'),
    review: tu('stepReview'),
  };

  return (
    <div className="wrap acct-page">
      <div className="acct-head">
        <h1>{tu('checkoutTitle')}</h1>
      </div>

      {/* â”€â”€ step indicator â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <ol className="acct-steps" aria-label={tu('checkoutTitle')}>
        {STEPS.map((entry, index) => (
          <li
            key={entry}
            className={cn(
              'acct-step',
              index === stepIndex && 'is-active',
              index < stepIndex && 'is-done',
            )}
            aria-current={index === stepIndex ? 'step' : undefined}
          >
            <b aria-hidden="true">{index + 1}</b>
            {stepLabels[entry]}
          </li>
        ))}
      </ol>

      <div className="acct-split">
        <div>
          {formError && (
            <div style={{ marginBottom: 14 }}>
              <FormAlert tone="error">{formError}</FormAlert>
            </div>
          )}

          {/* â”€â”€ 1. address â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
          {step === 'address' && (
            <div className="acct-panel">
              <div className="acct-panel-head">
                <h2>{tu('stepAddress')}</h2>
              </div>
              <div className="acct-panel-body">
                {signedIn && savedAddresses.length > 0 && (
                  <>
                    <div className="acct-address-list">
                      {savedAddresses.map((address) => (
                        <label
                          key={address.id}
                          className={cn(
                            'acct-address-card',
                            !useNewAddress &&
                              selectedAddressId === address.id &&
                              'is-selected',
                            address.isDefault && 'is-default',
                          )}
                        >
                          <div className="acct-address-name">
                            <input
                              type="radio"
                              name="saved-address"
                              checked={!useNewAddress && selectedAddressId === address.id}
                              onChange={() => {
                                setSelectedAddressId(address.id);
                                setUseNewAddress(false);
                              }}
                              style={{ accentColor: 'var(--red)' }}
                            />
                            {address.recipientName}
                            {address.isDefault && (
                              <span className="acct-pill">{tu('defaultAddress')}</span>
                            )}
                          </div>
                          <div className="acct-address-body">
                            {address.address}, {address.area},{' '}
                            {districtLabel(address.district, lang)},{' '}
                            {divisionLabel(address.division, lang)}
                            <br />
                            {address.phone}
                          </div>
                        </label>
                      ))}

                      <label
                        className={cn('acct-address-card', useNewAddress && 'is-selected')}
                      >
                        <div className="acct-address-name">
                          <input
                            type="radio"
                            name="saved-address"
                            checked={useNewAddress}
                            onChange={() => setUseNewAddress(true)}
                            style={{ accentColor: 'var(--red)' }}
                          />
                          {tu('addAddress')}
                        </div>
                      </label>
                    </div>

                    {!useNewAddress && (
                      <div className="acct-actions">
                        <button type="button" className="btn red" onClick={goNext}>
                          {tu('next')} â†’
                        </button>
                      </div>
                    )}
                  </>
                )}

                {(useNewAddress || !signedIn || savedAddresses.length === 0) && (
                  <AddressFields
                    form={addressForm}
                    errors={addressErrors}
                    onChange={(patch) => setAddressForm((prev) => ({ ...prev, ...patch }))}
                    onSubmit={goNext}
                    submitLabel={`${tu('next')} â†’`}
                  />
                )}
              </div>
            </div>
          )}

          {/* â”€â”€ 2. delivery â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
          {step === 'delivery' && (
            <div className="acct-panel">
              <div className="acct-panel-head">
                <h2>{tu('stepDelivery')}</h2>
              </div>
              <div className="acct-panel-body">
                <div className="acct-options">
                  <label
                    className={cn('acct-option', deliveryMethod === 'STANDARD' && 'is-selected')}
                  >
                    <input
                      type="radio"
                      name="delivery"
                      checked={deliveryMethod === 'STANDARD'}
                      onChange={() => setDeliveryMethod('STANDARD')}
                    />
                    <div className="acct-option-body">
                      <div className="acct-option-title">
                        <span>{tu('deliveryStandard')}</span>
                        <em>
                          {baseDelivery ? formatMoney(baseDelivery, lang) : t('free')}
                        </em>
                      </div>
                      <div className="acct-option-note">{tu('deliveryStandardEta')}</div>
                    </div>
                  </label>

                  <label
                    className={cn('acct-option', deliveryMethod === 'EXPRESS' && 'is-selected')}
                  >
                    <input
                      type="radio"
                      name="delivery"
                      checked={deliveryMethod === 'EXPRESS'}
                      onChange={() => setDeliveryMethod('EXPRESS')}
                    />
                    <div className="acct-option-body">
                      <div className="acct-option-title">
                        <span>{tu('deliveryExpress')}</span>
                        <em>
                          {formatMoney(baseDelivery + EXPRESS_SURCHARGE_POISHA, lang)}
                        </em>
                      </div>
                      <div className="acct-option-note">{tu('deliveryExpressEta')}</div>
                    </div>
                  </label>
                </div>

                {subtotal < FREE_DELIVERY_THRESHOLD_POISHA && (
                  <p className="acct-muted" style={{ marginTop: 14 }}>
                    {t('moreMsg', {
                      n: Math.round((FREE_DELIVERY_THRESHOLD_POISHA - subtotal) / 100),
                    })}
                  </p>
                )}

                <div className="acct-actions">
                  <button type="button" className="btn line" onClick={goBack}>
                    â† {tu('previous')}
                  </button>
                  <button type="button" className="btn red" onClick={goNext}>
                    {tu('next')} â†’
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* â”€â”€ 3. payment â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
          {step === 'payment' && (
            <div className="acct-panel">
              <div className="acct-panel-head">
                <h2>{tu('stepPayment')}</h2>
              </div>
              <div className="acct-panel-body">
                <div className="acct-options">
                  {(
                    [
                      ['COD', tu('paymentCod'), tu('paymentCodBody')],
                      ['BKASH', tu('paymentBkash'), tu('paymentMobileBody')],
                      ['NAGAD', tu('paymentNagad'), tu('paymentMobileBody')],
                      ['SSLCOMMERZ', tu('paymentCard'), tu('paymentMobileBody')],
                    ] as Array<[PaymentMethod, string, string]>
                  ).map(([value, title, note]) => (
                    <label
                      key={value}
                      className={cn('acct-option', paymentMethod === value && 'is-selected')}
                    >
                      <input
                        type="radio"
                        name="payment"
                        checked={paymentMethod === value}
                        onChange={() => setPaymentMethod(value)}
                      />
                      <div className="acct-option-body">
                        <div className="acct-option-title">
                          <span>{title}</span>
                        </div>
                        <div className="acct-option-note">{note}</div>
                      </div>
                    </label>
                  ))}
                </div>

                <div className="acct-actions">
                  <button type="button" className="btn line" onClick={goBack}>
                    â† {tu('previous')}
                  </button>
                  <button type="button" className="btn red" onClick={goNext}>
                    {tu('next')} â†’
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* â”€â”€ 4. review â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
          {step === 'review' && (
            <>
              <div className="acct-panel">
                <div className="acct-panel-head">
                  <h2>{tu('reviewItems')}</h2>
                  <span className="acct-muted">
                    {lines.length} {tu('items')}
                  </span>
                </div>

                {lines.map((line) => (
                  <div key={line.id} className="acct-line">
                    <div className="acct-line-img" aria-hidden="true">
                      {line.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- data-URI placeholder.
                        <img src={line.imageUrl} alt="" loading="lazy" />
                      ) : (
                        'ðŸ›ï¸'
                      )}
                    </div>
                    <div>
                      <div className="acct-line-name">
                        {localized(lang, line.nameEn, line.nameBn)}
                      </div>
                      {localized(lang, line.variantNameEn, line.variantNameBn) && (
                        <div className="acct-line-variant">
                          {localized(lang, line.variantNameEn, line.variantNameBn)}
                        </div>
                      )}
                      <div className="acct-line-price">
                        {formatMoney(line.unitPricePoisha, lang)} Ã— {line.quantity}
                      </div>
                    </div>
                    <div className="acct-line-right">
                      <span className="acct-line-total">
                        {formatMoney(line.unitPricePoisha * line.quantity, lang)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="acct-panel">
                <div className="acct-panel-head">
                  <h2>{tu('reviewAddress')}</h2>
                  <button
                    type="button"
                    className="acct-link"
                    onClick={() => setStep('address')}
                    style={{ background: 'none', border: 0, cursor: 'pointer' }}
                  >
                    {tu('editAddress')}
                  </button>
                </div>
                <div className="acct-panel-body">
                  <AddressSummary
                    signedIn={signedIn}
                    useNewAddress={useNewAddress}
                    selectedAddressId={selectedAddressId}
                    savedAddresses={savedAddresses}
                    form={addressForm}
                  />

                  <div className="acct-divider" />

                  <div className="acct-rows">
                    <div className="acct-row">
                      <span>{tu('reviewDelivery')}</span>
                      <b>
                        {deliveryMethod === 'EXPRESS'
                          ? tu('deliveryExpress')
                          : tu('deliveryStandard')}
                      </b>
                    </div>
                    <div className="acct-row">
                      <span>{tu('reviewPayment')}</span>
                      <b>
                        {paymentMethod === 'COD'
                          ? tu('paymentCod')
                          : paymentMethod === 'BKASH'
                            ? tu('paymentBkash')
                            : paymentMethod === 'NAGAD'
                              ? tu('paymentNagad')
                              : tu('paymentCard')}
                      </b>
                    </div>
                  </div>

                  <div className="acct-divider" />

                  <TextAreaField
                    label={tu('orderNotes')}
                    value={notes}
                    onChange={setNotes}
                    hint={tu('orderNotesHint')}
                    maxLength={500}
                    rows={2}
                  />
                </div>
              </div>

              <div className="acct-actions">
                <button type="button" className="btn line" onClick={goBack}>
                  â† {tu('previous')}
                </button>
                <button
                  type="button"
                  className="btn red"
                  onClick={() => void handlePlaceOrder()}
                  disabled={submitting || hasIssues}
                >
                  {submitting ? tu('placingOrder') : tu('placeOrder')}
                </button>
              </div>
            </>
          )}
        </div>

        {/* â”€â”€ summary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <aside className="acct-aside">
          <div className="acct-panel">
            <div className="acct-panel-head">
              <h2>{tu('cartSummary')}</h2>
            </div>
            <div className="acct-panel-body">
              <div className="acct-rows">
                <div className="acct-row">
                  <span>{tu('reviewItems')}</span>
                  <b>{formatMoney(subtotal, lang)}</b>
                </div>
                <div className="acct-row">
                  <span>{tu('reviewDelivery')}</span>
                  <b>{delivery ? formatMoney(delivery, lang) : t('free')}</b>
                </div>
                <div className="acct-row acct-row-total">
                  <span>{tu('reviewTotal')}</span>
                  <span>{formatMoney(total, lang)}</span>
                </div>
              </div>

              <div className="acct-divider" />

              <div className="acct-field">
                <label htmlFor="coupon" className="acct-label">
                  {tu('couponCode')}
                </label>
                <div className="acct-inline-form">
                  <input
                    id="coupon"
                    className="acct-input"
                    value={couponCode}
                    onChange={(event) => setCouponCode(event.target.value.toUpperCase())}
                    placeholder="SHARK10"
                    maxLength={40}
                    autoComplete="off"
                  />
                </div>
                {/*
                  No discount preview here on purpose. The coupon is validated
                  server-side at checkout (window, usage cap, per-user limit,
                  minimum order) and the client cannot know any of that without
                  a round-trip. Showing a computed discount the server then
                  disagrees with is worse than showing none: the shopper sees
                  the total jump at the last step. The code is applied and the
                  real total comes back on the order.
                */}
                <p className="acct-hint">{tu('couponApplied')}</p>
              </div>

              {hasIssues && (
                <p className="acct-line-warn" style={{ marginTop: 12 }}>
                  {tu('outOfStockError')}
                </p>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

// â”€â”€â”€ address fields â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function AddressFields({
  form,
  errors,
  onChange,
  onSubmit,
  submitLabel,
}: {
  form: AddressForm;
  errors: Partial<Record<keyof AddressForm, string>>;
  onChange: (patch: Partial<AddressForm>) => void;
  onSubmit: () => void;
  submitLabel: string;
}) {
  const { lang, tu } = useLang();

  const districts = districtsOf(form.division);
  const suggestions = areaSuggestions(form.district);

  return (
    <form
      className="acct-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      noValidate
    >
      <Field
        label={tu('recipientName')}
        value={form.recipientName}
        onChange={(value) => onChange({ recipientName: value })}
        autoComplete="name"
        error={errors.recipientName}
        required
      />

      <Field
        label={tu('phone')}
        value={form.phone}
        onChange={(value) => onChange({ phone: value })}
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
          // Changing the division invalidates the district â€” a district from
          // another division would be rejected by the server, and leaving it
          // selected is a form that looks valid and is not.
          onChange({ division: value, district: '' })
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
        onChange={(value) => onChange({ district: value })}
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
        <label htmlFor="area-input" className="acct-label">
          {tu('area')}
          <span aria-hidden="true" className="acct-req">
            *
          </span>
        </label>
        <div className={cn('acct-input-wrap', errors.area && 'has-error')}>
          <input
            id="area-input"
            className="acct-input"
            value={form.area}
            onChange={(event) => onChange({ area: event.target.value })}
            list={suggestions.length > 0 ? 'area-suggestions' : undefined}
            aria-invalid={errors.area ? true : undefined}
            aria-describedby={errors.area ? 'area-error' : undefined}
          />
        </div>
        {suggestions.length > 0 && (
          <datalist id="area-suggestions">
            {suggestions.map((area) => (
              <option key={area} value={area} />
            ))}
          </datalist>
        )}
        {errors.area && (
          <p id="area-error" className="acct-error" role="alert">
            {errors.area}
          </p>
        )}
      </div>

      <TextAreaField
        label={tu('addressLine')}
        value={form.address}
        onChange={(value) => onChange({ address: value })}
        hint={tu('addressLineHint')}
        error={errors.address}
        rows={2}
        required
      />

      <Field
        label={tu('postalCode')}
        value={form.postalCode}
        onChange={(value) => onChange({ postalCode: value })}
        inputMode="numeric"
        autoComplete="postal-code"
        maxLength={6}
      />

      <button type="submit" className="btn red acct-submit">
        {submitLabel}
      </button>
    </form>
  );
}

function AddressSummary({
  signedIn,
  useNewAddress,
  selectedAddressId,
  savedAddresses,
  form,
}: {
  signedIn: boolean;
  useNewAddress: boolean;
  selectedAddressId: string;
  savedAddresses: AddressDto[];
  form: AddressForm;
}) {
  const { lang } = useLang();

  if (signedIn && !useNewAddress) {
    const address = savedAddresses.find((a) => a.id === selectedAddressId);
    if (!address) return null;

    return (
      <div className="acct-address-body">
        <strong style={{ color: 'var(--navy)' }}>{address.recipientName}</strong>
        <br />
        {address.address}, {address.area}, {districtLabel(address.district, lang)},{' '}
        {divisionLabel(address.division, lang)}
        {address.postalCode ? ` â€” ${address.postalCode}` : ''}
        <br />
        {address.phone}
      </div>
    );
  }

  return (
    <div className="acct-address-body">
      <strong style={{ color: 'var(--navy)' }}>{form.recipientName}</strong>
      <br />
      {form.address}, {form.area}, {districtLabel(form.district, lang)},{' '}
      {divisionLabel(form.division, lang)}
      {form.postalCode ? ` â€” ${form.postalCode}` : ''}
      <br />
      {form.phone}
    </div>
  );
}

// â”€â”€â”€ helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Insecure-context fallback. Still unique enough for a double-submit guard,
  // and the server's unique index is the real enforcement either way.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Maps a checkout failure to the message a shopper can act on. */
function checkoutMessage(
  error: unknown,
  tu: (key: 'rateLimited' | 'checkoutFailed' | 'outOfStockError' | 'genericAuthError') => string,
): string {
  if (typeof error === 'object' && error !== null) {
    const status = 'status' in error ? (error as { status: number }).status : 0;
    const code = 'code' in error ? (error as { code: string }).code : '';

    if (status === 429) return tu('rateLimited');
    if (code === 'OUT_OF_STOCK') return tu('outOfStockError');
    if (status === 409) return tu('outOfStockError');
  }
  return tu('checkoutFailed');
}
