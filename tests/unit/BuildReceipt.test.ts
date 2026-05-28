import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BuildReceiptStore, ReceiptInput } from '../../src/receipts/BuildReceipt';

const makeRoot = () => fs.mkdtemp(path.join(os.tmpdir(), 'arbiter-receipt-'));

const baseInput = (): ReceiptInput => ({
  taskId: 'T1',
  subTask: 'reframe',
  agentRole: 'reframe',
  model: 'claude-sonnet-4-6',
  contextHash: 'sha256:abc123',
  outputFiles: [],
  inputTokens: 1000,
  outputTokens: 500,
  costUsd: 0.01,
  failureClass: null,
  strikeCount: 0,
  debuggerInvoked: false,
  debuggerDiffHash: null,
  debuggerDiffPct: null,
});

describe('BuildReceiptStore', () => {
  let root: string;
  let store: BuildReceiptStore;

  beforeEach(async () => {
    root = await makeRoot();
    store = new BuildReceiptStore(root);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('readAll returns empty array when no receipts file exists', async () => {
    const r = await store.readAll();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual([]);
  });

  it('ensureSigningKey generates key pair on first call', async () => {
    const r = await store.ensureSigningKey();
    expect(r.ok).toBe(true);
    const keyPath = path.join(root, 'arbiter', 'signing-key.pem');
    const pubPath = path.join(root, 'arbiter', 'signing-key-pub.pem');
    await expect(fs.access(keyPath)).resolves.toBeUndefined();
    await expect(fs.access(pubPath)).resolves.toBeUndefined();
  });

  it('ensureSigningKey is idempotent', async () => {
    await store.ensureSigningKey();
    const r = await store.ensureSigningKey();
    expect(r.ok).toBe(true);
  });

  it('create writes a receipt with a valid receipt_id', async () => {
    const r = await store.create(baseInput());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.receipt_id).toMatch(/^rec_/);
    expect(r.value.task_id).toBe('T1');
    expect(r.value.agent_role).toBe('reframe');
    expect(r.value.signature).toBeTruthy();
    expect(r.value.signer_public_key_fingerprint).toMatch(/^SHA256:/);
  });

  it('create persists receipt so readAll returns it', async () => {
    await store.create(baseInput());
    const all = await store.readAll();
    if (!all.ok) return;
    expect(all.value).toHaveLength(1);
  });

  it('create appends multiple receipts', async () => {
    await store.create(baseInput());
    await store.create({ ...baseInput(), subTask: 'research', agentRole: 'research' });
    const all = await store.readAll();
    if (!all.ok) return;
    expect(all.value).toHaveLength(2);
  });

  it('verify returns true for a freshly created receipt', async () => {
    const c = await store.create(baseInput());
    if (!c.ok) return;
    const v = await store.verify(c.value.receipt_id);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.value).toBe(true);
  });

  it('verify returns NOT_FOUND for unknown receipt id', async () => {
    await store.ensureSigningKey();
    const v = await store.verify('rec_nonexistent');
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe('NOT_FOUND');
  });

  it('verify returns false after receipt is tampered with', async () => {
    const c = await store.create(baseInput());
    if (!c.ok) return;

    const receiptsPath = path.join(root, 'arbiter', 'receipts.jsonl');
    const content = await fs.readFile(receiptsPath, 'utf-8');
    const receipt = JSON.parse(content.trim());
    receipt.cost_usd = 999.99;
    await fs.writeFile(receiptsPath, JSON.stringify(receipt) + '\n');

    const v = await store.verify(c.value.receipt_id);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.value).toBe(false);
  });
});
