/**
 * Password hashing — security.md §4, AGENTS.md §7.4.
 *
 * bcrypt at cost 12. Never logged, never returned, never emailed.
 *
 * The cost is a constant here rather than a magic number at each call site, so
 * a future tuning pass has one place to change and no call site can drift to a
 * weaker factor.
 */

import bcrypt from 'bcrypt';

/** AGENTS.md §7.4: cost ≥ 12. */
export const BCRYPT_COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

/**
 * Constant-time-ish comparison.
 *
 * bcrypt.compare is already constant-time with respect to the hash contents; the
 * only thing this wrapper adds is a guard against a malformed stored hash
 * throwing into the request. A corrupt row must read as "wrong password", not
 * as a 500 that tells an attacker which account has a broken record.
 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/**
 * A hash of a throwaway password, used to equalise timing on the login path.
 *
 * security.md §11 requires identical timing for an unknown account and a wrong
 * password. Returning early when the user does not exist makes the two cases
 * distinguishable by response time, which is a working account-enumeration
 * oracle. Comparing against this dummy hash costs the same bcrypt work.
 *
 * This is a real cost-12 hash of a string nobody uses as a password. It is not
 * a secret and cannot authenticate anything: `verifyPassword` against it only
 * returns true for that throwaway string, which no account stores.
 */
export const DUMMY_HASH = '$2b$12$dvo1rjrLl2FqczLmdKkUb.hBHh/xT32HrXEo8kSzbOFc7U3hVuKg.';
