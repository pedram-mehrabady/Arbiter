import { describe, it, expect, vi, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { TelegramNotifier, NO_OP_NOTIFIER } from '../../src/notifications/TelegramNotifier';

function writeAdminConfig(contents: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arbiter-admin-'));
  const p = path.join(dir, 'admin.config.json');
  fs.writeFileSync(p, JSON.stringify(contents));
  return p;
}

describe('TelegramNotifier', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('NO_OP_NOTIFIER.send resolves without doing anything', async () => {
    await expect(NO_OP_NOTIFIER.send('hello')).resolves.toBeUndefined();
  });

  it('isConfigured is false under VITEST even with a valid config', async () => {
    const p = writeAdminConfig({ telegram: { bot_token: 't', owner_chat_id: '1' } });
    const n = new TelegramNotifier(p);
    expect(await n.isConfigured()).toBe(false); // VITEST env guard
  });

  it('send never calls fetch under VITEST', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null));
    const p = writeAdminConfig({ telegram: { bot_token: 't', owner_chat_id: '1' } });
    await new TelegramNotifier(p).send('hi');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('isConfigured is false when the admin config is missing (env guard aside)', async () => {
    vi.stubEnv('VITEST', '');
    const n = new TelegramNotifier('/nonexistent/admin.config.json');
    expect(await n.isConfigured()).toBe(false);
  });

  it('isConfigured is false when bot_token is absent', async () => {
    vi.stubEnv('VITEST', '');
    const p = writeAdminConfig({ telegram: { owner_chat_id: '1' } });
    const n = new TelegramNotifier(p);
    expect(await n.isConfigured()).toBe(false);
  });

  it('isConfigured is true with a complete config when not under VITEST', async () => {
    vi.stubEnv('VITEST', '');
    const p = writeAdminConfig({ telegram: { bot_token: 't', owner_chat_id: '1' } });
    const n = new TelegramNotifier(p);
    expect(await n.isConfigured()).toBe(true);
  });
});
