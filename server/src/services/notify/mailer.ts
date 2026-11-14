/**
 * Email transport — Resend.
 *
 * ── Why Resend and not SMTP ────────────────────────────────────────────────
 *
 * cPanel hosts routinely block outbound 587/465, and the ones that allow it
 * throttle to a few hundred an hour. An HTTPS API has neither problem, needs no
 * dependency, and gives a message id per send that can be pasted into a support
 * ticket. The whole transport is one `fetch`.
 *
 * ── What this module refuses to do ─────────────────────────────────────────
 *
 * Throw. Every caller is either inside a request or inside a queue drainer, and
 * neither should fail because a mail provider had a bad minute. `sendEmail`
 * returns `{ ok, reason }` and the caller records the reason on the row.
 */

import { env } from '../../config/env.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** Long enough for a slow API, short enough that a wedged host cannot stall a request. */
const TIMEOUT_MS = 8_000;

export interface SendResult {
  ok: boolean;
  /** Provider message id when accepted. */
  id?: string;
  /** Human-readable failure. Stored on the Notification row. */
  reason?: string;
}

export interface EmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/** True when a key and a From address are both present. */
export function mailConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY && env.MAIL_FROM);
}

/**
 * Sends one email.
 *
 * `from` comes from the environment, never from a caller: a template that could
 * set the From address is a template that can impersonate any domain the
 * operator has verified.
 */
export async function sendEmail(input: EmailInput): Promise<SendResult> {
  if (!mailConfigured()) {
    return { ok: false, reason: 'RESEND_API_KEY or MAIL_FROM is not set' };
  }

  if (!input.to || !input.to.includes('@')) {
    return { ok: false, reason: `invalid recipient: ${input.to || '(empty)'}` };
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: env.MAIL_FROM,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        ...(input.text ? { text: input.text } : {}),
        ...(env.MAIL_REPLY_TO ? { reply_to: env.MAIL_REPLY_TO } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const body = (await response.json().catch(() => null)) as
      | { id?: string; message?: string; name?: string }
      | null;

    if (!response.ok) {
      /**
       * Resend's error bodies are useful — "domain is not verified", "invalid
       * from address" — and they are exactly what an operator needs to see on
       * the failed row. Flattening them to "send failed" would turn a two-minute
       * fix into a support thread.
       */
      const detail = body?.message ?? body?.name ?? `HTTP ${response.status}`;
      return { ok: false, reason: `resend ${response.status}: ${detail}` };
    }

    return { ok: true, id: body?.id };
  } catch (error) {
    const reason =
      error instanceof Error && error.name === 'TimeoutError'
        ? 'resend timed out after 8s'
        : error instanceof Error
          ? error.message
          : 'unknown transport error';
    return { ok: false, reason };
  }
}
