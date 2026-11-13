/**
 * Code 39 barcodes — encoder only, no dependency.
 *
 * ── Why Code 39 and not Code 128 ───────────────────────────────────────────
 *
 * Code 128 is denser and is what a retail label usually carries, but it needs a
 * full code-set table, a checksum and shift characters — a hundred lines of table
 * data that a bug can hide in. Code 39 is nine elements per character, needs no
 * checksum (it is self-checking), and every handheld scanner in a Bangladeshi
 * warehouse reads it. For internal SKUs at `OSB-1168` length, density is not the
 * constraint.
 *
 * The alphabet is uppercase letters, digits, space and `- . $ / + %`. Anything
 * else throws rather than being silently dropped: a barcode that encodes a
 * different string than the label says is worse than no barcode.
 */

/** Nine elements per character: alternating bar/space, starting with a bar. */
const PATTERNS: Record<string, string> = {
  '0': 'nnnwwnwnn',
  '1': 'wnnwnnnnw',
  '2': 'nnwwnnnnw',
  '3': 'wnwwnnnnn',
  '4': 'nnnwwnnnw',
  '5': 'wnnwwnnnn',
  '6': 'nnwwwnnnn',
  '7': 'nnnwnnwnw',
  '8': 'wnnwnnwnn',
  '9': 'nnwwnnwnn',
  A: 'wnnnnwnnw',
  B: 'nnwnnwnnw',
  C: 'wnwnnwnnn',
  D: 'nnnnwwnnw',
  E: 'wnnnwwnnn',
  F: 'nnwnwwnnn',
  G: 'nnnnnwwnw',
  H: 'wnnnnwwnn',
  I: 'nnwnnwwnn',
  J: 'nnnnwwwnn',
  K: 'wnnnnnnww',
  L: 'nnwnnnnww',
  M: 'wnwnnnnwn',
  N: 'nnnnwnnww',
  O: 'wnnnwnnwn',
  P: 'nnwnwnnwn',
  Q: 'nnnnnnwww',
  R: 'wnnnnnwwn',
  S: 'nnwnnnwwn',
  T: 'nnnnwnwwn',
  U: 'wwnnnnnnw',
  V: 'nwwnnnnnw',
  W: 'wwwnnnnnn',
  X: 'nwnnwnnnw',
  Y: 'wwnnwnnnn',
  Z: 'nwwnwnnnn',
  '-': 'nwnnnnwnw',
  '.': 'wwnnnnwnn',
  ' ': 'nwwnnnwnn',
  $: 'nwnwnwnnn',
  '/': 'nwnwnnnwn',
  '+': 'nwnnnwnwn',
  '%': 'nnnwnwnwn',
  '*': 'nwnnwnwnn',
};

/** Narrow bar is 1 unit, wide is 3 — the ratio every scanner expects. */
const NARROW = 1;
const WIDE = 3;
/** Space between characters, one narrow bar wide. */
const GAP = 1;

export interface BarcodeBar {
  x: number;
  width: number;
}

export interface Barcode {
  bars: BarcodeBar[];
  /** Total width in module units. */
  width: number;
  /** The value actually encoded, including the start/stop characters. */
  encoded: string;
}

export class BarcodeError extends Error {}

/**
 * Encodes a value as Code 39 bars.
 *
 * `*` is the start and stop character and is added here — callers pass the raw
 * value and never have to remember it.
 */
export function code39(value: string): Barcode {
  const raw = value.trim().toUpperCase();
  if (raw.length === 0) throw new BarcodeError('A barcode needs a value.');

  for (const char of raw) {
    if (!(char in PATTERNS)) {
      throw new BarcodeError(`Code 39 cannot encode "${char}".`);
    }
  }

  const encoded = `*${raw}*`;
  const bars: BarcodeBar[] = [];
  let cursor = 0;

  for (let index = 0; index < encoded.length; index += 1) {
    const pattern = PATTERNS[encoded[index]!]!;

    for (let element = 0; element < pattern.length; element += 1) {
      const width = pattern[element] === 'w' ? WIDE : NARROW;
      // Even elements are bars, odd are spaces.
      if (element % 2 === 0) bars.push({ x: cursor, width });
      cursor += width;
    }

    if (index < encoded.length - 1) cursor += GAP;
  }

  return { bars, width: cursor, encoded };
}
