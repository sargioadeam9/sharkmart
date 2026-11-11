# Security Implementation Guide

## 1. Who must read this, and the golden rule

Mandatory before writing code in Phase 6 (public API), Phase 8 (auth, cart, orders, checkout), Phase 9 (admin core) and Phase 12 (security pass). If your phase touches auth, orders, admin or payments, read all of it.

> **The server decides. The client displays.**

`prompts/backend.md` holds the checklist, `AGENTS.md` section 7 holds the floor, and this file holds the implementation detail for both. Where they are silent, this file is the tiebreaker.

## 2. Threat model for this business

Bangladesh, BDT, mobile-first, COD-heavy. The realistic attacks are not exotic.

| Threat | Realistic attack | Control |
| --- | --- | --- |
| COD fraud | Fake orders to a competitor's address, or refusal on delivery after repeat orders | Phone verification before COD, per-phone order velocity cap, cancellation history on the customer record, courier return-rate flag |
| OTP brute force | Script hammers `/auth/otp/verify` with 6-digit guesses | 5 attempts per code, code TTL 5 minutes, per-phone and per-IP limits, account lockout |
| Coupon abuse | One coupon applied across many accounts, or stacked with itself | One redemption per user per coupon, atomic usage counter, eligibility recomputed server-side |
| Order enumeration | Sequential order numbers scraped to read other people's orders | Non-sequential public order number, tracking requires order number **and** phone |
| IDOR on orders and addresses | Change the id in `/orders/:id` and read someone else's order | Ownership filter in the query, never a post-fetch comparison |
| Fake courier webhook | POST a forged "delivered" status to flip an order and release COD | HMAC over the raw body, timestamp window, idempotency key |
| Admin session theft | XSS or a stolen cookie used to mutate catalog and pricing | HttpOnly cookies, short admin TTL, 2FA for admin and above, audit log on every mutation |

## 3. Rate limiting

### Algorithm per endpoint class

| Class | Algorithm | Why |
| --- | --- | --- |
| Cheap public reads (catalog, search, categories) | Fixed-window counter in Redis (`INCR` + `EXPIRE`) | One round trip, no sorted-set growth, boundary precision does not matter |
| Auth (login, register, reset, OTP) | Sliding window via sorted set (`ZADD`, `ZREMRANGEBYSCORE`, `ZCARD`) | No burst at the window boundary, which is exactly where a brute force lives |
| Cart and checkout writes | Sliding window | Same boundary-burst concern, lower volume |
| Admin API | Sliding window | Same |

Fixed window: `INCR rl:{scope}:{identity}:{windowStart}`, then `EXPIRE` on the first increment. Sliding window: one sorted set per `rl:{scope}:{identity}`, member is the request id, score is the millisecond timestamp, trimmed below `now - windowMs`.

### Key design

`rl:{scope}:{identity}`, where identity is the client IP for anonymous requests and the `userId` for authenticated ones. Never mix the two in one bucket.

```
rl:login:ip:103.94.12.7          rl:login:user:01HQ8Z3K4M9X2V
rl:register:ip:103.94.12.7       rl:reset:ip:103.94.12.7
rl:otp:send:phone:+8801712345678 rl:otp:verify:phone:+8801712345678
rl:search:ip:103.94.12.7         rl:cart:user:01HQ8Z3K4M9X2V
rl:checkout:user:01HQ8Z3K4M9X2V  rl:api:ip:103.94.12.7
rl:admin:user:01HQ8Z3K4M9X2V
```

Resolve the client IP from the trusted proxy header only, with exactly one trusted hop configured. A spoofable `X-Forwarded-For` makes every limit below decorative.

### Limits

| Scope | Limit | Window | Identity |
| --- | --- | --- | --- |
| `login` | 5 | 1 min | IP, plus account lockout below |
| `register` | 3 | 1 min | IP |
| `reset` (request) | 3 | 15 min | IP |
| `otp:send` | 3 | 5 min | phone, plus 10/hour per IP |
| `otp:verify` | 5 | 5 min | phone |
| `search` | 30 | 1 min | IP |
| `cart` (write) | 60 | 1 min | user |
| `checkout` | 10 | 5 min | user |
| `api` (public general) | 100 | 1 min | IP |
| `admin` | 200 | 1 min | user |

### The 429 contract

Status `429`, standard failure envelope from `prompts/backend.md`:

```json
{ "success": false, "error": { "code": "RATE_LIMITED", "message": "Too many requests. Try again shortly." } }
```

Headers on every limited response: `Retry-After: 60`, `X-RateLimit-Limit: 5`, `X-RateLimit-Remaining: 0`, `X-RateLimit-Reset: 1762940400`.

`X-RateLimit-Reset` is a Unix timestamp in seconds. Send the three `X-RateLimit-*` headers on successful responses too, so a client can back off before it is blocked.

### Progressive lockout

Keyed on the **account** (userId or normalized phone), never the IP. An attacker rotating IPs must not reset the counter.

| Failed logins | Consequence |
| --- | --- |
| 5 | 1 minute lock |
| 10 | 15 minute lock |
| 20 | Locked until manual unlock or 24 hours |

Keep the failure counter and lock expiry in Redis with a 24 hour TTL. A successful login clears both. Return the same generic message during lockout as for a wrong password, so the lock state is not an oracle.

### Never rate limited

Static assets, the Next.js image optimizer, `/health` and the readiness probe. Limiting these turns a traffic spike into an outage.

## 4. Sessions and tokens

| Token | TTL | Storage | Flags |
| --- | --- | --- | --- |
| Access | 15 minutes | HttpOnly cookie | `Secure`, `SameSite=Lax`, `Path=/` |
| Refresh | 7 days | HttpOnly cookie | `Secure`, `SameSite=Lax`, `Path=/api/v1/auth` |

**Why `Lax` and not `Strict`:** bKash, Nagad and card gateways return the buyer with a top-level cross-site GET. Under `Strict` the browser withholds the cookie on that navigation, the return handler sees an anonymous user, and order confirmation breaks. `Lax` still blocks cross-site POST, which is the case CSRF actually needs. `frontend.md` section 16 still shows `Strict` from the older draft; this table wins.

- Rotate the refresh token on every use; the old token is marked consumed server-side.
- Reuse detection: a consumed refresh token presented again means the family is compromised. Revoke the whole family and force re-login.
- The revocation list lives in Redis, keyed by token family id. The client never holds or reads it.
- Logout revokes the current family. Password change revokes every family for that user.
- "Log out everywhere" is a server-side revocation of all families, not a client flag, and it must work even if the client never calls again.

## 5. Password reset flow

1. `POST /auth/forgot-password` with an email or phone. Always respond `200` with the same body, whether or not the account exists.
2. Generate 32 random bytes. Send the raw token in the link. Store only `sha256(token)` with `userId`, `expiresAt` (now + 30 min) and `usedAt` (null).
3. Rate limit per IP and per account. One active token per user: issuing a new one invalidates the previous.
4. `POST /auth/reset-password` takes the raw token plus the new password. Hash it, look up by hash, reject if missing, expired or already used.
5. On success set `usedAt`, update the password hash, and revoke every session and refresh family for that user. A reset is a security event; anyone already logged in is logged out.
6. Never reveal whether the token was invalid versus expired.

## 6. Authorization

### Role to permission matrix

| Permission | customer | staff | manager | admin | super admin |
| --- | --- | --- | --- | --- | --- |
| Read own orders, addresses, reviews | yes | yes | yes | yes | yes |
| Write own cart and checkout | yes | yes | yes | yes | yes |
| Read any order | no | yes | yes | yes | yes |
| Update order status | no | yes | yes | yes | yes |
| Refund an order | no | no | yes | yes | yes |
| Read and write catalog | no | yes | yes | yes | yes |
| Read and write customers | no | read only | yes | yes | yes |
| Read and write coupons and campaigns | no | no | yes | yes | yes |
| Read and write settings | no | no | no | yes | yes |
| Manage staff and roles | no | no | no | no | yes |
| Read the audit log | no | no | yes | yes | yes |

Middleware checks the permission, not just the role name. A route declares the permission it needs; the role map is data, not a chain of `if` statements.

### Resource ownership rules

Every one of these is enforced in the query, not after the fetch.

| Resource | Rule checked server-side |
| --- | --- |
| Order | `where: { id, userId: session.userId }` for customer reads. Staff and above use a separate permissioned query |
| Address | `where: { id, userId: session.userId }`. Another account's address id must 404, not 403 |
| Review | Write requires a delivered order containing that product. Edit and delete require `review.userId === session.userId` |
| Cart | Keyed by `userId`. A guest cart id is claimed once at login and then owned |
| Invoice | Staff and above only, permissioned read, never public |
| Customer record | Customer sees own profile. Staff read-only. Manager and above write |

The UI may hide a control. The API must still reject it. A hidden button that the endpoint would accept is a live vulnerability with a nicer paint job.

## 7. Input validation and payloads

- Zod on body, query and params for every endpoint. No exceptions.
- Every schema uses `.strict()`. Unknown keys are rejected, not stripped silently.
- Every Prisma write takes an explicit field allowlist. Never `data: req.body`, never `data: { ...body }`.
- JSON bodies capped at 1 MB. Multipart capped per file (image 5 MB, video 50 MB) and per request. Reject before parsing.
- Client validation is UX. It exists so the user gets a fast error, not so the server can skip the check.

## 8. Security headers

Set once in `next.config.ts` `headers()` or in `middleware.ts`. Never per page, never per component.

| Header | Value |
| --- | --- |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://connect.facebook.net https://*.bkash.com https://*.nagad.com.bd; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://www.google-analytics.com https://*.bkash.com https://*.nagad.com.bd; frame-src https://*.bkash.com https://*.nagad.com.bd; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(self), payment=(self)` |
| `X-Frame-Options` | `DENY`, kept for older browsers alongside `frame-ancestors` |

The payment gateway and analytics domains in the CSP are not optional. Dropping them breaks checkout or kills tracking, and the next agent will "fix" it by loosening the whole policy. `frame-ancestors 'none'` is the clickjacking control; do not relax it to allow embedding.

## 9. CSRF

Double submit plus an Origin check, both required:

1. The server issues a random CSRF token bound to the session, readable by JS in a non-HttpOnly cookie (`csrf_token`).
2. Every state-changing request sends the same value in `X-CSRF-Token`.
3. The server compares header to cookie with a timing-safe compare and rejects on mismatch.
4. The server also checks `Origin` (falling back to `Referer`) against the allowlist on every non-GET request.

Interaction with `SameSite=Lax` from section 4: `Lax` already blocks cross-site POST, so CSRF is defence in depth rather than the only wall. Keep both. `Lax` also means a top-level cross-site GET carries the cookie, so no GET handler may mutate state.

## 10. Webhooks

Payment callbacks and courier status updates are untrusted input until proven otherwise.

- Verify the HMAC signature over the **raw** request body before any parsing. Use the gateway's documented header and algorithm, with a timing-safe compare.
- Reject any timestamp outside a 5 minute window to block replay.
- Store the provider's event or idempotency key server-side with a unique index. A duplicate delivery is a no-op, not a second state transition.
- Never trust a webhook body before the signature checks out. Not the amount, not the status, not the order id.
- Reconcile against our own record: the callback amount must match the total we computed.
- Courier "delivered" must not release COD funds on its own. It updates status; reconciliation is a separate step.

## 11. Enumeration and information leaks

| Surface | Rule |
| --- | --- |
| Login | Identical response and timing for unknown account and wrong password |
| Forgot password | Always `200`, always the same body, whether or not the account exists |
| Register | Do not confirm that an email or phone is already registered beyond the generic conflict message |
| Order tracking | Requires order number **and** the phone on the order. Either alone returns not found |
| Errors | Structured code and message only. No stack traces, no SQL, no internal paths, no internal ids |
| Public ids | Order numbers are non-sequential. Internal auto-increment ids never appear in a URL or response |

## 12. Logging

**Log:** auth events (login, logout, failed login, lockout, password reset, token reuse detected), every admin mutation (actor, action, entity, entityId, IP, timestamp), payment state transitions with the transaction id, and webhook signature failures.

**Never log:** passwords, password hashes, access or refresh tokens, CSRF tokens, OTP codes, full card data, or full phone numbers in plain text.

Redact at the logger level, not at each call site. A pino redact path list covering `req.headers.authorization`, `req.headers.cookie`, `body.password`, `body.otp`, `body.token` is the control. Phone numbers log masked (`+88017****5678`). A call-site convention will be forgotten by the third agent; a logger config will not.

## 13. Uploads

- Check magic bytes, not just MIME and extension. A `.php` renamed to `.jpg` passes the first two.
- Generate a random filename. Never use the client's filename in a path.
- Store outside the web root or in object storage. Never inside a directory the server will execute.
- Re-encode images server-side where practical, which strips embedded payloads.
- Serve uploads with `Content-Disposition: attachment` for anything not a known image type, plus `X-Content-Type-Options: nosniff`.

## 14. Admin hardening

- 2FA (TOTP) required for `admin` and `super admin`. Enforced at login, not offered as a setting.
- Shorter admin session TTL: access 15 minutes, refresh 8 hours, absolute cap 12 hours.
- Optional IP allowlist for `super admin`, configurable in settings, off by default so a mobile admin is not locked out.
- Every mutation writes to the audit log in the same transaction as the change. A mutation that succeeds without an audit row is a bug.
- Admin routes sit behind a separate permission middleware. "Is logged in" is not authorization.

## 15. Dependency and secret hygiene

- `npm audit` runs in CI. A high or critical advisory fails the build.
- No secret in the repo, ever, including test fixtures and seed files.
- Every new environment variable lands in `.env.example` in the same commit, name only, no value.
- Never read or print a real `.env`.

## 16. Verification checklist

An agent may not mark a security-touching phase done until every box is a genuine yes.

- [ ] Every endpoint has a Zod schema with `.strict()` on body, query and params
- [ ] Every resource read and write filters by owner in the query, not after the fetch
- [ ] Every price, discount, delivery charge and total is recomputed server-side at checkout
- [ ] Rate limits exist on login, register, reset, OTP and checkout, and return the 429 contract
- [ ] Account lockout is keyed on the account, not the IP
- [ ] Refresh rotation and reuse detection are implemented, with server-side revocation
- [ ] Password reset tokens are single-use, hashed at rest, 30 minute TTL, and revoke all sessions
- [ ] CSRF double submit plus Origin check is live on every state-changing route
- [ ] Webhook handlers verify HMAC over the raw body and dedupe on an idempotency key
- [ ] Security headers are set in `next.config.ts` or middleware, with payment and analytics domains allowed
- [ ] No secret, token, OTP or full phone number reaches a log line
- [ ] `npm audit` is clean at high and critical, and `.env.example` matches the code
