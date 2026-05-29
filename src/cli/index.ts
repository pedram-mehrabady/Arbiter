#!/usr/bin/env node
import { Command } from 'commander';
import path from 'node:path';
import fs from 'node:fs/promises';
import { Conductor } from '../conductor/Conductor';
import { MockProvider } from '../providers/MockProvider';
import { GatePoller } from '../gates/GatePoller';
import { DecisionLog } from '../decisions/DecisionLog';
import { BuildReceiptStore } from '../receipts/BuildReceipt';
import { RateLimiter } from '../queue/RateLimiter';
import { TaskQueue } from '../queue/TaskQueue';
import { StateStore } from '../state/StateStore';
import { TaskInitializer } from '../task/TaskInitializer';
import { BundleAssembler } from '../bundle/BundleAssembler';
import { PreflightCheck } from '../preflight/PreflightCheck';
import { ContextAssembler } from '../context/ContextAssembler';
import { ContextPruner } from '../context/ContextPruner';
import { EvidenceCache } from '../evidence/EvidenceCache';
import { scanProject, formatProfile } from '../bootstrap/Scanner';
import { runInterview, buildDefaultAnswers } from '../bootstrap/Interview';
import { generateConfig } from '../bootstrap/ConfigGenerator';
import { registerProject, listProjects } from '../bootstrap/ProjectRegistry';
import { TaskArchiver } from '../task/TaskArchiver';

import { SpecWatcher } from '../watch/SpecWatcher';

const program = new Command();

program
  .name('arbiter')
  .description('Deterministic multi-agent AI pipeline for structured feature delivery')
  .version('0.2.1');

// ─── arbiter init ─────────────────────────────────────────────────────────────

program
  .command('init')
  .description('Set up Arbiter in this project — scans your repo and generates arbiter.config.json')
  .option('--workspace <path>', 'Workspace root (default: cwd)', process.cwd())
  .option('--non-interactive', 'Accept all detected defaults — no prompts (useful for CI)', false)
  .option('--provider <type>', 'Provider: claude (default), sdk, ollama')
  .option('--audience <type>', 'Audience: public (default), internal, regulated')
  .option('--frontend <framework>', 'Frontend framework (overrides detected value)')
  .option('--backend <framework>', 'Backend framework (overrides detected value)')
  .option('--database <db>', 'Database (overrides detected value)')
  .option('--test-framework <fw>', 'Test framework (overrides detected value)')
  .option('--no-gate-design', 'Disable design gate')
  .option('--no-gate-plan', 'Disable plan gate')
  .option('--no-gate-review', 'Disable review gate')
  .action(async (opts: Record<string, string | boolean>) => {
    const workspaceRoot = path.resolve(opts['workspace'] as string);
    // Commander camelCases kebab options: --non-interactive → nonInteractive
    const nonInteractive = Boolean(opts['nonInteractive']);

    console.log(`\nArbiter init — scanning ${workspaceRoot}...\n`);

    const profile = await scanProject(workspaceRoot);

    // Apply CLI flag overrides to detected profile before interview/defaults
    if (opts['frontend'])     profile.stackFrontend = opts['frontend']     as string;
    if (opts['backend'])      profile.stackBackend  = opts['backend']      as string;
    if (opts['database'])     profile.stackDatabase = opts['database']     as string;
    if (opts['testFramework']) profile.testFramework = opts['testFramework'] as string;

    console.log(formatProfile(profile));

    let answers = nonInteractive
      ? (console.log('Non-interactive mode — using detected defaults.\n'), buildDefaultAnswers(profile))
      : await runInterview(profile);

    // Apply remaining CLI flag overrides on top of interview answers
    if (opts['provider']) {
      const p = opts['provider'] as string;
      answers.provider = p === 'sdk' ? 'anthropic_sdk' : p === 'ollama' ? 'ollama' : 'claude_max_cli';
    }
    if (opts['audience']) {
      const a = opts['audience'] as string;
      answers.audience = a === 'regulated' ? 'regulated' : a === 'internal' ? 'internal' : 'public';
    }
    // --no-gate-* flags: Commander stores them as gateDesign/gatePlan/gateReview booleans
    if (opts['gateDesign']  === false) answers.gates.design  = false;
    if (opts['gatePlan']    === false) answers.gates.plan    = false;
    if (opts['gateReview']  === false) answers.gates.review  = false;

    const configResult = await generateConfig(workspaceRoot, answers);
    if (!configResult.ok) {
      console.error(`\nError: ${configResult.error}`);
      process.exit(1);
    }

    const projectId = answers.projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    await registerProject(projectId, answers.projectName, workspaceRoot);

    // Create arbiter/ directory structure
    const arbiterDir = path.join(workspaceRoot, 'arbiter');
    await fs.mkdir(path.join(arbiterDir, 'tasks'), { recursive: true });
    await fs.mkdir(path.join(arbiterDir, 'plans'), { recursive: true });
    await fs.mkdir(path.join(arbiterDir, 'agents'), { recursive: true });
    const gitkeep = path.join(arbiterDir, '.gitkeep');
    try { await fs.writeFile(gitkeep, '', 'utf-8'); } catch { /* ok */ }

    // Write developer identity to ~/.arbiter/identity.json
    const homeDir = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '';
    if (homeDir) {
      const arbiterHomeDir = path.join(homeDir, '.arbiter');
      await fs.mkdir(arbiterHomeDir, { recursive: true });
      const identityPath = path.join(arbiterHomeDir, 'identity.json');
      try {
        await fs.access(identityPath);
      } catch {
        // Write default identity. Never prompt in non-interactive mode (would hang CI).
        const name = nonInteractive
          ? 'Developer'
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          : ((await import('../bootstrap/Interview.js').then((m: any) => m.askDeveloperName?.()).catch(() => null)) ?? 'Developer');
        await fs.writeFile(identityPath, JSON.stringify({ name }, null, 2), 'utf-8');
      }
    }

    // Telegram admin config is optional and personal — never committed. If absent,
    // print setup instructions but do not block init.
    if (homeDir) {
      const adminConfigPath = path.join(homeDir, '.arbiter', 'admin.config.json');
      try {
        await fs.access(adminConfigPath);
      } catch {
        console.log(
          '\nℹ Optional: enable Telegram notifications (gate timeouts, task complete/fail).\n' +
          `  Create ${adminConfigPath} with:\n` +
          '    {\n' +
          '      "telegram": {\n' +
          '        "bot_token": "<from @BotFather>",\n' +
          '        "owner_chat_id": "<your chat id>",\n' +
          '        "tech_lead_chat_id": "<optional, for 8h escalations>"\n' +
          '      }\n' +
          '    }\n',
        );
      }
    }

    console.log('\n✓ Arbiter initialised.\n\nNext steps:\n  Create a task: echo "Add login feature" > task.md\n  Run it:        arbiter run task.md\n  Dashboard:     arbiter dashboard\n');
  });

// ─── arbiter conduct ──────────────────────────────────────────────────────────

program
  .command('conduct <task-id>')
  .description('Run the pipeline for a task')
  .option('--resume', 'Resume from last checkpoint', false)
  .option('--shadow', 'Shadow mode — log decisions without executing', false)
  .option('--dry-run', 'Show what would run without invoking agents', false)
  .option('--provider <type>', 'Override provider for ALL agents (e.g. "mock" for a free local dry run)')
  .option('--workspace <path>', 'Workspace root (default: cwd)', process.cwd())
  .option('--max-parallel <n>', 'Max concurrent sub-task agents', '1')
  .action(async (taskId: string, opts: Record<string, string | boolean>) => {
    const workspaceRoot = path.resolve(opts['workspace'] as string);
    // `--provider mock` runs the entire pipeline with the deterministic MockProvider:
    // no API calls, no cost — a true end-to-end dry run of the orchestration.
    const providerOverride = opts['provider'] === 'mock' ? new MockProvider() : undefined;
    if (providerOverride) console.log('Using MockProvider — no agents will be billed.\n');
    const conductor = new Conductor({
      resume: Boolean(opts['resume']),
      shadow: Boolean(opts['shadow']),
      dryRun: Boolean(opts['dryRun']),
      workspaceRoot,
      maxParallel: parseInt(String(opts['maxParallel']), 10),
      ...(providerOverride ? { provider: providerOverride } : {}),
    });
    const result = await conductor.conduct(taskId);
    if (!result.ok) {
      console.error(`\nError: ${result.error}`);
      process.exit(1);
    }
    const { subTasksCompleted, totalCostUsd, elapsedMs } = result.value;
    const elapsed = elapsedMs < 60_000
      ? `${(elapsedMs / 1000).toFixed(1)}s`
      : `${Math.floor(elapsedMs / 60_000)}m ${Math.round((elapsedMs % 60_000) / 1000)}s`;
    console.log(`\n  Sub-tasks: ${subTasksCompleted}  |  Cost: $${totalCostUsd.toFixed(4)}  |  Time: ${elapsed}`);
  });

// ─── arbiter gate ─────────────────────────────────────────────────────────────

const gateCmd = program.command('gate').description('Human gate management');

gateCmd
  .command('list')
  .description('List pending gates')
  .option('--workspace <path>', 'Workspace root', process.cwd())
  .action(async (opts: Record<string, string>) => {
    const root = path.resolve(opts['workspace']);
    const decisionLog = new DecisionLog(root);
    const poller = new GatePoller(root, decisionLog);
    const result = await poller.listPending();
    if (!result.ok) { console.error(result.error); process.exit(1); }
    if (result.value.length === 0) {
      console.log('No pending gates.');
    } else {
      result.value.forEach(g => {
        console.log(`  ${g.gate_id}  [${g.type}]  ${g.created_at}`);
        console.log(`    ${g.context.slice(0, 120)}`);
      });
    }
  });

gateCmd
  .command('approve <gate-id>')
  .description('Approve a pending gate')
  .option('--comment <text>', 'Optional approval comment')
  .option('--workspace <path>', 'Workspace root', process.cwd())
  .action(async (gateId: string, opts: Record<string, string>) => {
    const root = path.resolve(opts['workspace']);
    const decisionLog = new DecisionLog(root);
    const poller = new GatePoller(root, decisionLog);
    const result = await poller.resolve(gateId, 'approved', opts['comment']);
    if (!result.ok) { console.error(result.error); process.exit(1); }
    console.log(`Gate ${gateId} approved.`);
  });

gateCmd
  .command('reject <gate-id>')
  .description('Reject a pending gate')
  .option('--comment <text>', 'Required rejection reason')
  .option('--workspace <path>', 'Workspace root', process.cwd())
  .action(async (gateId: string, opts: Record<string, string>) => {
    const root = path.resolve(opts['workspace']);
    const decisionLog = new DecisionLog(root);
    const poller = new GatePoller(root, decisionLog);
    const result = await poller.resolve(gateId, 'rejected', opts['comment']);
    if (!result.ok) { console.error(result.error); process.exit(1); }
    console.log(`Gate ${gateId} rejected.`);
  });

// ─── arbiter audit ────────────────────────────────────────────────────────────

const auditCmd = program.command('audit').description('Audit and verification commands');

auditCmd
  .command('verify')
  .description('Verify receipt chain integrity for all receipts')
  .option('--workspace <path>', 'Workspace root', process.cwd())
  .action(async (opts: Record<string, string>) => {
    const root = path.resolve(opts['workspace']);
    const receipts = new BuildReceiptStore(root);
    const allResult = await receipts.readAll();
    if (!allResult.ok) { console.error(allResult.error); process.exit(1); }
    if (allResult.value.length === 0) { console.log('No receipts to verify.'); return; }

    let passed = 0;
    let failed = 0;
    for (const r of allResult.value) {
      const v = await receipts.verify(r.receipt_id);
      if (v.ok && v.value) {
        passed++;
        console.log(`  ✓ ${r.receipt_id}`);
      } else {
        failed++;
        console.error(`  ✗ ${r.receipt_id} — ${v.ok ? 'signature invalid' : v.error}`);
      }
    }
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  });

auditCmd
  .command('log')
  .description('Print decision log')
  .option('--task <id>', 'Filter by task ID')
  .option('--workspace <path>', 'Workspace root', process.cwd())
  .action(async (opts: Record<string, string>) => {
    const root = path.resolve(opts['workspace']);
    const log = new DecisionLog(root);
    const result = await log.readAll();
    if (!result.ok) { console.error(result.error); process.exit(1); }
    const entries = opts['task']
      ? result.value.filter(e => e.task_id === opts['task'])
      : result.value;
    entries.forEach(e => console.log(JSON.stringify(e)));
  });

// ─── arbiter status ───────────────────────────────────────────────────────────

program
  .command('status [task-id]')
  .description('Show pipeline status — all tasks if no id given, or a specific task')
  .option('--workspace <path>', 'Workspace root', process.cwd())
  .action(async (taskId: string | undefined, opts: Record<string, string>) => {
    const root = path.resolve(opts['workspace']);

    if (taskId) {
      const store = new StateStore(root, taskId);
      const stateResult = await store.read();
      if (!stateResult.ok) { console.error(stateResult.error); process.exit(1); }
      const { task_id, phase_status, sub_tasks } = stateResult.value;
      console.log(`Task: ${task_id}  Status: ${phase_status}`);
      for (const [id, entry] of Object.entries(sub_tasks)) {
        const strike = entry.strike ? ` (strike ${entry.strike})` : '';
        console.log(`  ${entry.status.padEnd(12)} ${entry.agent_role.padEnd(16)} ${id}${strike}`);
      }
    } else {
      const fsModule = await import('node:fs/promises');
      const tasksDir = path.join(root, 'arbiter', 'tasks');
      let taskIds: string[];
      try {
        const dirents = await fsModule.readdir(tasksDir, { withFileTypes: true });
        taskIds = dirents.filter(d => d.isDirectory()).map(d => d.name);
      } catch {
        taskIds = [];
      }
      if (taskIds.length === 0) { console.log('No tasks found.'); return; }
      for (const tid of taskIds) {
        const store = new StateStore(root, tid);
        const sr = await store.read();
        if (sr.ok) {
          const done = Object.values(sr.value.sub_tasks).filter(e => e.status === 'completed').length;
          const total = Object.keys(sr.value.sub_tasks).length;
          console.log(`  ${tid.padEnd(32)} [${sr.value.phase_status}]  ${done}/${total} sub-tasks`);
        } else {
          console.log(`  ${tid.padEnd(32)} [no state]`);
        }
      }
    }
  });

// ─── arbiter usage ────────────────────────────────────────────────────────────

program
  .command('usage')
  .description('Show today\'s token and cost usage')
  .option('--workspace <path>', 'Workspace root', process.cwd())
  .action(async (opts: Record<string, string>) => {
    const root = path.resolve(opts['workspace']);
    const limiter = new RateLimiter(root);
    const total = await limiter.getTodayTotal();
    const headroom = await limiter.getHeadroom();
    console.log(`Today's spend: $${total.toFixed(4)}`);
    console.log(`Budget headroom: ${Math.round(headroom * 100)}%`);
  });

// ─── arbiter task ─────────────────────────────────────────────────────────────

const taskCmd = program.command('task').description('Task lifecycle management');

taskCmd
  .command('init <task-id>')
  .description('Initialise a new task from a spec file and write initial pipeline state')
  .option('--spec <file>', 'Path to the feature spec file (markdown)')
  .option('--template <name>', 'Start from a built-in spec template: new-feature, bug-fix, refactor, api-endpoint')
  .option('--pipeline <name>', 'Pipeline to use: standard (11 agents, default) or fast (5 agents: prd, frontend, backend, test-writer, push)', 'standard')
  .option('--skip <agents>', 'Comma-separated agent roles to skip (e.g. frontend,tech-writer)')
  .option('--workspace <path>', 'Workspace root', process.cwd())
  .action(async (taskId: string, opts: Record<string, string>) => {
    const root = path.resolve(opts['workspace']);

    // Resolve spec file — either from --spec or --template
    let specFile: string;
    if (opts['template']) {
      const templateName = opts['template'];
      const candidates = [
        path.join(root, 'agents', 'templates', 'tasks', `${templateName}.md`),
        path.join(__dirname, '..', '..', 'agents', 'templates', 'tasks', `${templateName}.md`),
      ];
      const found = candidates.find(c => {
        try { require('node:fs').accessSync(c); return true; } catch { return false; }
      });
      if (!found) {
        console.error(`Template "${templateName}" not found. Available: new-feature, bug-fix, refactor, api-endpoint`);
        process.exit(1);
      }
      specFile = found;
      console.log(`Using template: ${templateName}`);
    } else if (opts['spec']) {
      specFile = path.resolve(opts['spec']);
    } else {
      console.error('Error: provide --spec <file> or --template <name>');
      process.exit(1);
    }

    const initializer = new TaskInitializer(root);

    const skipAgents = opts['skip']
      ? opts['skip'].split(',').map(s => s.trim())
      : [];

    const pipelineOpt = (opts['pipeline'] === 'fast' ? 'fast' : 'standard') as 'standard' | 'fast';

    const result = await initializer.init({
      taskId,
      specFile,
      workspaceRoot: root,
      skipAgents: skipAgents as never[],
      pipeline: pipelineOpt,
    });

    if (!result.ok) {
      console.error(`Error: ${result.error}`);
      process.exit(1);
    }

    const { taskDir, stateFile, subTaskCount, pipeline } = result.value;

    console.log(`\nTask ${taskId} initialised  [${pipelineOpt} pipeline]`);
    console.log(`  Spec copied to: ${taskDir}/task.md`);
    console.log(`  State file:     ${stateFile}`);
    console.log(`\nPipeline (${subTaskCount} sub-tasks):`);
    console.log(TaskInitializer.describePipeline(skipAgents as never[], pipelineOpt));
    console.log(`\nRun with:  arbiter conduct ${taskId} --workspace ${root}`);
    console.log(`Resume:    arbiter conduct ${taskId} --resume --workspace ${root}`);

    void pipeline; // used in describePipeline above
  });

taskCmd
  .command('list')
  .description('List all tasks initialised in this workspace')
  .option('--workspace <path>', 'Workspace root', process.cwd())
  .option('--archived', 'Include archived tasks', false)
  .action(async (opts: Record<string, string | boolean>) => {
    const root = path.resolve(opts['workspace'] as string);
    const showArchived = Boolean(opts['archived']);
    const fsModule = await import('node:fs/promises');
    const tasksDir = path.join(root, 'arbiter', 'tasks');
    let taskIds: string[];
    try {
      const dirents = await fsModule.readdir(tasksDir, { withFileTypes: true });
      taskIds = dirents.filter(d => d.isDirectory()).map(d => d.name);
    } catch {
      taskIds = [];
    }

    if (taskIds.length === 0 && !showArchived) {
      console.log('No tasks found (workspace not initialised or no tasks created yet).');
      return;
    }

    if (taskIds.length > 0) {
      console.log('Tasks:');
      for (const tid of taskIds) {
        const store = new StateStore(root, tid);
        const sr = await store.read();
        if (sr.ok) {
          const done = Object.values(sr.value.sub_tasks).filter(e => e.status === 'completed').length;
          const total = Object.keys(sr.value.sub_tasks).length;
          console.log(`  ${tid.padEnd(32)} [${sr.value.phase_status}]  ${done}/${total} sub-tasks`);
        } else {
          console.log(`  ${tid.padEnd(32)} [no state]`);
        }
      }
    }

    if (showArchived) {
      const archiver = new TaskArchiver(root);
      const archivedResult = await archiver.list();
      if (archivedResult.ok && archivedResult.value.length > 0) {
        console.log('\nArchived:');
        archivedResult.value.forEach(m => {
          console.log(`  ${m.task_id}  [${m.phase_status}]  archived: ${m.archived_at}`);
        });
      } else {
        console.log('\nNo archived tasks.');
      }
    }
  });

taskCmd
  .command('show <task-id>')
  .description('Show pipeline status for a specific task')
  .option('--workspace <path>', 'Workspace root', process.cwd())
  .action(async (taskId: string, opts: Record<string, string>) => {
    const root = path.resolve(opts['workspace']);
    const store = new StateStore(root, taskId);
    const stateResult = await store.read();
    if (!stateResult.ok) { console.error(stateResult.error); process.exit(1); }

    const { task_id, phase_status, sub_tasks } = stateResult.value;
    console.log(`Task: ${task_id}  Status: ${phase_status}`);
    for (const [id, entry] of Object.entries(sub_tasks)) {
      const strike = entry.strike ? ` (strike ${entry.strike})` : '';
      console.log(`  ${entry.status.padEnd(12)} ${entry.agent_role.padEnd(16)} ${id}${strike}`);
    }
  });

taskCmd
  .command('reset <task-id>')
  .description('Reset all sub-tasks to pending (keeps state.json, clears progress)')
  .option('--workspace <path>', 'Workspace root', process.cwd())
  .action(async (taskId: string, opts: Record<string, string>) => {
    const root = path.resolve(opts['workspace']);
    const store = new StateStore(root, taskId);
    const stateResult = await store.read();
    if (!stateResult.ok) { console.error(stateResult.error); process.exit(1); }

    const state = stateResult.value;
    for (const subTaskId of Object.keys(state.sub_tasks)) {
      await store.updateSubTask(subTaskId, {
        status: 'pending',
        output_hash: undefined,
        receipt_id: undefined,
        strike: undefined,
        last_failure_class: undefined,
        completed_at: undefined,
      });
    }

    // Clear stale gate entries so they don't block the next run
    const gatePoller = new GatePoller(root, new DecisionLog(root));
    const clearedResult = await gatePoller.clearTask(taskId);
    const clearedCount = clearedResult.ok ? clearedResult.value : 0;

    console.log(`Task ${taskId}: all ${Object.keys(state.sub_tasks).length} sub-tasks reset to pending.`);
    if (clearedCount > 0) console.log(`Cleared ${clearedCount} stale gate entry/entries.`);
  });

taskCmd
  .command('archive <task-id>')
  .description('Archive the active task to free the workspace for a new task')
  .option('--workspace <path>', 'Workspace root', process.cwd())
  .action(async (taskId: string, opts: Record<string, string>) => {
    const root = path.resolve(opts['workspace']);
    const archiver = new TaskArchiver(root);
    const result = await archiver.archive(taskId);
    if (!result.ok) { console.error(`Error: ${result.error}`); process.exit(1); }
    const { archived_at, phase_status, sub_task_count } = result.value;
    console.log(`Task "${taskId}" archived.`);
    console.log(`  Status: ${phase_status}  |  Sub-tasks: ${sub_task_count}  |  At: ${archived_at}`);
    console.log(`  Restore with: arbiter task restore ${taskId}`);
  });

taskCmd
  .command('restore <task-id>')
  .description('Restore an archived task as the active task')
  .option('--workspace <path>', 'Workspace root', process.cwd())
  .action(async (taskId: string, opts: Record<string, string>) => {
    const root = path.resolve(opts['workspace']);
    const archiver = new TaskArchiver(root);
    const result = await archiver.restore(taskId);
    if (!result.ok) { console.error(`Error: ${result.error}`); process.exit(1); }
    const { task_id, phase_status } = result.value;
    console.log(`Task "${task_id}" restored as active task.`);
    console.log(`  Status: ${phase_status}`);
    console.log(`  Resume with: arbiter conduct ${task_id} --resume`);
  });

taskCmd
  .command('templates')
  .description('List built-in task spec templates')
  .action(() => {
    console.log('Built-in task spec templates:\n');
    console.log('  new-feature   — General new feature spec');
    console.log('  bug-fix       — Bug report and fix spec');
    console.log('  refactor      — Code refactoring spec');
    console.log('  api-endpoint  — New REST API endpoint spec');
    console.log('\nUsage: arbiter task init <task-id> --template <name>');
  });

// ─── arbiter queue ────────────────────────────────────────────────────────────

const queueCmd = program.command('queue').description('Task queue management');

queueCmd
  .command('list')
  .description('List queued tasks')
  .option('--workspace <path>', 'Workspace root', process.cwd())
  .action(async (opts: Record<string, string>) => {
    const root = path.resolve(opts['workspace']);
    const q = new TaskQueue(root);
    const result = await q.list();
    if (!result.ok) { console.error(result.error); process.exit(1); }
    if (result.value.length === 0) { console.log('Queue empty.'); return; }
    result.value.forEach(t => console.log(`  [${t.priority}] ${t.task_id}  ${t.queued_at}`));
  });

// ─── arbiter projects ─────────────────────────────────────────────────────────

const projectsCmd = program.command('projects').description('Registered project management');

projectsCmd
  .command('list')
  .description('List all projects registered with Arbiter (~/.arbiter/projects.json)')
  .action(async () => {
    const result = await listProjects();
    if (!result.ok) { console.error(result.error); process.exit(1); }
    const { projects, active } = result.value;
    if (projects.length === 0) {
      console.log('No projects registered. Run `arbiter init` inside a project directory.');
      return;
    }
    projects.forEach(p => {
      const marker = p.id === active ? ' (active)' : '';
      console.log(`  ${p.id}${marker}`);
      console.log(`    Name: ${p.name}`);
      console.log(`    Root: ${p.root}`);
      console.log(`    Last accessed: ${p.last_accessed}`);
    });
  });

// ─── arbiter bundle ───────────────────────────────────────────────────────────

const bundleCmd = program.command('bundle').description('Audit evidence bundle management');

bundleCmd
  .command('create <task-id>')
  .description('Assemble the AUDIT-EVIDENCE-BUNDLE ZIP for a completed task')
  .option('--workspace <path>', 'Workspace root', process.cwd())
  .action(async (taskId: string, opts: Record<string, string>) => {
    const root = path.resolve(opts['workspace']);
    const store = new StateStore(root, taskId);
    const stateResult = await store.read();
    if (!stateResult.ok) { console.error(stateResult.error); process.exit(1); }

    const { phase_status, sub_tasks } = stateResult.value;

    const pendingCount = Object.values(sub_tasks).filter(e => e.status !== 'completed').length;
    if (pendingCount > 0) {
      console.warn(
        `Warning: task has ${pendingCount} non-completed sub-task(s). Bundle will reflect partial evidence.`,
      );
    }

    console.log(`Assembling evidence bundle for ${taskId}...`);
    const assembler = new BundleAssembler(root);
    const result = await assembler.assemble(taskId, stateResult.value);
    if (!result.ok) { console.error(`Bundle failed: ${result.error}`); process.exit(1); }

    const { zipPath, sigPath, bundleId, manifest, presentArtifacts, missingArtifacts } = result.value;

    console.log(`\n✓ Bundle created`);
    console.log(`  Bundle ID:  ${bundleId}`);
    console.log(`  ZIP:        ${zipPath}`);
    console.log(`  Signature:  ${sigPath}`);
    console.log(`  Feature:    ${manifest.feature_name}`);
    console.log(`  Completed:  ${manifest.completed_at}`);
    console.log(`\n  ALC controls covered (${manifest.alc_controls_covered.length}):`);
    manifest.alc_controls_covered.forEach(c => console.log(`    ✓ ${c}`));
    if (missingArtifacts.length > 0) {
      console.log(`\n  Missing artifacts (${missingArtifacts.length}):`);
      missingArtifacts.forEach(a => console.log(`    ✗ ${a}`));
    }
    console.log(`\n  Git commits: ${manifest.git_commits.length}`);
    console.log(`  Receipts:    ${manifest.receipts.length}`);

    void phase_status; // used in warning above
  });

bundleCmd
  .command('verify <zip-path>')
  .description('Verify the Ed25519 signature and hash of an AUDIT-EVIDENCE-BUNDLE ZIP')
  .option('--workspace <path>', 'Workspace root (for signing key)', process.cwd())
  .action(async (zipPath: string, opts: Record<string, string>) => {
    const root = path.resolve(opts['workspace']);
    const assembler = new BundleAssembler(root);
    const result = await assembler.verify(path.resolve(zipPath));
    if (!result.ok) { console.error(result.error); process.exit(1); }

    if (result.value.valid) {
      console.log(`✓ Bundle signature valid`);
      console.log(`  Hash: ${result.value.bundleHash}`);
    } else {
      console.error(`✗ Bundle signature INVALID`);
      console.error(`  Hash: ${result.value.bundleHash}`);
      process.exit(1);
    }
  });

bundleCmd
  .command('list')
  .description('List all AUDIT-EVIDENCE-BUNDLE ZIPs in the workspace')
  .option('--workspace <path>', 'Workspace root', process.cwd())
  .action(async (opts: Record<string, string>) => {
    const root = path.resolve(opts['workspace']);
    const assembler = new BundleAssembler(root);
    const result = await assembler.listBundles();
    if (!result.ok) { console.error(result.error); process.exit(1); }
    if (result.value.length === 0) {
      console.log('No bundles found.');
    } else {
      result.value.forEach(b => console.log(`  ${b}`));
    }
  });

// ─── arbiter preflight ────────────────────────────────────────────────────────

const preflightCmd = program.command('preflight').description('Pre-flight validation commands');

preflightCmd
  .command('check <task-id>')
  .description('Run pre-flight checks against eligible sub-tasks without spawning agents')
  .option('--workspace <path>', 'Workspace root', process.cwd())
  .action(async (taskId: string, opts: Record<string, string>) => {
    const root = path.resolve(opts['workspace']);
    const taskDir = path.join(root, 'arbiter', 'tasks', taskId);
    const store = new StateStore(root, taskId);
    const stateResult = await store.read();
    if (!stateResult.ok) { console.error(stateResult.error); process.exit(1); }

    const state = stateResult.value;

    const contextAssembler = new ContextAssembler(root);
    const contextPruner = new ContextPruner();
    const preflight = new PreflightCheck();

    const eligible = Object.entries(state.sub_tasks).filter(([, e]) => e.status === 'pending');
    if (eligible.length === 0) {
      console.log('No pending sub-tasks to check.');
      return;
    }

    let anyFailed = false;
    for (const [subTaskId, entry] of eligible) {
      const ctxResult = await contextAssembler.assemble(entry.agent_role, taskDir, '', '');
      if (!ctxResult.ok) {
        console.error(`  [ERROR] ${subTaskId}: context assembly failed — ${ctxResult.error}`);
        anyFailed = true;
        continue;
      }
      const ctx = contextPruner.prune(ctxResult.value);
      if (!ctx.ok) { console.error(`  [ERROR] ${subTaskId}: context prune failed`); anyFailed = true; continue; }

      const result = await preflight.run(subTaskId, entry.agent_role, ctx.value.filesIncluded, state.complexity_score);
      if (!result.ok) {
        console.error(`  [ERROR] ${subTaskId}: ${result.error}`);
        anyFailed = true;
        continue;
      }

      const { passed, verdict, contextHash } = result.value;
      const icon = passed ? '✓' : '✗';
      console.log(`  ${icon} ${subTaskId.padEnd(20)} [${verdict}]  hash=${contextHash.slice(0, 20)}...`);
      if (!passed) {
        console.log(preflight.formatFailures(result.value));
        anyFailed = true;
      }
    }

    if (anyFailed) process.exit(1);
  });

// ─── arbiter cache ────────────────────────────────────────────────────────────

const cacheCmd = program.command('cache').description('Evidence cache management');

cacheCmd
  .command('invalidate')
  .description('Invalidate evidence cache entries (optionally filtered by module)')
  .option('--module <pattern>', 'Invalidate only entries matching this module pattern')
  .option('--workspace <path>', 'Workspace root', process.cwd())
  .action(async (opts: Record<string, string>) => {
    const root = path.resolve(opts['workspace']);
    const cache = new EvidenceCache(root);
    const result = await cache.invalidate(opts['module']);
    if (!result.ok) { console.error(result.error); process.exit(1); }
    console.log(`Invalidated ${result.value} evidence cache entry/entries.`);
  });

// ─── arbiter watch ────────────────────────────────────────────────────────────

program
  .command('watch')
  .description('Watch a directory for new spec files and auto-conduct each as a task')
  .option('--dir <path>', 'Directory to watch for spec files (default: ./specs)', './specs')
  .option('--interval <ms>', 'Poll interval in milliseconds', '3000')
  .option('--workspace <path>', 'Workspace root', process.cwd())
  .action(async (opts: Record<string, string>) => {
    const root = path.resolve(opts['workspace']);
    const specDir = path.resolve(opts['dir']);
    const pollIntervalMs = parseInt(opts['interval'], 10);

    const watcher = new SpecWatcher({ specDir, workspaceRoot: root, pollIntervalMs });

    process.on('SIGINT', () => { watcher.stop(); process.exit(0); });

    await watcher.start(async (specFile, taskId) => {
      const initializer = new TaskInitializer(root);
      const initResult = await initializer.init({ taskId, specFile, workspaceRoot: root });
      if (!initResult.ok) return initResult;

      const conductor = new Conductor({
        resume: false,
        shadow: false,
        dryRun: false,
        workspaceRoot: root,
        maxParallel: 1,
      });
      const result = await conductor.conduct(taskId);
      if (!result.ok) return result;
      return { ok: true, value: undefined };
    });
  });

// ── arbiter sync ─────────────────────────────────────────────────────────────
const syncCmd = program.command('sync');
syncCmd
  .description('Sync agent templates from Arbiter installation to project arbiter/ folder')
  .option('--check', 'Show what would change without writing (dry run)')
  .option('--workspace <path>', 'Workspace root (default: cwd)')
  .action(async (opts: { check?: boolean; workspace?: string }) => {
    const workspaceRoot = path.resolve(opts.workspace ?? process.cwd());
    // Find the Arbiter package root (2 dirs up from dist/cli/index.js)
    const pkgRoot = path.join(__dirname, '..', '..');
    const destRoot = path.join(workspaceRoot, 'arbiter');

    const syncDirs = [
      'agents/templates', 'agents/templates-speed',
      'agents/manifests', 'agents/manifests-speed',
      'agents/orchestrator', 'agents/triage',
      'agents/investigator', 'agents/knowledge',
      'engine',
    ];

    // Load template_vars from arbiter.config.json if present
    let templateVars: Record<string, string> = {};
    try {
      const cfgRaw = await fs.readFile(path.join(workspaceRoot, 'arbiter.config.json'), 'utf-8');
      const cfg = JSON.parse(cfgRaw) as { template_vars?: Record<string, string> };
      templateVars = cfg.template_vars ?? {};
    } catch { /* no config */ }

    let totalUpdated = 0;
    let totalUnchanged = 0;

    const { createHash } = await import('node:crypto');

    const syncDir = async (src: string, dest: string): Promise<void> => {
      let entries: import('node:fs').Dirent[];
      try { entries = await fs.readdir(src, { withFileTypes: true }); }
      catch { return; } // src dir doesn't exist in installation

      if (!opts.check) await fs.mkdir(dest, { recursive: true });

      for (const entry of entries) {
        const srcFile = path.join(src, entry.name);
        const destFile = path.join(dest, entry.name);
        if (entry.isDirectory()) {
          await syncDir(srcFile, destFile);
        } else {
          let content = await fs.readFile(srcFile, 'utf-8');
          for (const [k, v] of Object.entries(templateVars)) {
            content = content.split(`{{${k}}}`).join(v);
          }
          let destContent = '';
          try { destContent = await fs.readFile(destFile, 'utf-8'); } catch { /* new file */ }
          const srcHash = createHash('sha256').update(content).digest('hex');
          const destHash = createHash('sha256').update(destContent).digest('hex');
          if (srcHash !== destHash) {
            if (!opts.check) await fs.writeFile(destFile, content, 'utf-8');
            console.log(`  ${opts.check ? '[would update]' : '[updated]'} ${path.relative(destRoot, destFile)}`);
            totalUpdated++;
          } else {
            totalUnchanged++;
          }
        }
      }
    };

    for (const dir of syncDirs) {
      await syncDir(path.join(pkgRoot, dir), path.join(destRoot, dir));
    }

    console.log(`\nSynced ${totalUpdated + totalUnchanged} files. ${totalUpdated} updated. ${totalUnchanged} unchanged.`);
  });

// ── arbiter dashboard ─────────────────────────────────────────────────────────
// ── arbiter preview ─────────────────────────────────────────────────────────
program.command('preview <task-id>')
  .description('Run a task\'s app (dev server) and expose its URL to the dashboard for live review')
  .option('--dir <path>', 'Directory of the app to run (default: workspace root)')
  .option('--workspace <path>', 'Workspace root (default: cwd)', process.cwd())
  .action(async (taskId: string, opts: { dir?: string; workspace: string }) => {
    const root = path.resolve(opts.workspace);
    const appDir = opts.dir ? path.resolve(opts.dir) : root;
    const previewPath = path.join(root, 'arbiter', 'tasks', taskId, 'preview.json');
    const { startPreview } = await import('../preview/PreviewServer');
    const handle = await startPreview(appDir, (m) => console.log(`[preview] ${m}`));
    if (!handle) { console.error('No dev server to run.'); process.exit(1); }
    await fs.mkdir(path.dirname(previewPath), { recursive: true });
    await fs.writeFile(previewPath, JSON.stringify({ url: handle.url, port: handle.port, script: handle.script, startedAt: new Date().toISOString() }, null, 2));
    console.log(`\n  ✓ Preview for ${taskId} → ${handle.url}\n  (open the task in the dashboard → Preview tab. Ctrl+C to stop.)`);
    const cleanup = async () => { await handle.stop(); await fs.rm(previewPath, { force: true }).catch(() => {}); process.exit(0); };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    await new Promise(() => {}); // keep alive
  });

// ── arbiter factory ─────────────────────────────────────────────────────────
program.command('factory')
  .description('Run the factory daemon — pick up ready tasks, run them through the pipeline, keep the board live')
  .option('--workspace <path>', 'Workspace root (default: cwd)', process.cwd())
  .option('--provider <type>', 'Provider for all agents (use "mock" for a free local run)')
  .option('--max-tasks <n>', 'Max concurrent in-flight tasks', '2')
  .option('--interval <ms>', 'Watch interval in ms', '3000')
  .option('--once', 'Run a single tick and exit (no watch loop)', false)
  .action(async (opts: { workspace: string; provider?: string; maxTasks: string; interval: string; once?: boolean }) => {
    const { FactoryDaemon } = await import('../factory/FactoryDaemon');
    let provider: unknown;
    if (opts.provider === 'mock') { const { MockProvider } = await import('../providers/MockProvider'); provider = new MockProvider(); console.log('Factory using MockProvider — no agents billed.\n'); }
    const daemon = new FactoryDaemon({
      workspaceRoot: path.resolve(opts.workspace),
      provider,
      maxTasks: parseInt(opts.maxTasks, 10) || 2,
      intervalMs: parseInt(opts.interval, 10) || 3000,
    });
    process.on('SIGINT', () => { daemon.stop(); console.log('\nFactory stopped.'); process.exit(0); });
    if (opts.once) await daemon.tick(); else await daemon.watch();
  });

// ── arbiter board ──────────────────────────────────────────────────────────
program.command('board')
  .description('Project current task states into arbiter/board.json (authoritative board for the dashboard)')
  .option('--workspace <path>', 'Workspace root (default: cwd)', process.cwd())
  .action(async (opts: { workspace: string }) => {
    const { projectBoard } = await import('../board/BoardProjector');
    const board = await projectBoard(path.resolve(opts.workspace));
    console.log(`Wrote arbiter/lanes.json — ${board.cards.length} card(s) across ${board.lanes.length} lanes.`);
  });

program.command('dashboard')
  .description('Start the Arbiter dashboard')
  .option('--port <port>', 'Port to serve on', '3070')
  .option('--workspace <path>', 'Workspace root (default: cwd)')
  .action(async (opts: { port?: string; workspace?: string }) => {
    const port = opts.port ?? '3070';
    const pkgRoot = path.join(__dirname, '..', '..');
    const dashboardDist = path.join(pkgRoot, 'dashboard', 'dist');
    const dashboardSrc = path.join(pkgRoot, 'dashboard');

    // Check if built dist exists
    let hasDist = false;
    try { await fs.access(path.join(dashboardDist, 'index.html')); hasDist = true; } catch { /* not built */ }

    if (!hasDist) {
      console.log('Building dashboard...');
      const { execSync } = await import('node:child_process');
      execSync('npm run build', { cwd: dashboardSrc, stdio: 'inherit' });
    }

    console.log(`Dashboard running at http://localhost:${port}`);
    const { execSync } = await import('node:child_process');
    execSync(`npx --yes serve dist --port ${port} --single`, { cwd: dashboardSrc, stdio: 'inherit' });
  });

program.parseAsync(process.argv).catch(err => {
  console.error(err);
  process.exit(1);
});
