/**
 * Store settings — the single source of truth for the shop's identity and the
 * numbers that used to be constants.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * The `Setting` table has existed since Phase 6 with nine rows in it
 * (`site.name`, `delivery.standardFeePoisha`, ...) and **nothing ever read it**.
 * The shop name came from the `BRAND` constant and the delivery charge from
 * `DELIVERY_FLAT_POISHA`, so editing those rows changed nothing at all. A
 * settings screen on top of that would have been a screen that lies.
 *
 * This module makes the table the source of truth for the values listed in
 * `SETTINGS` below, and keeps `BRAND` and the order constants as the **fallback**
 * so a fresh database — or a failed read — still renders a working shop.
 *
 * ── The rules that keep it safe ─────────────────────────────────────────────
 *
 * 1. **Only registered keys exist.** `SETTINGS` is the schema. A PATCH carrying
 *    an unknown key is rejected rather than silently stored, because a stray row
 *    is a value nobody will ever read and nobody will ever delete.
 * 2. **Reads never throw.** `getSettings()` catches everything and falls back to
 *    the defaults. Checkout must not fail because a settings row is missing.
 * 3. **Writes are cached for 5 minutes and invalidated on write.** The whole map
 *    is one cached object, so a checkout does not pay a query per key.
 * 4. **Money is poisha**, as everywhere else. The admin form converts.
 */

import { prisma } from '../config/database.js';
import { HttpError } from '../middleware/errorHandler.js';
import { cached, invalidateTag, TTL } from './cache.js';
import { withAudit } from './audit.service.js';
import { BRAND_FALLBACK as BRAND, DELIVERY_DEFAULTS } from '../config/store-defaults.js';

export type SettingGroup = 'general' | 'contact' | 'commerce' | 'branding';
export type SettingType = 'string' | 'int' | 'email' | 'url' | 'text';

export interface SettingDef {
  key: string;
  group: SettingGroup;
  type: SettingType;
  /** Used when the row is missing or unreadable. Always a valid value. */
  default: string;
  labelEn: string;
  labelBn: string;
  hintEn?: string;
  hintBn?: string;
  min?: number;
  max?: number;
}

/**
 * The registry. Adding a setting means adding a line here — the API, the screen
 * and the validation all read from this array, so there is no second place to
 * update and no way for the three to disagree.
 */
export const SETTINGS: readonly SettingDef[] = [
  // ── General ───────────────────────────────────────────────────────────────
  {
    key: 'site.name',
    group: 'general',
    type: 'string',
    default: BRAND.name,
    labelEn: 'Store name',
    labelBn: 'দোকানের নাম',
    hintEn: 'Shown in the admin sidebar, invoices and email sender names.',
    hintBn: 'অ্যাডমিন সাইডবার, ইনভয়েস আর ইমেইলের প্রেরকের নামে দেখা যায়।',
  },
  {
    key: 'site.tagline',
    group: 'general',
    type: 'string',
    default: BRAND.tagline,
    labelEn: 'Tagline',
    labelBn: 'ট্যাগলাইন',
  },
  {
    key: 'site.domain',
    group: 'general',
    type: 'string',
    default: BRAND.domain,
    labelEn: 'Domain',
    labelBn: 'ডোমেইন',
    hintEn:
      'Display only. Changing it does NOT move the site: CORS, cookies, canonical URLs and gateway callbacks are configured elsewhere.',
    hintBn:
      'শুধু প্রদর্শনের জন্য। এটা বদলালে সাইট সরে যাবে না — CORS, cookie, canonical URL আর গেটওয়ে callback আলাদা জায়গায়।',
  },
  {
    key: 'site.defaultLanguage',
    group: 'general',
    type: 'string',
    default: 'bn',
    labelEn: 'Default language',
    labelBn: 'ডিফল্ট ভাষা',
    hintEn: 'bn or en.',
    hintBn: 'bn অথবা en।',
  },

  // ── Contact ───────────────────────────────────────────────────────────────
  {
    key: 'contact.supportEmail',
    group: 'contact',
    type: 'email',
    default: BRAND.supportEmail,
    labelEn: 'Support email',
    labelBn: 'সাপোর্ট ইমেইল',
  },
  {
    key: 'contact.phone',
    group: 'contact',
    type: 'string',
    default: BRAND.phone,
    labelEn: 'Phone',
    labelBn: 'ফোন',
  },
  {
    key: 'contact.address',
    group: 'contact',
    type: 'text',
    default: BRAND.address,
    labelEn: 'Address',
    labelBn: 'ঠিকানা',
  },

  // ── Commerce ──────────────────────────────────────────────────────────────
  {
    key: 'delivery.standardFeePoisha',
    group: 'commerce',
    type: 'int',
    default: String(DELIVERY_DEFAULTS.standardFeePoisha),
    labelEn: 'Standard delivery fee (poisha)',
    labelBn: 'স্ট্যান্ডার্ড ডেলিভারি চার্জ (পয়সা)',
    hintEn: '6000 poisha = ৳60. Charged by checkout when the order is under the free threshold.',
    hintBn: '৬০০০ পয়সা = ৳৬০। ফ্রি থ্রেশহোল্ডের নিচে অর্ডারে চেকআউট এটাই নেয়।',
    min: 0,
  },
  {
    key: 'delivery.freeThresholdPoisha',
    group: 'commerce',
    type: 'int',
    default: String(DELIVERY_DEFAULTS.freeThresholdPoisha),
    labelEn: 'Free delivery threshold (poisha)',
    labelBn: 'ফ্রি ডেলিভারি থ্রেশহোল্ড (পয়সা)',
    hintEn: '200000 poisha = ৳2,000. At or above this the standard fee is waived.',
    hintBn: '২০০০০০ পয়সা = ৳২,০০০। এর সমান বা বেশি হলে স্ট্যান্ডার্ড চার্জ মাফ।',
    min: 0,
  },
  {
    key: 'delivery.expressSurchargePoisha',
    group: 'commerce',
    type: 'int',
    default: String(DELIVERY_DEFAULTS.expressSurchargePoisha),
    labelEn: 'Express surcharge (poisha)',
    labelBn: 'এক্সপ্রেস সারচার্জ (পয়সা)',
    hintEn: 'Added on top of the standard fee for express delivery.',
    hintBn: 'এক্সপ্রেস ডেলিভারিতে স্ট্যান্ডার্ড চার্জের উপরে যোগ হয়।',
    min: 0,
  },
  {
    key: 'delivery.dhakaEta',
    group: 'commerce',
    type: 'string',
    default: '24-48 hours',
    labelEn: 'Dhaka delivery estimate',
    labelBn: 'ঢাকায় ডেলিভারি সময়',
  },
  {
    key: 'delivery.nationalEta',
    group: 'commerce',
    type: 'string',
    default: '3-5 days',
    labelEn: 'Outside Dhaka estimate',
    labelBn: 'ঢাকার বাইরে সময়',
  },

  // ── Branding ──────────────────────────────────────────────────────────────
  {
    key: 'brand.nameFirst',
    group: 'branding',
    type: 'string',
    default: BRAND.nameParts.first,
    labelEn: 'Wordmark, first part',
    labelBn: 'ওয়ার্ডমার্ক, প্রথম অংশ',
    hintEn: 'Rendered in navy. "Shark" in SharkMart.',
    hintBn: 'নেভি রঙে দেখানো হয়। SharkMart-এ "Shark"।',
  },
  {
    key: 'brand.nameSecond',
    group: 'branding',
    type: 'string',
    default: BRAND.nameParts.second,
    labelEn: 'Wordmark, second part',
    labelBn: 'ওয়ার্ডমার্ক, দ্বিতীয় অংশ',
    hintEn: 'Rendered in brand red. "Mart" in SharkMart.',
    hintBn: 'ব্র্যান্ড লালে দেখানো হয়। SharkMart-এ "Mart"।',
  },
  {
    key: 'brand.logoUrl',
    group: 'branding',
    type: 'url',
    default: BRAND.logo.src,
    labelEn: 'Logo URL',
    labelBn: 'লোগো URL',
    hintEn: 'A path or an absolute URL. There is no upload storage in this project.',
    hintBn: 'পাথ বা পূর্ণ URL। এই প্রজেক্টে ফাইল আপলোড স্টোরেজ নেই।',
  },
];

const BY_KEY = new Map(SETTINGS.map((def) => [def.key, def]));

export type SettingsMap = Record<string, string>;

/** Defaults only, no database. The shape `getSettings()` always returns. */
export function defaults(): SettingsMap {
  return Object.fromEntries(SETTINGS.map((def) => [def.key, def.default]));
}

const CACHE_KEY = 'settings:map';

/**
 * The whole map, merged over defaults.
 *
 * Never throws: a database failure returns the defaults, because a shop that
 * cannot read a settings row must still be able to take an order. The failure is
 * logged so it is not invisible.
 */
export async function getSettings(): Promise<SettingsMap> {
  try {
    return await cached(CACHE_KEY, TTL.settings, ['settings'], async () => {
      const rows = await prisma.setting.findMany({ select: { key: true, value: true } });
      const map = defaults();
      for (const row of rows) {
        // Only registered keys are honoured. A row someone inserted by hand for a
        // key this build does not know about is ignored, not surfaced.
        if (BY_KEY.has(row.key)) map[row.key] = row.value;
      }
      return map;
    });
  } catch (error) {
    console.error('[settings] read failed, using defaults:', (error as Error).message);
    return defaults();
  }
}

/** One value, typed as a number. Falls back to the registered default. */
export function intFrom(map: SettingsMap, key: string): number {
  const raw = map[key];
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : Number(BY_KEY.get(key)?.default ?? 0);
}

export interface DeliveryFees {
  standardFeePoisha: number;
  freeThresholdPoisha: number;
  expressSurchargePoisha: number;
}

/**
 * The three numbers checkout needs.
 *
 * Read through the cache, so the hot path pays one lookup, not three queries.
 */
export async function getDeliveryFees(): Promise<DeliveryFees> {
  const map = await getSettings();
  return {
    standardFeePoisha: intFrom(map, 'delivery.standardFeePoisha'),
    freeThresholdPoisha: intFrom(map, 'delivery.freeThresholdPoisha'),
    expressSurchargePoisha: intFrom(map, 'delivery.expressSurchargePoisha'),
  };
}

export interface StoreProfile {
  name: string;
  tagline: string;
  domain: string;
  supportEmail: string;
  phone: string;
  address: string;
  nameFirst: string;
  nameSecond: string;
  logoUrl: string;
}

/** The display-safe subset. No fees, no settings keys — just what a header needs. */
export async function getStoreProfile(): Promise<StoreProfile> {
  const map = await getSettings();
  return {
    name: map['site.name'] ?? BRAND.name,
    tagline: map['site.tagline'] ?? BRAND.tagline,
    domain: map['site.domain'] ?? BRAND.domain,
    supportEmail: map['contact.supportEmail'] ?? BRAND.supportEmail,
    phone: map['contact.phone'] ?? BRAND.phone,
    address: map['contact.address'] ?? BRAND.address,
    nameFirst: map['brand.nameFirst'] ?? BRAND.nameParts.first,
    nameSecond: map['brand.nameSecond'] ?? BRAND.nameParts.second,
    logoUrl: map['brand.logoUrl'] ?? BRAND.logo.src,
  };
}

// ─── Validation ─────────────────────────────────────────────────────────────

export interface SettingItem {
  key: string;
  group: SettingGroup;
  type: SettingType;
  labelEn: string;
  labelBn: string;
  hintEn?: string;
  hintBn?: string;
  value: string;
  default: string;
  /** True when the row is absent and `value` is the fallback. */
  isDefault: boolean;
}

export interface SettingsGroupPayload {
  group: SettingGroup;
  items: SettingItem[];
}

/** The GET payload: every registered key, grouped, with its current value. */
export async function settingsForAdmin(): Promise<SettingsGroupPayload[]> {
  const map = await getSettings();
  const rows: Array<{ key: string }> = await prisma.setting
    .findMany({ select: { key: true } })
    .catch(() => []);
  const present = new Set(rows.map((row) => row.key));

  const groups: SettingGroup[] = ['general', 'contact', 'commerce', 'branding'];
  return groups.map((group) => ({
    group,
    items: SETTINGS.filter((def) => def.group === group).map((def) => ({
      key: def.key,
      group: def.group,
      type: def.type,
      labelEn: def.labelEn,
      labelBn: def.labelBn,
      hintEn: def.hintEn,
      hintBn: def.hintBn,
      value: map[def.key] ?? def.default,
      default: def.default,
      isDefault: !present.has(def.key),
    })),
  }));
}

export interface SettingsValidationError {
  key: string;
  message: string;
}

/**
 * Validates a patch against the registry.
 *
 * Returns every problem at once rather than the first, so the operator fixes one
 * round of fields instead of ten.
 */
export function validatePatch(patch: Record<string, string>): SettingsValidationError[] {
  const errors: SettingsValidationError[] = [];

  for (const [key, raw] of Object.entries(patch)) {
    const def = BY_KEY.get(key);
    if (!def) {
      errors.push({ key, message: 'unknown setting' });
      continue;
    }

    const value = raw.trim();

    if (def.type === 'int') {
      if (!/^\d+$/.test(value)) {
        errors.push({ key, message: 'must be a whole number' });
        continue;
      }
      const n = Number(value);
      if (def.min !== undefined && n < def.min) {
        errors.push({ key, message: `must be at least ${def.min}` });
      }
      if (def.max !== undefined && n > def.max) {
        errors.push({ key, message: `must be at most ${def.max}` });
      }
      continue;
    }

    if (def.type === 'email') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
        errors.push({ key, message: 'must be a valid email address' });
      }
      continue;
    }

    if (def.type === 'url') {
      // A path is allowed (the logo lives in /public), as is an absolute http(s)
      // URL. A javascript: or data: value is not — it would be rendered into an
      // <img src>.
      if (!/^(\/[^\s]*|https?:\/\/[^\s]+)$/i.test(value)) {
        errors.push({ key, message: 'must be a path starting with / or an http(s) URL' });
      }
      continue;
    }

    if (value.length === 0) {
      errors.push({ key, message: 'cannot be empty' });
      continue;
    }

    if (value.length > 500) {
      errors.push({ key, message: 'is too long (max 500 characters)' });
    }
  }

  return errors;
}

export interface Actor {
  userId: string;
  ipAddress: string | null;
}

/**
 * Writes a validated patch.
 *
 * One transaction for every row, one audit row for the whole change, and the
 * cache invalidated after the commit. An upsert per key because a setting that
 * has never been saved has no row yet.
 */
export async function updateSettings(
  patch: Record<string, string>,
  actor: Actor,
): Promise<SettingsGroupPayload[]> {
  const errors = validatePatch(patch);
  if (errors.length > 0) {
    // All of them, not the first: the operator fixes one round of fields rather
    // than discovering the next problem on every save.
    throw new HttpError(422, 'VALIDATION_ERROR', errors[0]!.message, {
      field: errors[0]!.key,
      errors,
    });
  }

  const before = await getSettings();
  const changed: Record<string, { from: string; to: string }> = {};
  for (const [key, value] of Object.entries(patch)) {
    const next = value.trim();
    if (before[key] !== next) changed[key] = { from: before[key] ?? '', to: next };
  }

  // Nothing actually changed: do not write an audit row claiming otherwise.
  if (Object.keys(changed).length === 0) {
    return settingsForAdmin();
  }

  await withAudit(
    {
      userId: actor.userId,
      action: 'settings.update',
      entity: 'setting',
      entityId: 'store',
      changes: changed,
      ipAddress: actor.ipAddress,
    },
    async (tx) => {
      for (const [key, value] of Object.entries(patch)) {
        const def = BY_KEY.get(key)!;
        await tx.setting.upsert({
          where: { key },
          create: { key, value: value.trim(), group: def.group },
          update: { value: value.trim(), group: def.group },
        });
      }
    },
  );

  // After the commit, never inside it: a cache clear that ran before the write
  // landed would be repopulated with the old value by a concurrent read.
  await invalidateTag('settings');

  return settingsForAdmin();
}
