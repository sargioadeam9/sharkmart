/**
 * Small shared helpers. No dependencies, no side effects.
 */

/** Joins class names, dropping falsy values. */
export function cn(
  ...values: Array<string | false | null | undefined>
): string {
  return values.filter(Boolean).join(' ');
}

/**
 * Clamps a number into [min, max]. Used by the quantity stepper and the
 * free-delivery progress bar.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * 4.5 -> "4.5", 4 -> "4". Ratings are stored as one-decimal numbers; the
 * reference prints them with `toLocaleString`, which drops a trailing .0.
 */
export function formatRating(rating: number): string {
  return Number.isInteger(rating) ? String(rating) : rating.toFixed(1);
}

/** Safe array index read under `noUncheckedIndexedAccess`. */
export function at<T>(items: readonly T[], index: number): T | undefined {
  return items[index];
}
