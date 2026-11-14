/**
 * Telegram transport — a shop's own alert channel.
 *
 * ── Why Telegram and not push ──────────────────────────────────────────────
 *
 * A new order has to reach someone in under a minute, on a phone, without an
 * app store, a build, or a device token table. A Telegram bot does that with two
 * environment variables and no dependency: the operator creates a bot with
 * @BotFather, sends it one message, and the chat id is in `getUpdates`.
 *
 * ── Why the chat id is not in the environment only ─────────────────────────
 *
 * The bot token is a secret and lives in `.env`. The chat id is not a secret — it
 * is "which conversation receives alerts" — and it is the thing an operator is
 * most likely to want to change (a new manager, a second group). It lives in
 * settings, with `TELEGRAM_CHAT_ID` as the fallback for an install that has not
 * opened the panel yet.
 *
 * Same contract as the mailer: never throws, returns a reason.
 */

import { env } from '../../config/env.js';
import { getSettings } from '../settings.service.js';

const TIMEOUT_MS = 8_000;

export interface TelegramResult {
  ok: boolean;
  reason?: string;
}

/** True when a bot token exists. The chat id is checked per send. */
export function telegramConfigured(): boolean {
  return Boolean(env.TELEGRAM_BOT_TOKEN);
}

/** The chat id from settings, falling back to the environment. */
export async function telegramChatId(): Promise<string | null> {
  const settings = await getSettings();
  const fromSettings = settings['notify.telegramChatId']?.trim();
  if (fromSettings) return fromSettings;
  return env.TELEGRAM_CHAT_ID?.trim() || null;
}

/**
 * Sends one message.
 *
 * `parse_mode: 'HTML'` rather than Markdown: Telegram's Markdown parser breaks
 * on an underscore in a product name, and a product name with an underscore is
 * not a rare event in this catalogue. The caller is responsible for escaping
 * `&`, `<` and `>` — `escapeTelegram()` below does it.
 */
export async function sendTelegram(text: string, chatIdOverride?: string): Promise<TelegramResult> {
  if (!telegramConfigured()) {
    return { ok: false, reason: 'TELEGRAM_BOT_TOKEN is not set' };
  }

  const chatId = chatIdOverride?.trim() || (await telegramChatId());
  if (!chatId) {
    return { ok: false, reason: 'No Telegram chat id configured' };
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { description?: string }
        | null;
      return {
        ok: false,
        reason: `telegram ${response.status}: ${body?.description ?? 'no detail'}`,
      };
    }

    return { ok: true };
  } catch (error) {
    const reason =
      error instanceof Error && error.name === 'TimeoutError'
        ? 'telegram timed out after 8s'
        : error instanceof Error
          ? error.message
          : 'unknown transport error';
    return { ok: false, reason };
  }
}

/** Escapes the three characters Telegram's HTML mode treats as markup. */
export function escapeTelegram(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
