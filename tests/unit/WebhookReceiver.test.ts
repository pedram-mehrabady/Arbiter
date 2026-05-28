import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import http from 'node:http';
import { WebhookReceiver, WEBHOOK_PORT } from '../../src/webhooks/WebhookReceiver';
import { CiResultHandler } from '../../src/webhooks/CiResultHandler';
import type { SqliteStore } from '../../src/state/SqliteStore';

function makeStore(): SqliteStore {
  return {
    appendEvent: vi.fn(),
    upsertTask: vi.fn(),
    getOrchestratorState: vi.fn(),
  } as unknown as SqliteStore;
}

function makeHandlers() {
  return {
    onCiResult: vi.fn().mockResolvedValue(undefined),
    onPrComment: vi.fn().mockResolvedValue(undefined),
  };
}

function sign(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

async function postWebhook(
  body: string,
  eventType: string,
  signature?: string,
  port = WEBHOOK_PORT,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path: '/webhook', method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-github-event': eventType,
          ...(signature ? { 'x-hub-signature-256': signature } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Use a different port per test file to avoid conflicts
const TEST_PORT = WEBHOOK_PORT + 100;

describe('WebhookReceiver', () => {
  const SECRET = 'test-secret-123';
  let receiver: WebhookReceiver;
  let store: SqliteStore;
  let handlers: ReturnType<typeof makeHandlers>;

  beforeEach(async () => {
    store = makeStore();
    handlers = makeHandlers();
    receiver = new WebhookReceiver(store, SECRET, handlers);
    // Override port for testing by monkey-patching the server
    await new Promise<void>((resolve, reject) => {
      const srv = (receiver as unknown as { server: http.Server | null }).server;
      const s = http.createServer();
      s.listen(TEST_PORT, '127.0.0.1', () => {
        s.close();
        resolve();
      });
      s.once('error', reject);
    }).catch(() => {}); // Port may already be free
  });

  afterEach(async () => {
    await receiver.stop();
  });

  it('validateSignature returns true for valid HMAC signature', () => {
    const body = Buffer.from('{"action":"test"}');
    const sig = `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;
    expect(receiver.validateSignature(body, sig)).toBe(true);
  });

  it('validateSignature returns false for invalid HMAC signature', () => {
    const body = Buffer.from('{"action":"test"}');
    expect(receiver.validateSignature(body, 'sha256=invalidsignature')).toBe(false);
  });

  it('validateSignature returns false for missing signature when secret is set', () => {
    const body = Buffer.from('{}');
    expect(receiver.validateSignature(body, '')).toBe(false);
  });

  it('validateSignature returns true when no secret is configured', () => {
    const noSecretReceiver = new WebhookReceiver(store, '', handlers);
    const body = Buffer.from('{}');
    expect(noSecretReceiver.validateSignature(body, '')).toBe(true);
  });

  it('CiResultHandler.extractTaskIdFromBranch extracts from feat/arbiter-FEAT-001-add-login', () => {
    expect(CiResultHandler.extractTaskIdFromBranch('feat/arbiter-FEAT-001-add-login')).toBe('FEAT-001');
  });

  it('CiResultHandler.extractTaskIdFromBranch returns empty for non-matching branch', () => {
    expect(CiResultHandler.extractTaskIdFromBranch('main')).toBe('');
  });

  it('CiResultHandler.extractTaskIdFromBranch handles arbiter/TASK-123 format', () => {
    expect(CiResultHandler.extractTaskIdFromBranch('arbiter/TASK-123')).toBe('TASK-123');
  });
});
