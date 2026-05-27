import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, createSign, createVerify, generateKeyPairSync } from 'node:crypto';
import { BuildReceipt, AgentRole, FailureClass, ServiceResult } from '../types/index';

const RECEIPTS_FILE = path.join('.arbiter', 'receipts.jsonl');
const SIGNING_KEY_FILE = path.join('.arbiter', 'signing-key.pem');
const PUBLIC_KEY_FILE = path.join('.arbiter', 'signing-key-pub.pem');

export interface ReceiptInput {
  taskId: string;
  subTask: string;
  agentRole: AgentRole;
  model: string;
  contextHash: string;
  outputFiles: string[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  failureClass: FailureClass | null;
  strikeCount: number;
  debuggerInvoked: boolean;
  debuggerDiffHash: string | null;
  debuggerDiffPct: number | null;
}

export class BuildReceiptStore {
  private readonly receiptsPath: string;
  private readonly signingKeyPath: string;
  private readonly publicKeyPath: string;

  constructor(workspaceRoot: string) {
    this.receiptsPath = path.join(workspaceRoot, RECEIPTS_FILE);
    this.signingKeyPath = path.join(workspaceRoot, SIGNING_KEY_FILE);
    this.publicKeyPath = path.join(workspaceRoot, PUBLIC_KEY_FILE);
  }

  async ensureSigningKey(): Promise<ServiceResult<void>> {
    try {
      await fs.access(this.signingKeyPath);
      return { ok: true, value: undefined };
    } catch {
      return this.generateSigningKey();
    }
  }

  async generateSigningKey(): Promise<ServiceResult<void>> {
    try {
      await fs.mkdir(path.dirname(this.signingKeyPath), { recursive: true });
      const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
      });
      await fs.writeFile(this.signingKeyPath, privateKey, { mode: 0o600 });
      await fs.writeFile(this.publicKeyPath, publicKey);
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: `Failed to generate signing key: ${String(err)}` };
    }
  }

  async create(input: ReceiptInput): Promise<ServiceResult<BuildReceipt>> {
    const keyResult = await this.ensureSigningKey();
    if (!keyResult.ok) return keyResult;

    const privateKey = await fs.readFile(this.signingKeyPath, 'utf-8').catch(
      err => { throw new Error(`Cannot read signing key: ${err}`); },
    );
    const publicKey = await fs.readFile(this.publicKeyPath, 'utf-8').catch(
      err => { throw new Error(`Cannot read public key: ${err}`); },
    );

    const outputHashes = await this.hashOutputFiles(input.outputFiles);
    const receiptId = this.buildReceiptId(input.taskId, input.subTask);
    const invocationTs = new Date().toISOString();
    const pubKeyFingerprint = this.fingerprintPublicKey(publicKey);

    const payload: Omit<BuildReceipt, 'signature' | 'signer_public_key_fingerprint'> = {
      receipt_id: receiptId,
      task_id: input.taskId,
      sub_task: input.subTask,
      agent_role: input.agentRole,
      model: input.model,
      invocation_ts: invocationTs,
      context_hash: input.contextHash,
      output_hashes: outputHashes,
      input_tokens: input.inputTokens,
      output_tokens: input.outputTokens,
      cost_usd: input.costUsd,
      failure_class: input.failureClass,
      strike_count: input.strikeCount,
      debugger_invoked: input.debuggerInvoked,
      debugger_diff_hash: input.debuggerDiffHash,
      debugger_diff_pct: input.debuggerDiffPct,
    };

    const signature = this.sign(JSON.stringify(payload), privateKey);

    const receipt: BuildReceipt = {
      ...payload,
      signature,
      signer_public_key_fingerprint: pubKeyFingerprint,
    };

    const appendResult = await this.append(receipt);
    if (!appendResult.ok) return appendResult;

    return { ok: true, value: receipt };
  }

  async verify(receiptId: string): Promise<ServiceResult<boolean>> {
    const allResult = await this.readAll();
    if (!allResult.ok) return allResult;

    const receipt = allResult.value.find(r => r.receipt_id === receiptId);
    if (!receipt) {
      return { ok: false, error: `Receipt ${receiptId} not found`, code: 'NOT_FOUND' };
    }

    try {
      const publicKey = await fs.readFile(this.publicKeyPath, 'utf-8');
      const { signature, signer_public_key_fingerprint: _fp, ...payload } = receipt;
      const verifier = createVerify('ed25519');
      verifier.update(JSON.stringify(payload));
      const valid = verifier.verify(publicKey, signature, 'base64');
      return { ok: true, value: valid };
    } catch (err) {
      return { ok: false, error: `Verification failed: ${String(err)}` };
    }
  }

  async readAll(): Promise<ServiceResult<BuildReceipt[]>> {
    try {
      const content = await fs.readFile(this.receiptsPath, 'utf-8');
      const receipts = content
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line) as BuildReceipt);
      return { ok: true, value: receipts };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { ok: true, value: [] };
      }
      return { ok: false, error: `Failed to read receipts: ${String(err)}` };
    }
  }

  private async append(receipt: BuildReceipt): Promise<ServiceResult<void>> {
    try {
      await fs.mkdir(path.dirname(this.receiptsPath), { recursive: true });
      await fs.appendFile(this.receiptsPath, JSON.stringify(receipt) + '\n', 'utf-8');
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: `Failed to append receipt: ${String(err)}` };
    }
  }

  private async hashOutputFiles(files: string[]): Promise<Record<string, string>> {
    const hashes: Record<string, string> = {};
    for (const f of files) {
      try {
        const content = await fs.readFile(f);
        hashes[f] = `sha256:${createHash('sha256').update(content).digest('hex')}`;
      } catch {
        hashes[f] = 'sha256:MISSING';
      }
    }
    return hashes;
  }

  private sign(payload: string, privateKeyPem: string): string {
    const signer = createSign('ed25519');
    signer.update(payload);
    return signer.sign(privateKeyPem, 'base64');
  }

  private fingerprintPublicKey(publicKeyPem: string): string {
    return `SHA256:${createHash('sha256').update(publicKeyPem).digest('base64')}`;
  }

  private buildReceiptId(taskId: string, subTask: string): string {
    const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
    return `rec_${ts}_${taskId}_${subTask}`;
  }
}
