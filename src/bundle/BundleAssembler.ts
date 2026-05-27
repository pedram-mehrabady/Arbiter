import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import { zipSync } from 'fflate';
import { BuildReceipt, TaskState, ServiceResult } from '../types/index';
import { BuildReceiptStore } from '../receipts/BuildReceipt';
import { DecisionLog } from '../decisions/DecisionLog';
import { GitCommitReader } from './GitCommitReader';
import { BundleManifestBuilder, ALC_ARTIFACT_MAP, BundleManifest } from './BundleManifest';

const BUNDLE_DIR = path.join('.arbiter', 'bundles');
const SIGNING_KEY_FILE = path.join('.arbiter', 'signing-key.pem');
const PUBLIC_KEY_FILE = path.join('.arbiter', 'signing-key-pub.pem');

// Maps bundle-relative destination paths to their source locations under
// .arbiter/tasks/<taskId>/. A null source means the file is generated.
const ARTIFACT_SOURCE_MAP: Array<{
  dest: string;
  srcFile: string | null;
  generated: boolean;
}> = [
  { dest: '01-requirements/spec.md',                srcFile: 'task.md',                   generated: false },
  { dest: '01-requirements/reframe-output.md',      srcFile: 'reframe-output.md',          generated: false },
  { dest: '02-impact-analysis/research-output.md',  srcFile: 'research-output.md',         generated: false },
  { dest: '03-design/design.md',                    srcFile: 'design-output.md',           generated: false },
  { dest: '03-design/design-critic.md',             srcFile: 'design-critic-output.md',    generated: false },
  { dest: '03-design/integrator-output.md',         srcFile: 'integrator-output.md',       generated: false },
  { dest: '04-implementation-plan/plan-output.md',  srcFile: 'plan-output.md',             generated: false },
  { dest: '06-tests/test-writer-output.md',         srcFile: 'test-writer-output.md',      generated: false },
  { dest: '07-review/reviewer-report.md',           srcFile: 'reviewer-output.md',         generated: false },
  { dest: '08-documentation/tech-writer-output.md', srcFile: 'tech-writer-output.md',      generated: false },
  { dest: '05-implementation/git-commits.json',     srcFile: null,                         generated: true  },
  { dest: '09-audit-trail/decision-log-excerpt.jsonl', srcFile: null,                      generated: true  },
  { dest: '09-audit-trail/receipt-chain-verify.txt',  srcFile: null,                      generated: true  },
  { dest: 'manifest.json',                          srcFile: null,                         generated: true  },
];

export interface BundleResult {
  zipPath: string;
  sigPath: string;
  bundleId: string;
  manifest: BundleManifest;
  presentArtifacts: string[];
  missingArtifacts: string[];
}

export class BundleAssembler {
  private readonly receipts: BuildReceiptStore;
  private readonly decisionLog: DecisionLog;
  private readonly gitReader: GitCommitReader;
  private readonly manifestBuilder = new BundleManifestBuilder();
  private readonly workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.receipts = new BuildReceiptStore(workspaceRoot);
    this.decisionLog = new DecisionLog(workspaceRoot);
    this.gitReader = new GitCommitReader(workspaceRoot);
  }

  async assemble(taskId: string, state: TaskState): Promise<ServiceResult<BundleResult>> {
    const taskDir = path.join(this.workspaceRoot, '.arbiter', 'tasks', taskId);
    const bundleDir = path.join(this.workspaceRoot, BUNDLE_DIR);
    const zipPath = path.join(bundleDir, `${taskId}-AFTA-EVIDENCE-BUNDLE.zip`);
    const sigPath = `${zipPath}.sig`;

    await fs.mkdir(bundleDir, { recursive: true });

    // Ensure signing key exists before we try to sign anything
    const keyResult = await this.receipts.ensureSigningKey();
    if (!keyResult.ok) return keyResult;

    // ── 1. Load all supporting data ─────────────────────────────────────────
    const [allReceiptsResult, gitCommitsResult, allLogResult] = await Promise.all([
      this.receipts.readAll(),
      this.gitReader.getTaskCommits(taskId),
      this.decisionLog.readAll(),
    ]);

    if (!allReceiptsResult.ok) return allReceiptsResult;
    if (!allLogResult.ok) return allLogResult;

    const taskReceipts = allReceiptsResult.value.filter(r => r.task_id === taskId);
    const gitCommits = gitCommitsResult.ok ? gitCommitsResult.value : [];
    const taskLogEntries = allLogResult.value.filter(e => e.task_id === taskId);

    // ── 2. Collect artifact files ────────────────────────────────────────────
    const zipEntries: Record<string, Uint8Array> = {};
    const presentArtifacts: string[] = [];
    const missingArtifacts: string[] = [];

    for (const { dest, srcFile, generated } of ARTIFACT_SOURCE_MAP) {
      if (generated) continue; // handled below

      const srcPath = path.join(taskDir, srcFile!);
      try {
        const content = await fs.readFile(srcPath);
        zipEntries[dest] = new Uint8Array(content);
        if (dest in ALC_ARTIFACT_MAP) presentArtifacts.push(dest);
      } catch {
        if (dest in ALC_ARTIFACT_MAP) missingArtifacts.push(dest);
        // Non-ALC artifacts (like design-critic) are optional — silently skip
      }
    }

    // ── 3. Per-receipt JSON files in 05-implementation/receipts/ ────────────
    for (const receipt of taskReceipts) {
      const destPath = `05-implementation/receipts/${receipt.receipt_id}.json`;
      zipEntries[destPath] = new Uint8Array(
        Buffer.from(JSON.stringify(receipt, null, 2), 'utf-8'),
      );
    }
    if (taskReceipts.length > 0) presentArtifacts.push('05-implementation/git-commits.json');

    // ── 4. Generated: git-commits.json ──────────────────────────────────────
    const gitCommitsJson = JSON.stringify(
      {
        task_id: taskId,
        generated_at: new Date().toISOString(),
        commits: gitCommits.map(c => ({
          hash: c.hash,
          short_hash: c.shortHash,
          subject: c.subject,
          timestamp: c.timestamp,
          receipt_id: c.receiptId ?? null,
        })),
      },
      null,
      2,
    );
    zipEntries['05-implementation/git-commits.json'] = new Uint8Array(
      Buffer.from(gitCommitsJson, 'utf-8'),
    );

    // ── 5. Generated: decision-log-excerpt.jsonl ─────────────────────────────
    const logExcerpt = taskLogEntries.map(e => JSON.stringify(e)).join('\n') + '\n';
    zipEntries['09-audit-trail/decision-log-excerpt.jsonl'] = new Uint8Array(
      Buffer.from(logExcerpt, 'utf-8'),
    );

    // ── 6. Generated: receipt-chain-verify.txt ───────────────────────────────
    const chainVerifyText = await this.buildChainVerifyReport(taskReceipts);
    zipEntries['09-audit-trail/receipt-chain-verify.txt'] = new Uint8Array(
      Buffer.from(chainVerifyText, 'utf-8'),
    );

    // ── 7. Build manifest (without hash/sig — computed after ZIP) ────────────
    const taskMdPath = path.join(taskDir, 'task.md');
    const featureName = await this.manifestBuilder.extractFeatureName(taskMdPath, taskId);
    const completedAt = state.updated_at;

    const manifestBody = this.manifestBuilder.build({
      taskId,
      featureName,
      completedAt,
      gitCommits,
      receipts: taskReceipts,
      presentArtifacts,
      missingArtifacts,
    });

    // Placeholder hash/sig — replaced with real values after zipping
    const manifestPlaceholder: BundleManifest = {
      ...manifestBody,
      bundle_hash: 'sha256:COMPUTING',
      bundle_signature: 'COMPUTING',
    };
    zipEntries['manifest.json'] = new Uint8Array(
      Buffer.from(JSON.stringify(manifestPlaceholder, null, 2), 'utf-8'),
    );

    // ── 8. Create ZIP ─────────────────────────────────────────────────────────
    const zipped = zipSync(zipEntries, { level: 6 });
    const zipBuffer = Buffer.from(zipped);

    // ── 9. Compute bundle hash and sign ───────────────────────────────────────
    const bundleHash = `sha256:${createHash('sha256').update(zipBuffer).digest('hex')}`;
    const bundleSignature = await this.signBundleHash(bundleHash);

    // ── 10. Re-create ZIP with real manifest ──────────────────────────────────
    const finalManifest: BundleManifest = {
      ...manifestBody,
      bundle_hash: bundleHash,
      bundle_signature: bundleSignature,
    };
    zipEntries['manifest.json'] = new Uint8Array(
      Buffer.from(JSON.stringify(finalManifest, null, 2), 'utf-8'),
    );

    const finalZipped = zipSync(zipEntries, { level: 6 });
    const finalZipBuffer = Buffer.from(finalZipped);

    await fs.writeFile(zipPath, finalZipBuffer);

    // ── 11. Write sidecar signature file ─────────────────────────────────────
    // The sidecar signs the final ZIP bytes (after manifest injection).
    const finalZipHash = `sha256:${createHash('sha256').update(finalZipBuffer).digest('hex')}`;
    const finalSig = await this.signBundleHash(finalZipHash);
    await fs.writeFile(sigPath, JSON.stringify({ bundle_hash: finalZipHash, signature: finalSig }, null, 2), 'utf-8');

    // ── 12. Log the bundle creation ───────────────────────────────────────────
    await this.decisionLog.append({
      task_id: taskId,
      event: 'bundle_created',
      detail: `bundle_id=${finalManifest.bundle_id} zip=${zipPath} alc=${finalManifest.alc_controls_covered.join(',')} missing=${missingArtifacts.join(',') || 'none'}`,
    });

    return {
      ok: true,
      value: {
        zipPath,
        sigPath,
        bundleId: finalManifest.bundle_id,
        manifest: finalManifest,
        presentArtifacts,
        missingArtifacts,
      },
    };
  }

  async verify(zipPath: string): Promise<ServiceResult<{ valid: boolean; bundleHash: string }>> {
    const sigPath = `${zipPath}.sig`;

    try {
      const [zipBuffer, sigContent, publicKeyPem] = await Promise.all([
        fs.readFile(zipPath),
        fs.readFile(sigPath, 'utf-8'),
        fs.readFile(path.join(this.workspaceRoot, PUBLIC_KEY_FILE), 'utf-8'),
      ]);

      const { bundle_hash, signature } = JSON.parse(sigContent) as {
        bundle_hash: string;
        signature: string;
      };

      // Verify stored hash matches actual ZIP bytes
      const actualHash = `sha256:${createHash('sha256').update(zipBuffer).digest('hex')}`;
      if (actualHash !== bundle_hash) {
        return { ok: true, value: { valid: false, bundleHash: actualHash } };
      }

      // Ed25519: pass null algorithm — the curve handles hashing internally
      const valid = cryptoVerify(
        null,
        Buffer.from(bundle_hash),
        publicKeyPem,
        Buffer.from(signature, 'base64'),
      );

      return { ok: true, value: { valid, bundleHash: actualHash } };
    } catch (err) {
      return { ok: false, error: `Bundle verification failed: ${String(err)}` };
    }
  }

  async listBundles(): Promise<ServiceResult<string[]>> {
    const bundleDir = path.join(this.workspaceRoot, BUNDLE_DIR);
    try {
      const entries = await fs.readdir(bundleDir);
      return {
        ok: true,
        value: entries.filter(e => e.endsWith('-AFTA-EVIDENCE-BUNDLE.zip')),
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { ok: true, value: [] };
      }
      return { ok: false, error: String(err) };
    }
  }

  private async buildChainVerifyReport(receipts: BuildReceipt[]): Promise<string> {
    const lines: string[] = [
      `Arbiter Receipt Chain Verification`,
      `Generated: ${new Date().toISOString()}`,
      `Receipts: ${receipts.length}`,
      '',
    ];

    let passed = 0;
    let failed = 0;

    for (const receipt of receipts) {
      const result = await this.receipts.verify(receipt.receipt_id);
      if (result.ok && result.value) {
        lines.push(`PASS  ${receipt.receipt_id}  ${receipt.agent_role}/${receipt.model}`);
        passed++;
      } else {
        lines.push(`FAIL  ${receipt.receipt_id}  ${result.ok ? 'invalid signature' : result.error}`);
        failed++;
      }
    }

    lines.push('');
    lines.push(`Result: ${passed} passed, ${failed} failed`);
    return lines.join('\n');
  }

  private async signBundleHash(hash: string): Promise<string> {
    try {
      const privateKey = await fs.readFile(
        path.join(this.workspaceRoot, SIGNING_KEY_FILE),
        'utf-8',
      );
      // Ed25519: pass null algorithm — the curve handles hashing internally
      return cryptoSign(null, Buffer.from(hash), privateKey).toString('base64');
    } catch {
      return 'UNSIGNED';
    }
  }
}
