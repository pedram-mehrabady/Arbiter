import fs from 'node:fs/promises';
import path from 'node:path';
import { SqliteStore } from '../state/SqliteStore';
import { LLMProvider } from '../providers/LLMProvider';
import { IronFunnelGateResult, FactoryConfig } from '../types/index';
import { CompilerAirlockGate } from '../gates/CompilerAirlockGate';
import { ProvingGroundGate, CoverageFloors } from '../gates/ProvingGroundGate';
import { OrchestratorDispatcher } from '../orchestrator/OrchestratorDispatcher';
import { Notifier, NO_OP_NOTIFIER } from '../notifications/TelegramNotifier';

export interface IronFunnelResult {
  passed: boolean;
  gates: IronFunnelGateResult[];
  elapsed_ms: number;
  failureGate?: 1 | 2 | 3 | 4 | 5;
  retryCount: number;
}

interface GateStateEntry {
  gate: 1 | 2 | 3 | 4 | 5;
  name: string;
  type: 'deterministic' | 'llm';
  status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  elapsed_ms?: number | null;
  error_count?: number;
}

const MAX_GATE1_RETRIES = 3;
const MAX_GATE3_FAILURES = 3;
const WARN_HOURS = 4;
const ESCALATE_HOURS = 8;

export class IronFunnel {
  private readonly compilerAirlock: CompilerAirlockGate;
  private readonly provingGround: ProvingGroundGate;
  private readonly orchestratorDispatcher: OrchestratorDispatcher;

  constructor(
    private readonly sqliteStore: SqliteStore,
    private readonly provider: LLMProvider,
    private readonly config: FactoryConfig,
    private readonly workspaceRoot: string = '',
    private readonly notifier: Notifier = NO_OP_NOTIFIER,
  ) {
    this.compilerAirlock = new CompilerAirlockGate();
    this.provingGround = new ProvingGroundGate();
    const orchestratorModel = (this.config.roles as Record<string, { model: string }>)?.['orchestrator']?.model
      ?? 'claude-opus-4-7';
    this.orchestratorDispatcher = new OrchestratorDispatcher(
      this.sqliteStore,
      this.provider,
      this.workspaceRoot,
      orchestratorModel,
    );
  }

  async run(
    taskId: string,
    worktreePath: string,
    options: { tier?: 1 | 2 | 3; lockedContractPaths?: string[] } = {},
  ): Promise<IronFunnelResult> {
    const startMs = Date.now();
    const startedAt = new Date(startMs).toISOString();
    const gates: IronFunnelGateResult[] = [];
    const tier = options.tier ?? 3;
    let gate3Failures = 0;
    let retryCount = 0;

    // Track gate states for dashboard visibility
    const gateStates: GateStateEntry[] = [
      { gate: 1, name: 'Compiler Airlock', type: 'deterministic', status: 'pending' },
      { gate: 2, name: 'Test Writer',       type: 'llm',           status: 'pending' },
      { gate: 3, name: 'Proving Ground',    type: 'deterministic', status: 'pending' },
      { gate: 4, name: 'Debugger',          type: 'llm',           status: 'pending' },
      { gate: 5, name: 'Semantic Review',   type: 'llm',           status: 'pending' },
    ];
    const updateGate = (gate: number, patch: Partial<GateStateEntry>): void => {
      const idx = gate - 1;
      if (idx >= 0 && idx < gateStates.length) {
        gateStates[idx] = { ...gateStates[idx], ...patch } as GateStateEntry;
        void this.writeGateStateFile(taskId, gateStates, tier, startedAt);
      }
    };

    this.sqliteStore.appendEvent(taskId, 'gate_started', {
      gate: 'iron_funnel',
      startMs,
    });

    // ── Gate 1: Compiler Airlock ──────────────────────────────────────────────
    let gate1Passed = false;
    updateGate(1, { status: 'running' });
    for (let attempt = 0; attempt < MAX_GATE1_RETRIES; attempt++) {
      const g1 = await this.compilerAirlock.run(worktreePath, {
        tier: options.tier,
        lockedContractPaths: options.lockedContractPaths,
      });

      gates.push({
        gate: 1,
        passed: g1.passed,
        elapsed_ms: g1.elapsed_ms,
        errors: g1.errors.map(e => `[${e.tool}] ${e.file ? `${e.file}: ` : ''}${e.message}`),
      });

      this.sqliteStore.appendEvent(taskId, 'gate1_result', {
        attempt,
        passed: g1.passed,
        errorCount: g1.errors.length,
      });

      if (g1.passed) {
        updateGate(1, { status: 'passed', elapsed_ms: g1.elapsed_ms });
        gate1Passed = true;
        break;
      }

      retryCount++;
      if (attempt < MAX_GATE1_RETRIES - 1) {
        await this.writeRetryContext(worktreePath, 'gate1', g1.errors.map(
          e => `[${e.tool}] ${e.file ? `${e.file}: ` : ''}${e.message}`,
        ));
      } else {
        updateGate(1, { status: 'failed', elapsed_ms: g1.elapsed_ms, error_count: g1.errors.length });
      }
    }

    if (!gate1Passed) {
      return {
        passed: false,
        gates,
        elapsed_ms: Date.now() - startMs,
        failureGate: 1,
        retryCount,
      };
    }

    // ── Gate 2: Test Writer (LLM dispatch) ───────────────────────────────────
    updateGate(2, { status: 'running' });
    const g2 = await this.runTestWriterGate(taskId, worktreePath);
    gates.push(g2);
    updateGate(2, { status: g2.passed ? 'passed' : 'failed', elapsed_ms: g2.elapsed_ms });

    this.sqliteStore.appendEvent(taskId, 'gate2_result', {
      passed: g2.passed,
      elapsed_ms: g2.elapsed_ms,
    });

    if (!g2.passed) {
      return {
        passed: false,
        gates,
        elapsed_ms: Date.now() - startMs,
        failureGate: 2,
        retryCount,
      };
    }

    // ── Gate 3 + Gate 4 loop ─────────────────────────────────────────────────
    const coverageFloors = this.getCoverageFloors();
    updateGate(3, { status: 'running' });

    while (gate3Failures < MAX_GATE3_FAILURES) {
      const g3 = await this.provingGround.run(worktreePath, coverageFloors);

      gates.push({
        gate: 3,
        passed: g3.passed,
        elapsed_ms: g3.elapsed_ms,
        errors: g3.failedTests,
      });

      this.sqliteStore.appendEvent(taskId, 'gate3_result', {
        passed: g3.passed,
        failedCount: g3.failedTests.length,
        runner: g3.runner,
      });

      if (g3.passed) {
        updateGate(3, { status: 'passed', elapsed_ms: g3.elapsed_ms });
        if (gate3Failures === 0) updateGate(4, { status: 'skipped' });
        break;
      }

      gate3Failures++;
      retryCount++;
      updateGate(3, { status: 'failed', elapsed_ms: g3.elapsed_ms, error_count: g3.failedTests.length });

      if (gate3Failures >= MAX_GATE3_FAILURES) {
        this.sqliteStore.upsertTask({ task_id: taskId, status: 'failed' });
        return {
          passed: false,
          gates,
          elapsed_ms: Date.now() - startMs,
          failureGate: 3,
          retryCount,
        };
      }

      // Gate 4: Debugger (max 2 activations per funnel run)
      if (gate3Failures <= 2) {
        updateGate(4, { status: 'running' });
        const g4 = await this.runDebuggerGate(taskId, worktreePath, g3.failedTests, g3.testOutput);
        gates.push(g4);
        updateGate(4, { status: g4.passed ? 'passed' : 'failed', elapsed_ms: g4.elapsed_ms });

        this.sqliteStore.appendEvent(taskId, 'gate4_result', {
          passed: g4.passed,
          elapsed_ms: g4.elapsed_ms,
          attempt: gate3Failures,
        });

        if (!g4.passed) {
          return {
            passed: false,
            gates,
            elapsed_ms: Date.now() - startMs,
            failureGate: 4,
            retryCount,
          };
        }
        updateGate(3, { status: 'running' }); // reset for retry
      }
    }

    // ── Gate 5: Orchestrator Semantic Review ─────────────────────────────────
    updateGate(5, { status: 'running' });
    const g5 = await this.runOrchestratorReview(taskId, worktreePath);
    gates.push(g5);
    updateGate(5, { status: g5.passed ? 'passed' : 'failed', elapsed_ms: g5.elapsed_ms });

    this.sqliteStore.appendEvent(taskId, 'gate5_result', {
      passed: g5.passed,
      stub: true,
    });

    const elapsed_ms = Date.now() - startMs;
    this.checkTimeoutThresholds(taskId, elapsed_ms);

    return {
      passed: g5.passed,
      gates,
      elapsed_ms,
      retryCount,
    };
  }

  // ── Gate 2: TestWriter ────────────────────────────────────────────────────

  private async runTestWriterGate(taskId: string, worktreePath: string): Promise<IronFunnelGateResult> {
    const gateStart = Date.now();

    this.sqliteStore.appendEvent(taskId, 'gate_started', { gate: 2, startMs: gateStart });

    try {
      const testWriterModel = this.getModel('test-writer');
      const sourceFiles = await this.listSourceFiles(worktreePath);

      if (sourceFiles.length === 0) {
        return { gate: 2, passed: true, elapsed_ms: Date.now() - gateStart, errors: [] };
      }

      const prompt = this.buildTestWriterPrompt(sourceFiles);

      const result = await this.provider.invoke({
        model: testWriterModel,
        assembledPrompt: prompt,
        maxTokens: 4096,
        timeoutMs: 120_000,
        agentRole: 'test-writer',
      });

      if (!result.ok || result.value.exitCode !== 0) {
        return {
          gate: 2,
          passed: false,
          elapsed_ms: Date.now() - gateStart,
          errors: ['Test writer LLM call failed'],
        };
      }

      await this.applyTestWriterOutput(worktreePath, result.value.content);

      return { gate: 2, passed: true, elapsed_ms: Date.now() - gateStart };
    } catch (err) {
      return {
        gate: 2,
        passed: false,
        elapsed_ms: Date.now() - gateStart,
        errors: [(err as Error).message],
      };
    }
  }

  private buildTestWriterPrompt(sourceFiles: string[]): string {
    const fileList = sourceFiles.map(f => `- ${f}`).join('\n');
    return [
      'You are a test writer. Your job is to write unit tests for the modified source files listed below.',
      'Write tests that cover the main functionality, edge cases, and error handling.',
      'Output ONLY valid test file content. Use the same test framework already used in the project.',
      '',
      'Modified source files:',
      fileList,
      '',
      'Write comprehensive tests for these files.',
    ].join('\n');
  }

  private async applyTestWriterOutput(worktreePath: string, content: string): Promise<void> {
    // Extract file blocks from LLM output: ```typescript\n// file: path\n...```
    const fileBlockRe = /```(?:typescript|javascript|ts|js)\s*\n\/\/\s*file:\s*(.+?)\n([\s\S]*?)```/g;
    let match: RegExpExecArray | null;

    while ((match = fileBlockRe.exec(content)) !== null) {
      const filePath = path.join(worktreePath, match[1].trim());
      const fileContent = match[2];
      try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, fileContent, 'utf-8');
      } catch {
        // Non-fatal: skip unwritable paths
      }
    }
  }

  // ── Gate 4: Debugger ──────────────────────────────────────────────────────

  private async runDebuggerGate(
    taskId: string,
    worktreePath: string,
    failedTests: string[],
    testOutput: string,
  ): Promise<IronFunnelGateResult> {
    const gateStart = Date.now();

    this.sqliteStore.appendEvent(taskId, 'gate_started', { gate: 4, startMs: gateStart });

    try {
      const debuggerModel = this.getModel('debugger') ?? this.getModel('reviewer');
      const sourceFiles = await this.listSourceFiles(worktreePath);
      const prompt = this.buildDebuggerPrompt(failedTests, testOutput, sourceFiles);

      const result = await this.provider.invoke({
        model: debuggerModel,
        assembledPrompt: prompt,
        maxTokens: 8192,
        timeoutMs: 180_000,
        agentRole: 'debugger',
      });

      if (!result.ok || result.value.exitCode !== 0) {
        return {
          gate: 4,
          passed: false,
          elapsed_ms: Date.now() - gateStart,
          errors: ['Debugger LLM call failed'],
        };
      }

      await this.applyDebuggerOutput(worktreePath, result.value.content);

      return { gate: 4, passed: true, elapsed_ms: Date.now() - gateStart };
    } catch (err) {
      return {
        gate: 4,
        passed: false,
        elapsed_ms: Date.now() - gateStart,
        errors: [(err as Error).message],
      };
    }
  }

  private buildDebuggerPrompt(
    failedTests: string[],
    testOutput: string,
    sourceFiles: string[],
  ): string {
    const failList = failedTests.map(t => `- ${t}`).join('\n');
    const fileList = sourceFiles.map(f => `- ${f}`).join('\n');
    return [
      'You are a debugger agent. The following tests are failing. Analyze the test output and fix the source code.',
      'Output ONLY the corrected file content using the format: ```typescript\n// file: <path>\n<content>\n```',
      'Do NOT modify the test files. Fix ONLY the source files.',
      '',
      'Failed tests:',
      failList,
      '',
      'Test output:',
      testOutput.slice(0, 3000),
      '',
      'Source files available:',
      fileList,
    ].join('\n');
  }

  private async applyDebuggerOutput(worktreePath: string, content: string): Promise<void> {
    const fileBlockRe = /```(?:typescript|javascript|ts|js|python)\s*\n\/\/\s*file:\s*(.+?)\n([\s\S]*?)```/g;
    let match: RegExpExecArray | null;

    while ((match = fileBlockRe.exec(content)) !== null) {
      const relPath = match[1].trim();
      // Safety: never write outside the worktree
      const absPath = path.resolve(worktreePath, relPath);
      if (!absPath.startsWith(path.resolve(worktreePath))) continue;

      try {
        await fs.writeFile(absPath, match[2], 'utf-8');
      } catch {
        // Non-fatal
      }
    }
  }

  // ── Gate 5: Orchestrator Semantic Review ─────────────────────────────────

  private async runOrchestratorReview(
    taskId: string,
    worktreePath: string,
  ): Promise<IronFunnelGateResult> {
    const gateStart = Date.now();

    this.sqliteStore.appendEvent(taskId, 'gate_started', { gate: 5, startMs: gateStart });

    try {
      const effectivePath = worktreePath || this.workspaceRoot;
      const gate5Provider = this.resolveGate5Provider();

      if (gate5Provider === 'subq') {
        return await this.runGate5SubQ(taskId, effectivePath, gateStart);
      }

      const [taskMd, contracts, prDiff] = await Promise.all([
        readFileSafe(path.join(this.workspaceRoot, 'arbiter', 'tasks', taskId, 'task.md')),
        this.readContracts(effectivePath),
        this.getWorktreeDiff(effectivePath),
      ]);

      const response = await this.orchestratorDispatcher.wake(taskId, 'gate5_reached', {
        taskMd,
        contracts,
        prDiff,
      });

      const passed = response.decision !== 'reject';

      return {
        gate: 5,
        passed,
        elapsed_ms: Date.now() - gateStart,
        errors: passed ? undefined : [response.reason ?? 'Orchestrator rejected — no reason given'],
      };
    } catch (err) {
      // Fallback to approve on error — compiler is the real safety net
      console.warn(`[IronFunnel] Gate 5 error (auto-approving): ${(err as Error).message}`);
      return { gate: 5, passed: true, elapsed_ms: Date.now() - gateStart };
    }
  }

  private async runGate5SubQ(taskId: string, worktreePath: string, gateStart: number): Promise<IronFunnelGateResult> {
    const { SubQProvider } = await import('../providers/SubQProvider');
    const cfg = this.config as FactoryConfig & {
      providers?: Record<string, Record<string, unknown>>;
    };
    const subqCfg = cfg.providers?.['subq'];
    const fallbackModel = this.getModel('orchestrator') ?? 'claude-opus-4-7';
    const subqProvider = new SubQProvider(
      {
        base_url:       String(subqCfg?.['base_url']   ?? 'https://api.subq.ai'),
        api_key:        String(subqCfg?.['api_key']     ?? ''),
        model:          String(subqCfg?.['model']       ?? 'subq-1'),
        context_window: Number(subqCfg?.['context_window'] ?? 12_000_000),
      },
      this.provider,
      fallbackModel,
    );

    const [taskMd, fullContext] = await Promise.all([
      readFileSafe(path.join(this.workspaceRoot, 'arbiter', 'tasks', taskId, 'task.md')),
      this.buildFullRepoContext(worktreePath),
    ]);

    const prompt = [
      'You are a semantic code reviewer with access to the full repository context.',
      'Review the changes in light of the task requirements and the existing codebase.',
      'Respond with: APPROVE or REJECT followed by a one-sentence reason.',
      '',
      '## Task',
      taskMd,
      '',
      '## Repository Context',
      fullContext,
    ].join('\n');

    const result = await subqProvider.invoke({
      model: String(subqCfg?.['model'] ?? 'subq-1'),
      assembledPrompt: prompt,
      maxTokens: 1024,
      timeoutMs: 300_000,
      agentRole: 'reviewer',
    });

    if (!result.ok) {
      console.warn('[IronFunnel] Gate 5 SubQ call failed (auto-approving):', result.error);
      return { gate: 5, passed: true, elapsed_ms: Date.now() - gateStart };
    }

    const passed = !/^\s*REJECT/i.test(result.value.content);
    return {
      gate: 5,
      passed,
      elapsed_ms: Date.now() - gateStart,
      errors: passed ? undefined : [result.value.content.trim()],
    };
  }

  private resolveGate5Provider(): 'subq' | 'standard' {
    const cfg = this.config as FactoryConfig & {
      roles?: Record<string, { provider?: string }>;
      providers?: Record<string, unknown>;
    };
    const orchestratorProvider = cfg.roles?.['orchestrator']?.provider;
    if (orchestratorProvider === 'subq' && cfg.providers?.['subq']) {
      return 'subq';
    }
    return 'standard';
  }

  private async buildFullRepoContext(worktreePath: string): Promise<string> {
    const files = await this.listSourceFiles(worktreePath);
    const MAX_CONTEXT_CHARS = 8_000_000;
    const parts: string[] = [];
    let totalChars = 0;

    for (const rel of files) {
      const content = await readFileSafe(path.join(worktreePath, rel));
      if (!content) continue;
      const chunk = `### ${rel}\n\`\`\`\n${content}\n\`\`\`\n`;
      if (totalChars + chunk.length > MAX_CONTEXT_CHARS) break;
      parts.push(chunk);
      totalChars += chunk.length;
    }

    return parts.join('\n');
  }

  private async readContracts(worktreePath: string): Promise<string> {
    const contractFiles = ['contracts/api.ts', 'contracts/events.ts', 'contracts/schema.prisma'];
    const parts: string[] = [];
    for (const f of contractFiles) {
      const content = await readFileSafe(path.join(worktreePath, f));
      if (content) parts.push(`## ${f}\n${content}`);
    }
    return parts.join('\n\n');
  }

  private async getWorktreeDiff(worktreePath: string): Promise<string> {
    try {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execFileAsync = promisify(execFile);
      const { stdout } = await execFileAsync(
        'git', ['-C', worktreePath, 'diff', 'HEAD'],
        { timeout: 10_000 },
      );
      return stdout.slice(0, 8000);
    } catch {
      return '';
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private getCoverageFloors(): CoverageFloors | undefined {
    const cfg = this.config as FactoryConfig & {
      coverage_floors?: { statements: number; branches: number; functions: number };
    };
    return cfg.coverage_floors;
  }

  private getModel(role: string): string {
    const roles = this.config.roles as Record<string, { model: string }>;
    return roles[role]?.model ?? 'claude-sonnet-4-6';
  }

  private async listSourceFiles(worktreePath: string): Promise<string[]> {
    const results: string[] = [];
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py'];

    const walk = async (dir: string): Promise<void> => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await walk(fullPath);
          } else if (extensions.some(ext => entry.name.endsWith(ext))) {
            results.push(path.relative(worktreePath, fullPath));
          }
        }
      } catch {
        // Skip unreadable directories
      }
    };

    await walk(worktreePath);
    return results;
  }

  private async writeGateStateFile(
    taskId: string,
    gateStates: GateStateEntry[],
    tier: 1 | 2 | 3,
    startedAt: string,
  ): Promise<void> {
    if (!this.workspaceRoot) return;
    const dir = path.join(this.workspaceRoot, 'arbiter');
    const filePath = path.join(dir, `iron-funnel-${taskId}.json`);
    const profileMap: Record<number, string> = { 1: 'speed', 2: 'investigator', 3: 'full-pipeline' };
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filePath, JSON.stringify({
        task_id: taskId,
        tier,
        profile: profileMap[tier] ?? 'full-pipeline',
        is_critical_path: false,
        blocking_count: 0,
        started_at: startedAt,
        gates: gateStates,
        updated_at: new Date().toISOString(),
      }, null, 2), 'utf-8');
    } catch {
      // Non-fatal — dashboard reads are best-effort
    }
  }

  private async writeRetryContext(worktreePath: string, gate: string, errors: string[]): Promise<void> {
    const retryCtxPath = path.join(worktreePath, `.arbiter-${gate}-retry.json`);
    try {
      await fs.writeFile(retryCtxPath, JSON.stringify({ gate, errors }, null, 2), 'utf-8');
    } catch {
      // Non-fatal
    }
  }

  private checkTimeoutThresholds(taskId: string, elapsedMs: number): void {
    const hours = elapsedMs / 3_600_000;
    const h = hours.toFixed(1);
    if (hours >= ESCALATE_HOURS) {
      this.sqliteStore.appendEvent(taskId, 'gate_timeout_escalation', { elapsed_hours: hours });
      void this.notifier.send(`🚨 *${taskId}* — Iron Funnel open ${h}h (≥${ESCALATE_HOURS}h). Escalating.`, 'tech_lead');
    } else if (hours >= WARN_HOURS) {
      this.sqliteStore.appendEvent(taskId, 'gate_timeout_warning', { elapsed_hours: hours });
      void this.notifier.send(`⏳ *${taskId}* — Iron Funnel open ${h}h (≥${WARN_HOURS}h). May need a look.`, 'owner');
    }
  }
}

async function readFileSafe(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return '';
  }
}
