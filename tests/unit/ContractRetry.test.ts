import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { Conductor } from '../../src/conductor/Conductor';
import type { LLMProvider } from '../../src/providers/LLMProvider';

function tempWorkspace(taskId: string): { root: string; taskDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-retry-'));
  const taskDir = path.join(root, 'arbiter', 'tasks', taskId);
  fs.mkdirSync(path.join(taskDir, 'contracts'), { recursive: true });
  return { root, taskDir };
}

const INVALID = 'export const bad: number = "not a number";\n';

/**
 * Simulates the Design agent's re-dispatch. When `fix` is true it "resolves" the
 * contracts (here: removes them, so the next validation has nothing to fail) —
 * this deterministically exercises the retry→lock control flow without depending
 * on tsc resolution inside a bare temp dir.
 */
function fixingProvider(taskDir: string, fix: boolean): LLMProvider {
  return {
    invoke: async () => {
      if (fix) fs.rmSync(path.join(taskDir, 'contracts'), { recursive: true, force: true });
      return { ok: true, value: { content: 'done', inputTokens: 1, outputTokens: 1, rateLimitInfo: {}, exitCode: 0 } };
    },
    estimateCost: () => 0,
  } as unknown as LLMProvider;
}

function makeConductor(root: string, provider: LLMProvider): Conductor {
  const c = new Conductor({
    resume: false, shadow: false, dryRun: false,
    workspaceRoot: root, maxParallel: 1, provider, autoApproveGates: true,
  });
  // runContractValidation reads this.config for the design model.
  (c as unknown as { config: unknown }).config = { roles: { design: { provider: 'mock', model: 'claude-sonnet-4-6' } } };
  return c;
}

function eventTypes(c: Conductor, taskId: string): string[] {
  return c.sqliteStore.getEvents(taskId).map(e => e.event_type);
}

describe('runContractValidation retry (M3.1)', () => {
  it('locks contracts when the Design re-dispatch fixes the errors (attempt 2)', async () => {
    const taskId = 'FEAT-CR-1';
    const { root, taskDir } = tempWorkspace(taskId);
    fs.writeFileSync(path.join(taskDir, 'contracts', 'api.ts'), INVALID);

    const c = makeConductor(root, fixingProvider(taskDir, true));
    c.sqliteStore.upsertTask({ task_id: taskId, status: 'building' });

    await (c as unknown as { runContractValidation(t: string, d: string): Promise<void> })
      .runContractValidation(taskId, taskDir);

    const types = eventTypes(c, taskId);
    expect(types).toContain('contract_validation_failed');     // first attempt failed
    expect(types).toContain('contracts_regenerate_dispatched'); // design re-dispatched
    expect(types).toContain('contracts_locked');                // second attempt passed
    expect(types).not.toContain('contracts_unresolved');
  }, 30_000);

  it('flags contracts_unresolved when the retry still fails (never silently locks)', async () => {
    const taskId = 'FEAT-CR-2';
    const { root, taskDir } = tempWorkspace(taskId);
    fs.writeFileSync(path.join(taskDir, 'contracts', 'api.ts'), INVALID);

    const c = makeConductor(root, fixingProvider(taskDir, false)); // does NOT fix
    c.sqliteStore.upsertTask({ task_id: taskId, status: 'building' });

    await (c as unknown as { runContractValidation(t: string, d: string): Promise<void> })
      .runContractValidation(taskId, taskDir);

    const types = eventTypes(c, taskId);
    expect(types).toContain('contracts_unresolved');
    expect(types).not.toContain('contracts_locked');
  }, 30_000);

  it('locks immediately (attempt 1) when there are no contracts to validate', async () => {
    const taskId = 'FEAT-CR-3';
    const { root, taskDir } = tempWorkspace(taskId);
    fs.rmSync(path.join(taskDir, 'contracts'), { recursive: true, force: true }); // no contracts dir

    const c = makeConductor(root, fixingProvider(taskDir, false));
    c.sqliteStore.upsertTask({ task_id: taskId, status: 'building' });

    await (c as unknown as { runContractValidation(t: string, d: string): Promise<void> })
      .runContractValidation(taskId, taskDir);

    const types = eventTypes(c, taskId);
    expect(types).toContain('contracts_locked');
    expect(types).not.toContain('contract_validation_failed');
  }, 30_000);
});
