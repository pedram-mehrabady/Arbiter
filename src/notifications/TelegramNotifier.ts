import fs from 'node:fs/promises';
import { ADMIN_CONFIG_PATH } from '../constants';

export type NotifyAudience = 'owner' | 'tech_lead';

export interface AdminTelegramConfig {
  bot_token: string;
  owner_chat_id: string;
  tech_lead_chat_id?: string;
}

export interface AdminConfig {
  telegram?: AdminTelegramConfig;
}

/** Minimal notifier shape consumers can depend on without importing the class. */
export interface Notifier {
  send(text: string, audience?: NotifyAudience): Promise<void>;
}

/** A notifier that does nothing — the safe default when notifications are off. */
export const NO_OP_NOTIFIER: Notifier = { async send() { /* no-op */ } };

/**
 * Sends messages to Telegram using admin config at ~/.arbiter/admin.config.json
 * (never committed to a project repo). Silently disabled when the file is absent
 * or incomplete, and always disabled under tests (VITEST) so suites never emit.
 */
export class TelegramNotifier implements Notifier {
  private config: AdminTelegramConfig | null = null;
  private loaded = false;

  constructor(private readonly adminConfigPath: string = ADMIN_CONFIG_PATH) {}

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await fs.readFile(this.adminConfigPath, 'utf-8');
      const parsed = JSON.parse(raw) as AdminConfig;
      this.config = parsed.telegram ?? null;
    } catch {
      this.config = null; // missing / invalid → disabled
    }
  }

  /** True only when a bot token and an owner chat id are both configured. */
  async isConfigured(): Promise<boolean> {
    if (process.env['VITEST']) return false;
    await this.load();
    return !!(this.config?.bot_token && this.config?.owner_chat_id);
  }

  async send(text: string, audience: NotifyAudience = 'owner'): Promise<void> {
    if (process.env['VITEST']) return; // never send during tests
    await this.load();
    if (!this.config?.bot_token) return;

    const chatId = audience === 'tech_lead'
      ? (this.config.tech_lead_chat_id ?? this.config.owner_chat_id)
      : this.config.owner_chat_id;
    if (!chatId) return;

    try {
      await fetch(`https://api.telegram.org/bot${this.config.bot_token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
      });
    } catch {
      // Network error — notifications are best-effort, never fatal.
    }
  }
}
