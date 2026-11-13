/**
 * Code 39 encoder — Phase 10 pass L.
 *
 * A barcode that encodes a different string than the label says is worse than no
 * barcode, so the assertions are structural: nine elements per character, five of
 * them bars, start and stop present, and an unsupported character refused rather
 * than dropped.
 */

import { describe, it, expect } from 'vitest';
import { code39, BarcodeError } from '../../src/lib/barcode';

describe('code39', () => {
  it('wraps the value in start and stop characters', () => {
    const barcode = code39('OSB-1168');
    expect(barcode.encoded).toBe('*OSB-1168*');
  });

  it('emits five bars per character, including start and stop', () => {
    const value = 'OSB-1168';
    const barcode = code39(value);
    // 9 elements per character alternate bar/space starting with a bar: 5 bars.
    expect(barcode.bars).toHaveLength(5 * (value.length + 2));
  });

  it('produces a positive width and ordered bars', () => {
    const barcode = code39('A1');
    expect(barcode.width).toBeGreaterThan(0);

    let previous = -1;
    for (const bar of barcode.bars) {
      expect(bar.x).toBeGreaterThan(previous);
      expect(bar.width).toBeGreaterThan(0);
      previous = bar.x;
    }

    const last = barcode.bars[barcode.bars.length - 1]!;
    expect(last.x + last.width).toBeLessThanOrEqual(barcode.width);
  });

  it('upper-cases the value, so a lower-case SKU still scans', () => {
    expect(code39('osb-1').encoded).toBe('*OSB-1*');
  });

  it('refuses a character the alphabet does not contain', () => {
    expect(() => code39('OSB#1')).toThrow(BarcodeError);
    // The message names the character, so the operator can fix the SKU.
    expect(() => code39('OSB#1')).toThrow(/#/);
  });

  it('refuses an empty value', () => {
    expect(() => code39('   ')).toThrow(BarcodeError);
  });

  it('encodes every supported symbol without throwing', () => {
    // The full alphabet, so a missing table entry fails here rather than on a
    // printed label.
    expect(() => code39('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- .$/+%')).not.toThrow();
  });
});
