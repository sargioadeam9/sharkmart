/**
 * Phase 8 live probe — auth, cart, checkout, orders.
 *
 * Runs against the real API and the real database. This is the manual evidence
 * pass; the vitest suites assert the same things with assertions instead of
 * console output. Kept as a script because the gate asks for observed behaviour
 * and a transcript is the most honest form of that.
 *
 * Usage: node tools/phase8-probe.mjs
 */

const BASE = 'http://localhost:4000/api/v1';

/**
 * The trusted first-party bypass.
 *
 * The probe fires ~90 requests in a few seconds, which is well past the public
 * buckets — and the rate limiter is *supposed* to stop that. Rather than
 * weaken the limits for the test, the probe presents the same internal token
 * the Next server uses during a build. The limiter's own behaviour is verified
 * separately in step 17, with the token deliberately withheld.
 *
 * Read from server/.env directly: the probe runs from the repo root, where
 * dotenv would not find that file.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, '..', 'server', '.env');

let INTERNAL_TOKEN = '';
try {
  const envText = readFileSync(envPath, 'utf8');
  const match = /^INTERNAL_API_TOKEN=(.*)$/m.exec(envText);
  INTERNAL_TOKEN = match ? match[1].trim() : '';
} catch {
  INTERNAL_TOKEN = '';
}

const BYPASS = INTERNAL_TOKEN ? { 'X-Internal-Token': INTERNAL_TOKEN } : {};

let pass = 0;
let fail = 0;

function check(name, condition, detail = '') {
  if (condition) {
    pass += 1;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** A cookie jar, because the API is cookie-based and fetch is not. */
function makeJar() {
  const jar = new Map();
  return {
    header() {
      return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    absorb(response) {
      const raw = response.headers.getSetCookie?.() ?? [];
      for (const cookie of raw) {
        const [pair] = cookie.split(';');
        const idx = pair.indexOf('=');
        const name = pair.slice(0, idx).trim();
        const value = pair.slice(idx + 1).trim();
        if (value === '' ) jar.delete(name);
        else jar.set(name, value);
      }
    },
    get(name) {
      return jar.get(name);
    },
    clear() {
      jar.clear();
    },
  };
}

async function call(jar, path, { method = 'GET', body, headers = {}, bypass = true } = {}) {
  const csrf = jar.get('csrf_token');
  const cookie = jar.header();
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      ...(bypass ? BYPASS : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  jar.absorb(response);
  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { status: response.status, body: json, headers: response.headers };
}

const stamp = Date.now();
const email = `probe${stamp}@sharkmart.test`;
const phone = `017${String(stamp).slice(-8)}`;
const password = 'ProbePass123';

async function main() {
  console.log('\n=== PHASE 8 PROBE ===\n');

  // ── 1. Registration ───────────────────────────────────────────────────
  console.log('1. Registration');
  const jar = makeJar();
  const reg = await call(jar, '/auth/register', {
    method: 'POST',
    body: { name: 'Probe User', email, phone, password },
  });
  check('register returns 201', reg.status === 201, `got ${reg.status}`);
  check('register returns the user', reg.body?.data?.user?.email === email);
  check('register sets an access cookie', Boolean(jar.get('sm_access')));
  check('register sets a refresh cookie', Boolean(jar.get('sm_refresh')));
  check('register sets a CSRF cookie', Boolean(jar.get('csrf_token')));
  check(
    'response never contains the password hash',
    !JSON.stringify(reg.body).includes('$2b$'),
  );

  // ── 2. Duplicate registration ─────────────────────────────────────────
  console.log('\n2. Duplicate registration');
  const dupe = await call(makeJar(), '/auth/register', {
    method: 'POST',
    body: { name: 'Probe User', email, phone, password },
  });
  check('duplicate email is a 409', dupe.status === 409, `got ${dupe.status}`);
  check('duplicate uses the CONFLICT code', dupe.body?.error?.code === 'CONFLICT');

  // ── 3. Strict schema rejects privilege escalation ─────────────────────
  console.log('\n3. Mass-assignment guard');
  const escalate = await call(makeJar(), '/auth/register', {
    method: 'POST',
    body: { name: 'Hacker', email: `h${stamp}@x.test`, password, role: 'SUPER_ADMIN' },
  });
  check('unknown `role` key is rejected', escalate.status === 422, `got ${escalate.status}`);
  check('rejection is VALIDATION_ERROR', escalate.body?.error?.code === 'VALIDATION_ERROR');

  // ── 4. Weak password rejected ─────────────────────────────────────────
  console.log('\n4. Password policy');
  const weak = await call(makeJar(), '/auth/register', {
    method: 'POST',
    body: { name: 'Weak', email: `w${stamp}@x.test`, password: 'short' },
  });
  check('short password is rejected', weak.status === 422, `got ${weak.status}`);

  // ── 5. Login ──────────────────────────────────────────────────────────
  console.log('\n5. Login');
  const loginJar = makeJar();
  const login = await call(loginJar, '/auth/login', {
    method: 'POST',
    body: { identifier: email, password },
  });
  check('login returns 200', login.status === 200, `got ${login.status}`);
  check('login sets cookies', Boolean(loginJar.get('sm_access')));

  const wrongJar = makeJar();
  const wrong = await call(wrongJar, '/auth/login', {
    method: 'POST',
    body: { identifier: email, password: 'WrongPass123' },
  });
  check('wrong password is a 401', wrong.status === 401, `got ${wrong.status}`);
  check(
    'wrong password says "Invalid credentials"',
    wrong.body?.error?.message === 'Invalid credentials.',
    wrong.body?.error?.message,
  );

  const unknown = await call(makeJar(), '/auth/login', {
    method: 'POST',
    body: { identifier: `nobody${stamp}@x.test`, password: 'WrongPass123' },
  });
  check(
    'unknown account gives the SAME message as a wrong password',
    unknown.body?.error?.message === wrong.body?.error?.message,
    'no enumeration oracle',
  );

  // ── 6. /me ────────────────────────────────────────────────────────────
  console.log('\n6. Profile');
  const me = await call(loginJar, '/me');
  check('GET /me returns the user', me.body?.data?.user?.email === email);
  check('GET /me without a session is 401', (await call(makeJar(), '/me')).status === 401);

  // ── 7. Address book ───────────────────────────────────────────────────
  console.log('\n7. Addresses');
  const addr = await call(loginJar, '/me/addresses', {
    method: 'POST',
    body: {
      recipientName: 'Probe User',
      phone,
      division: 'Dhaka',
      district: 'Dhaka',
      area: 'Gulshan',
      address: 'House 12, Road 5',
    },
  });
  check('address created', addr.status === 201, `got ${addr.status}`);
  check('first address becomes the default', addr.body?.data?.isDefault === true);
  const addressId = addr.body?.data?.id;

  const badDivision = await call(loginJar, '/me/addresses', {
    method: 'POST',
    body: {
      recipientName: 'X',
      phone,
      division: 'Atlantis',
      district: 'Dhaka',
      area: 'Gulshan',
      address: 'House 1',
    },
  });
  check('unknown division is rejected', badDivision.status === 422, `got ${badDivision.status}`);

  // ── 8. Cart ───────────────────────────────────────────────────────────
  console.log('\n8. Cart');
  const products = await call(makeJar(), '/products?limit=3&inStockOnly=1');
  const product = products.body?.data?.[0];
  check('catalog returns a product to work with', Boolean(product), product?.nameEn);

  const detail = await call(makeJar(), `/products/${product.slug}`);
  const groups = detail.body?.data?.variantGroups ?? [];
  // A selection resolves through the combination table, not through an option:
  // one option value spans every variant that carries it.
  const combinations = groups[0]?.combinations ?? {};
  const variantId = Object.values(combinations)[0];
  check('product has a variant', Boolean(variantId), String(variantId).slice(0, 12));

  const add = await call(loginJar, '/cart/items', {
    method: 'POST',
    body: { productId: product.id, variantId, quantity: 2 },
  });
  check('add to cart works', add.status === 201, `got ${add.status}`);
  check('cart has one line', add.body?.data?.lines?.length === 1);
  check('cart subtotal is computed server-side', (add.body?.data?.subtotalPoisha ?? 0) > 0);

  // ── 9. Checkout: price tampering ──────────────────────────────────────
  console.log('\n9. Checkout — price tampering');
  const cartState = await call(loginJar, '/cart');
  const line = cartState.body?.data?.lines?.[0];

  const tampered = await call(loginJar, '/checkout', {
    method: 'POST',
    body: {
      items: [
        {
          productId: product.id,
          variantId,
          quantity: 1,
          // The client tries to set its own price. Strict schema rejects it.
          unitPricePoisha: 1,
          pricePoisha: 1,
        },
      ],
      addressId,
      deliveryMethod: 'STANDARD',
      paymentMethod: 'COD',
    },
  });
  check(
    'a client-supplied price is rejected outright',
    tampered.status === 422,
    `got ${tampered.status} — strict schema`,
  );

  const honest = await call(loginJar, '/checkout', {
    method: 'POST',
    body: {
      items: [{ productId: product.id, variantId, quantity: 1 }],
      addressId,
      deliveryMethod: 'STANDARD',
      paymentMethod: 'COD',
    },
  });
  check('honest checkout succeeds', honest.status === 201, `got ${honest.status}`);
  const order = honest.body?.data;
  check('order has a non-sequential number', /^SM-[A-Z0-9]+$/.test(order?.orderNumber ?? ''), order?.orderNumber);
  check(
    'server charged the real line price, not the client one',
    order?.items?.[0]?.unitPricePoisha === line?.unitPricePoisha,
    `${order?.items?.[0]?.unitPricePoisha} vs ${line?.unitPricePoisha}`,
  );
  check(
    'total = subtotal - discount + delivery',
    order?.totalAmountPoisha ===
      order.subtotalPoisha - order.discountAmountPoisha + order.deliveryChargePoisha,
  );
  check('cart was cleared after checkout', (await call(loginJar, '/cart')).body?.data?.lines?.length === 0);

  // ── 10. Idempotency ───────────────────────────────────────────────────
  console.log('\n10. Idempotency');
  const key = `probe-${stamp}`;
  const idemBody = {
    items: [{ productId: product.id, variantId, quantity: 1 }],
    addressId,
    deliveryMethod: 'STANDARD',
    paymentMethod: 'COD',
  };
  const first = await call(loginJar, '/checkout', {
    method: 'POST',
    body: idemBody,
    headers: { 'Idempotency-Key': key },
  });
  const second = await call(loginJar, '/checkout', {
    method: 'POST',
    body: idemBody,
    headers: { 'Idempotency-Key': key },
  });
  check('first idempotent checkout succeeds', first.status === 201, `got ${first.status}`);
  check('replay returns 201 too', second.status === 201, `got ${second.status}`);
  check(
    'replay returns the SAME order number',
    first.body?.data?.orderNumber === second.body?.data?.orderNumber,
    `${first.body?.data?.orderNumber} / ${second.body?.data?.orderNumber}`,
  );

  // ── 11. Orders + IDOR ─────────────────────────────────────────────────
  console.log('\n11. Orders and IDOR');
  const myOrders = await call(loginJar, '/me/orders');
  check('order list returns orders', (myOrders.body?.data?.length ?? 0) >= 2);
  check('order list is paginated', myOrders.body?.meta?.total >= 2);

  // A second account must not read the first account's order.
  const otherJar = makeJar();
  const otherEmail = `other${stamp}@sharkmart.test`;
  await call(otherJar, '/auth/register', {
    method: 'POST',
    body: { name: 'Other User', email: otherEmail, password },
  });
  const idor = await call(otherJar, `/me/orders/${order.id}`);
  check(
    "another user's order is 404, not data",
    idor.status === 404,
    `got ${idor.status}`,
  );
  check('no order payload leaked', idor.body?.data === undefined);

  // ── 12. Cancel + status machine ───────────────────────────────────────
  console.log('\n12. Status machine');
  const cancel = await call(loginJar, `/me/orders/${order.id}/cancel`, {
    method: 'POST',
    body: { reason: 'Probe cancellation' },
  });
  check('pending order can be cancelled', cancel.status === 200, `got ${cancel.status}`);
  check('status is CANCELLED', cancel.body?.data?.status === 'CANCELLED');

  const cancelAgain = await call(loginJar, `/me/orders/${order.id}/cancel`, {
    method: 'POST',
    body: { reason: 'again' },
  });
  check('cancelling twice is refused', cancelAgain.status === 409, `got ${cancelAgain.status}`);

  // ── 13. Tracking ──────────────────────────────────────────────────────
  console.log('\n13. Public tracking');
  const tracked = await call(makeJar(), `/track/${order.orderNumber}?phone=${phone}`);
  check('tracking with the right phone works', tracked.status === 200, `got ${tracked.status}`);
  check('tracking hides the internal id', tracked.body?.data?.id === undefined);

  const wrongPhone = await call(makeJar(), `/track/${order.orderNumber}?phone=01799999999`);
  check('tracking with the wrong phone is 404', wrongPhone.status === 404, `got ${wrongPhone.status}`);

  const noPhone = await call(makeJar(), `/track/${order.orderNumber}`);
  check('tracking without a phone is 422', noPhone.status === 422, `got ${noPhone.status}`);

  // ── 14. Refresh rotation + reuse detection ────────────────────────────
  console.log('\n14. Refresh rotation and reuse detection');
  const refreshJar = makeJar();
  await call(refreshJar, '/auth/login', { method: 'POST', body: { identifier: email, password } });
  const oldRefresh = refreshJar.get('sm_refresh');

  const rotated = await call(refreshJar, '/auth/refresh', { method: 'POST' });
  check('refresh rotates', rotated.status === 200, `got ${rotated.status}`);
  check('refresh issues a new token', refreshJar.get('sm_refresh') !== oldRefresh);

  // Replay the consumed token — this is the reuse-detection control.
  const replayJar = makeJar();
  const replay = await fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    headers: { Cookie: `sm_refresh=${oldRefresh}` },
  });
  const replayBody = await replay.json();
  check('a consumed refresh token is refused', replay.status === 401, `got ${replay.status}`);
  check(
    'reuse is reported as a security event',
    /security/i.test(replayBody?.error?.message ?? ''),
    replayBody?.error?.message,
  );

  // ── 15. Logout ────────────────────────────────────────────────────────
  console.log('\n15. Logout');
  const logout = await call(loginJar, '/auth/logout', { method: 'POST' });
  check('logout succeeds', logout.status === 200, `got ${logout.status}`);
  check('logout clears the session', (await call(loginJar, '/me')).status === 401);

  // ── 16. CSRF ──────────────────────────────────────────────────────────
  console.log('\n16. CSRF');
  const csrfJar = makeJar();
  await call(csrfJar, '/auth/login', { method: 'POST', body: { identifier: email, password } });
  const csrfCookie = csrfJar.get('csrf_token');
  const noCsrf = await fetch(`${BASE}/cart/items`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `sm_access=${csrfJar.get('sm_access')}; csrf_token=${csrfCookie}`,
      // deliberately no X-CSRF-Token
    },
    body: JSON.stringify({ productId: product.id, variantId, quantity: 1 }),
  });
  check('a state-changing request without the CSRF header is refused', noCsrf.status === 403, `got ${noCsrf.status}`);

  // ── 17. Rate limit ────────────────────────────────────────────────────
  console.log('\n17. Login rate limit');
  let limited = false;
  let statuses = [];
  for (let i = 0; i < 8; i += 1) {
    const r = await call(makeJar(), '/auth/login', {
      method: 'POST',
      body: { identifier: `rl${stamp}@x.test`, password: 'WrongPass123' },
      bypass: false,
    });
    statuses.push(r.status);
    if (r.status === 429) limited = true;
  }
  check('login is rate limited', limited, statuses.join(','));

  // ── 18. Password reset ────────────────────────────────────────────────
  console.log('\n18. Password reset');
  const forgot = await call(makeJar(), '/auth/forgot-password', {
    method: 'POST',
    body: { identifier: email },
  });
  check('forgot-password returns 200', forgot.status === 200, `got ${forgot.status}`);
  const devToken = forgot.body?.data?.devResetToken;
  check('dev reset token is exposed outside production', Boolean(devToken));

  const forgotUnknown = await call(makeJar(), '/auth/forgot-password', {
    method: 'POST',
    body: { identifier: `ghost${stamp}@x.test` },
  });
  check('unknown account gives the same 200', forgotUnknown.status === 200);
  check(
    'unknown account leaks no token',
    forgotUnknown.body?.data?.devResetToken === undefined,
  );

  if (devToken) {
    const newPassword = 'ResetPass456';
    const reset = await call(makeJar(), '/auth/reset-password', {
      method: 'POST',
      body: { token: devToken, password: newPassword },
    });
    check('reset succeeds', reset.status === 200, `got ${reset.status}`);

    const reuse = await call(makeJar(), '/auth/reset-password', {
      method: 'POST',
      body: { token: devToken, password: 'AnotherPass789' },
    });
    check('a reset token is single-use', reuse.status === 400, `got ${reuse.status}`);

    const newLogin = await call(makeJar(), '/auth/login', {
      method: 'POST',
      body: { identifier: email, password: newPassword },
    });
    check('the new password works', newLogin.status === 200, `got ${newLogin.status}`);

    const oldLogin = await call(makeJar(), '/auth/login', {
      method: 'POST',
      body: { identifier: email, password },
    });
    check('the old password no longer works', oldLogin.status === 401, `got ${oldLogin.status}`);
  }

  console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('\nPROBE CRASHED:', error);
  process.exit(1);
});
