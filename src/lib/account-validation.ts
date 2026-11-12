/**
 * Client-side validation for the account forms.
 *
 * This is UX, not security (AGENTS.md §7.1). The server validates every one of
 * these fields again with Zod and is the only authority. The rules here exist so
 * a shopper learns about a typo before a round-trip, not so the API can trust
 * the payload.
 *
 * The Bangladesh phone rule is the one worth reading: `bdPhone` on the server
 * accepts `01XXXXXXXXX` (11 digits) and the `+880` form. This mirrors it exactly
 * — a client that is stricter than the server rejects valid input, and one that
 * is looser produces a 422 the user cannot act on.
 */

/** `01712345678` or `+8801712345678`. */
const BD_PHONE = /^(?:\+?880|0)1[3-9]\d{8}$/;

export function isValidBdPhone(value: string): boolean {
  return BD_PHONE.test(value.replace(/[\s-]/g, ''));
}

/** Normalises to the local `01XXXXXXXXX` form for storage. */
export function normaliseBdPhone(value: string): string {
  const digits = value.replace(/[\s-]/g, '');
  if (digits.startsWith('+880')) return `0${digits.slice(4)}`;
  if (digits.startsWith('880')) return `0${digits.slice(3)}`;
  return digits;
}

export function isValidEmail(value: string): boolean {
  // Deliberately loose: the only real test of an address is delivering to it.
  // A strict regex rejects valid addresses (plus-addressing, new TLDs) and
  // still cannot catch a typo the user believes is correct.
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

export interface PasswordCheck {
  valid: boolean;
  /** Which rule failed — the form renders one message, not a checklist. */
  reason: 'too_short' | 'no_letter' | 'no_number' | null;
}

/**
 * Password strength.
 *
 * The server requires 8+ characters with a letter and a number. Matching it
 * here means the strength meter and the API agree; a meter that says "strong"
 * for something the server rejects is worse than no meter.
 */
export function checkPassword(value: string): PasswordCheck {
  if (value.length < 8) return { valid: false, reason: 'too_short' };
  if (!/[a-zA-Z]/.test(value)) return { valid: false, reason: 'no_letter' };
  if (!/\d/.test(value)) return { valid: false, reason: 'no_number' };
  return { valid: true, reason: null };
}

/** 0–4, for the strength bar. Length dominates; variety refines. */
export function passwordStrength(value: string): number {
  if (value.length === 0) return 0;

  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value)) score += 1;
  if (/[^a-zA-Z0-9]/.test(value)) score += 1;

  return Math.min(4, score);
}

/** A required-text check that trims, so a field of spaces fails. */
export function required(value: string): boolean {
  return value.trim().length > 0;
}
