/**
 * `COOKIE_DOMAIN` normalisation.
 *
 * Small, but the failure mode it guards is invisible: a browser rejects a
 * `Set-Cookie` whose `Domain` is a scheme or contains a path, and the only
 * symptom is that login silently does nothing. These cases pin the accepted
 * shapes so an operator gets a clear log line instead of a mystery.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { normalizeCookieDomain } from '../src/config/env.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('normalizeCookieDomain', () => {
  it('returns undefined when unset, so cookies stay host-only', () => {
    expect(normalizeCookieDomain(undefined)).toBeUndefined();
    expect(normalizeCookieDomain('')).toBeUndefined();
    expect(normalizeCookieDomain('   ')).toBeUndefined();
  });

  it('adds the leading dot a bare domain needs', () => {
    expect(normalizeCookieDomain('example.com')).toBe('.example.com');
  });

  it('leaves an already-dotted domain alone', () => {
    expect(normalizeCookieDomain('.example.com')).toBe('.example.com');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeCookieDomain('  .example.com  ')).toBe('.example.com');
  });

  it('rejects a value with a scheme, a port or a path', () => {
    // A browser would silently drop the cookie for each of these.
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(normalizeCookieDomain('https://example.com')).toBeUndefined();
    expect(normalizeCookieDomain('example.com:3000')).toBeUndefined();
    expect(normalizeCookieDomain('example.com/')).toBeUndefined();
  });

  it('logs when it rejects a value', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    normalizeCookieDomain('https://example.com');
    expect(spy).toHaveBeenCalledOnce();
  });
});
