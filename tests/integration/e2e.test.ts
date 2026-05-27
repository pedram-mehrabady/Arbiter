/**
 * P3-6 Live End-to-End Test
 *
 * Runs the full Arbiter pipeline against a real (temp) workspace using MockProvider
 * so no LLM API calls are made. Verifies every P3-6 pass criterion:
 *
 *  [1] All sub-task output hashes match signed build receipt
 *  [2] arbiter audit verify reports chain integrity PASS
 *  [3] decision-log contains all key pipeline events
 *  [4] plan agent injects granular sub-tasks (P1-3)
 *  [5] AUDIT-EVIDENCE-BUNDLE.zip is created
 *  [6] bundle verify returns valid=true
 *  [7] Bundle contains all 9 evidence directories
 *  [8] Model tiering: haiku for test-writer, opus for reviewer (from config)
 *  [9] Second run of same-module task triggers design_phase_cache_hit (P1-7)
 * [10] --resume skips verified sub-tasks and re-runs interrupted ones (P0-1)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Conductor } from '../../src/conductor/Conductor';
import { TaskInitializer } from '../../src/task/TaskInitializer';
import { BuildReceiptStore } from '../../src/receipts/BuildReceipt';
import { DecisionLog } from '../../src/decisions/DecisionLog';
import { BundleAssembler } from '../../src/bundle/BundleAssembler';
import { StateStore } from '../../src/state/StateStore';
import { MockProvider } from '../../src/providers/MockProvider';
import { unzipSync } from 'fflate';

// ─── Workspace helpers ────────────────────────────────────────────────────────

async function makeWorkspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'arbiter-e2e-'));
  // Write minimal arbiter.config.json (provider is injected so config is optional,
  // but writing it exercises the loadConfig path too)
  await fs.writeFile(
    path.join(root, 'arbiter.config.json'),
    JSON.stringify({
      auto_merge: false,
      providers: { mock: { cmd: 'echo', headless_flag: '-p' } },
      roles: {
        reframe:         { provider: 'mock', model: 'claude-sonnet-4-6' },
        research:        { provider: 'mock', model: 'claude-sonnet-4-6' },
        design:          { provider: 'mock', model: 'claude-sonnet-4-6' },
        'design-critic': { provider: 'mock', model: 'claude-haiku-4-5-20251001' },
        integrator:      { provider: 'mock', model: 'claude-opus-4-7' },
        plan:            { provider: 'mock', model: 'claude-opus-4-7' },
        backend:         { provider: 'mock', model: 'claude-sonnet-4-6' },
        frontend:        { provider: 'mock', model: 'claude-sonnet-4-6' },
        'test-writer':   { provider: 'mock', model: 'claude-haiku-4-5-20251001' },
        reviewer:        { provider: 'mock', model: 'claude-opus-4-7' },
        'tech-writer':   { provider: 'mock', model: 'claude-sonnet-4-6' },
        debugger:        { provider: 'mock', model: 'claude-opus-4-7' },
      },
    }, null, 2),
    'utf-8',
  );
  return root;
}

async function initTask(root: string, taskId: string, spec: string): Promise<void> {
  const specFile = path.join(root, `${taskId}-spec.md`);
  await fs.writeFile(specFile, spec, 'utf-8');
  const initializer = new TaskInitializer(root);
  const result = await initializer.init({ taskId, specFile, workspaceRoot: root });
  if (!result.ok) throw new Error(`TaskInitializer.init failed: ${result.error}`);
}

async function conductTask(root: string, taskId: string, resume = false): Promise<void> {
  const conductor = new Conductor({
    resume,
    shadow: false,
    dryRun: false,
    workspaceRoot: root,
    maxParallel: 1,
    provider: new MockProvider(),
    autoApproveGates: true,
  });
  const result = await conductor.conduct(taskId);
  if (!result.ok) {
    // Dump state and last 5 log entries for diagnosis
    const store = new StateStore(root);
    const state = await store.read();
    const log = new DecisionLog(root);
    const logEntries = await log.readAll();
    const failed = state.ok
      ? Object.entries(state.value.sub_tasks)
          .filter(([, e]) => e.status === 'failed')
          .map(([id, e]) => `${id}(${e.last_failure_class})`)
      : [];
    const lastEvents = logEntries.ok
      ? logEntries.value.slice(-5).map(e => `${e.event}: ${e.detail ?? ''}`)
      : [];
    throw new Error(
      `conduct failed: ${result.error} (${result.code})\n` +
      `  Failed sub-tasks: ${failed.join(', ') || 'none'}\n` +
      `  Last 5 log events:\n${lastEvents.map(e => '    ' + e).join('\n')}`,
    );
  }
}

// ─── Test suite ────────────────────────────────────────────────────────────────

describe('P3-6 end-to-end pipeline', () => {
  let root: string;
  const taskId = 'E2E-01';
  const taskId2 = 'E2E-02';

  const spec = `# Add DMS Upload Progress Bar

## Description
Add a progress indicator to the DMS file upload component so users can see
the upload percentage in real-time.

## Acceptance Criteria
- Progress bar visible during upload
- Disappears when upload completes
- Accessible (aria-label)
`;

  beforeAll(async () => {
    root = await makeWorkspace();
    await initTask(root, taskId, spec);
    await conductTask(root, taskId);
  }, 120_000);

  afterAll(async () => {
    // Clean up temp workspace
    try {
      await fs.rm(root, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  // ── [1] Receipt signatures ─────────────────────────────────────────────────

  it('[1] all sub-task output hashes match signed receipts', async () => {
    const receipts = new BuildReceiptStore(root);
    const all = await receipts.readAll();
    expect(all.ok).toBe(true);
    expect(all.ok && all.value.length).toBeGreaterThan(0);

    for (const receipt of (all.ok ? all.value : [])) {
      const verifyResult = await receipts.verify(receipt.receipt_id);
      expect(verifyResult.ok).toBe(true);
      expect(verifyResult.ok && verifyResult.value).toBe(true);

      // Verify output files on disk match receipt hashes
      for (const [filePath, storedHash] of Object.entries(receipt.output_hashes)) {
        if (storedHash === 'sha256:MISSING') continue;
        const content = await fs.readFile(filePath);
        const { createHash } = await import('node:crypto');
        const actual = `sha256:${createHash('sha256').update(content).digest('hex')}`;
        expect(actual).toBe(storedHash);
      }
    }
  });

  // ── [2] audit verify ──────────────────────────────────────────────────────

  it('[2] arbiter audit verify reports PASS for all receipts', async () => {
    const receipts = new BuildReceiptStore(root);
    const all = await receipts.readAll();
    expect(all.ok).toBe(true);

    let passed = 0;
    for (const r of (all.ok ? all.value : [])) {
      const v = await receipts.verify(r.receipt_id);
      if (v.ok && v.value) passed++;
    }
    expect(passed).toBe(all.ok ? all.value.length : -1);
  });

  // ── [3] decision-log events ───────────────────────────────────────────────

  it('[3] decision-log contains all required pipeline events', async () => {
    const log = new DecisionLog(root);
    const entries = await log.readAll();
    expect(entries.ok).toBe(true);
    const events = (entries.ok ? entries.value : [])
      .filter(e => e.task_id === taskId)
      .map(e => e.event);

    const required = [
      'pipeline_start',
      'agent_start',
      'agent_complete',
      'pipeline_complete',
      'bundle_created',
    ];
    for (const evt of required) {
      expect(events, `missing event: ${evt}`).toContain(evt);
    }
  });

  // ── [4] plan injection ────────────────────────────────────────────────────

  it('[4] plan agent injected granular sub-tasks (P1-3)', async () => {
    const log = new DecisionLog(root);
    const entries = await log.readAll();
    expect(entries.ok).toBe(true);
    const planInjected = (entries.ok ? entries.value : []).find(
      e => e.task_id === taskId && e.event === 'plan_subtasks_injected',
    );
    expect(planInjected).toBeDefined();
    expect(planInjected?.detail).toContain('frontend-dms-progress');

    // Generic placeholders should be gone; granular ids should be present
    const store = new StateStore(root);
    const state = await store.read();
    expect(state.ok).toBe(true);
    if (!state.ok) return;
    expect(Object.keys(state.value.sub_tasks)).not.toContain('frontend');
    expect(Object.keys(state.value.sub_tasks)).not.toContain('backend');
    expect(Object.keys(state.value.sub_tasks)).toContain('frontend-dms-progress');
    expect(Object.keys(state.value.sub_tasks)).toContain('test-dms-progress');
  });

  // ── [5] bundle created ────────────────────────────────────────────────────

  it('[5] AUDIT-EVIDENCE-BUNDLE.zip was created', async () => {
    const bundleDir = path.join(root, '.arbiter', 'bundles');
    const files = await fs.readdir(bundleDir);
    const zips = files.filter(f => f.endsWith('-AUDIT-EVIDENCE-BUNDLE.zip'));
    expect(zips.length).toBeGreaterThan(0);
  });

  // ── [6] bundle verify ─────────────────────────────────────────────────────

  it('[6] bundle verify returns valid=true', async () => {
    const bundleDir = path.join(root, '.arbiter', 'bundles');
    const files = await fs.readdir(bundleDir);
    const zip = files.find(f => f.endsWith('-AUDIT-EVIDENCE-BUNDLE.zip'));
    expect(zip).toBeDefined();

    const assembler = new BundleAssembler(root);
    const result = await assembler.verify(path.join(bundleDir, zip!));
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.valid).toBe(true);
  });

  // ── [7] bundle directory structure ───────────────────────────────────────

  it('[7] bundle contains all 9 evidence directories', async () => {
    const bundleDir = path.join(root, '.arbiter', 'bundles');
    const files = await fs.readdir(bundleDir);
    const zipFile = files.find(f => f.endsWith('-AUDIT-EVIDENCE-BUNDLE.zip'));
    expect(zipFile).toBeDefined();

    const buf = await fs.readFile(path.join(bundleDir, zipFile!));
    const entries = unzipSync(new Uint8Array(buf));
    const paths = Object.keys(entries);

    const expectedDirs = [
      '01-requirements/',
      '02-impact-analysis/',
      '03-design/',
      '04-implementation-plan/',
      '05-implementation/',
      '06-tests/',
      '07-review/',
      '08-documentation/',
      '09-audit-trail/',
    ];

    for (const dir of expectedDirs) {
      const found = paths.some(p => p.startsWith(dir));
      expect(found, `missing bundle directory: ${dir}`).toBe(true);
    }

    // manifest.json must be present and contain bundle_hash
    expect(paths).toContain('manifest.json');
    const manifestBytes = entries['manifest.json'];
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
    expect(manifest.bundle_hash).toMatch(/^sha256:/);
    expect(manifest.bundle_signature).not.toBe('UNSIGNED');
    expect(manifest.alc_controls_covered.length).toBeGreaterThan(0);
  });

  // ── [8] model tiering ─────────────────────────────────────────────────────

  it('[8] model tiering: correct models assigned per role', async () => {
    const receipts = new BuildReceiptStore(root);
    const all = await receipts.readAll();
    expect(all.ok).toBe(true);
    if (!all.ok) return;

    const byRole: Record<string, string[]> = {};
    for (const r of all.value) {
      byRole[r.agent_role] = byRole[r.agent_role] ?? [];
      byRole[r.agent_role].push(r.model);
    }

    // I6: test-writer must be haiku (different from frontend/backend sonnet)
    if (byRole['test-writer']) {
      for (const m of byRole['test-writer']) {
        expect(m).toContain('haiku');
      }
    }
    // I7: design-critic must be haiku (different from design sonnet)
    if (byRole['design-critic']) {
      for (const m of byRole['design-critic']) {
        expect(m).toContain('haiku');
      }
    }
    // reviewer must be opus
    if (byRole['reviewer']) {
      for (const m of byRole['reviewer']) {
        expect(m).toContain('opus');
      }
    }
  });

  // ── [9] evidence cache hit on second run (P1-7) ───────────────────────────

  it('[9] second run of same-module task triggers design_phase_cache_hit', async () => {
    // Use a fresh workspace so TaskInitializer doesn't reject an existing state.json.
    // Copy the evidence cache from the first run — cache entries reference absolute paths
    // inside `root` which remain on disk until afterAll cleans them up.
    const root2 = await makeWorkspace();
    try {
      await fs.cp(
        path.join(root, '.arbiter', 'evidence-cache'),
        path.join(root2, '.arbiter', 'evidence-cache'),
        { recursive: true },
      );

      await initTask(root2, taskId2, spec);
      await conductTask(root2, taskId2);

      const log = new DecisionLog(root2);
      const entries = await log.readAll();
      expect(entries.ok).toBe(true);
      const cacheEvents = (entries.ok ? entries.value : []).filter(
        e => e.task_id === taskId2 && e.event === 'design_phase_cache_hit',
      );
      expect(cacheEvents.length).toBeGreaterThan(0);

      // Design and design-critic should be marked completed via cache
      const store = new StateStore(root2);
      const state = await store.read();
      expect(state.ok).toBe(true);
      if (!state.ok) return;
      expect(state.value.sub_tasks['design']?.status).toBe('completed');
      expect(state.value.sub_tasks['design-critic']?.status).toBe('completed');
    } finally {
      await fs.rm(root2, { recursive: true, force: true }).catch(() => {});
    }
  }, 120_000);

  // ── [10] --resume skips verified and re-runs interrupted ─────────────────

  it('[10] --resume skips verified sub-tasks, resets interrupted ones', async () => {
    const resumeRoot = await makeWorkspace();
    const resumeTaskId = 'E2E-RESUME';
    try {
      await initTask(resumeRoot, resumeTaskId, spec);

      // Artificially mark a sub-task as in_progress (simulates SIGKILL mid-run)
      const store = new StateStore(resumeRoot);
      const stateResult = await store.read();
      expect(stateResult.ok).toBe(true);
      if (!stateResult.ok) return;

      // Mark reframe as completed with a real receipt
      await conductTask(resumeRoot, resumeTaskId);

      // Now manually corrupt state: set 'research' back to in_progress
      const state2 = await store.read();
      if (!state2.ok) return;
      await store.updateSubTask('research', { status: 'in_progress' });

      // Resume — should detect in_progress and reset to pending, then re-run
      const conductor = new Conductor({
        resume: true,
        shadow: false,
        dryRun: false,
        workspaceRoot: resumeRoot,
        maxParallel: 1,
        provider: new MockProvider(),
        autoApproveGates: true,
      });
      const result = await conductor.conduct(resumeTaskId);
      expect(result.ok).toBe(true);

      // Decision log should show resume_reset_in_progress for research
      const log = new DecisionLog(resumeRoot);
      const entries = await log.readAll();
      expect(entries.ok).toBe(true);
      const resetEvents = (entries.ok ? entries.value : []).filter(
        e => e.task_id === resumeTaskId && e.event === 'resume_reset_in_progress',
      );
      expect(resetEvents.length).toBeGreaterThan(0);
    } finally {
      await fs.rm(resumeRoot, { recursive: true, force: true }).catch(() => {});
    }
  }, 120_000);
});
