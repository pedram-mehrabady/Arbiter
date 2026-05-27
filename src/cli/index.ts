#!/usr/bin/env node
import { Command } from 'commander';
import path from 'node:path';
import { Conductor } from '../conductor/Conductor';
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

const program = new Command();

program
  .name('arbiter')
  .description('Deterministic multi-agent AI pipeline for structured feature delivery')
  .version('0.1.0');

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

    console.log(`\n✓ arbiter.config.json written`);
    console.log(`  agents/docs/master-directives.md created`);
    console.log(`  Project registered in ~/.arbiter/projects.json`);
    console.log(`\nNext steps:`);
    console.log(`  1. Create a task spec (e.g. my-feature-spec.md)`);
    console.log(`  2. arbiter task init <task-id> --spec my-feature-spec.md`);
    console.log(`  3. arbiter conduct <task-id>`);
  });

// ─── arbiter conduct ──────────────────────────────────────────────────────────

program
  .command('conduct <task-id>')
  .description('Run the pipeline for a task')
  .option('--resume', 'Resume from last checkpoint', false)
  .option('--shadow', 'Shadow mode — log decisions without executing', false)
  .option('--dry-run', 'Show what would run without invoking agents', false)
  .option('--workspace <path>', 'Workspace root (default: cwd)', process.cwd())
  .option('--max-parallel <n>', 'Max concurrent sub-task agents', '1')
  .action(async (taskId: string, opts: Record<string, string | boolean>) => {
    const workspaceRoot = path.resolve(opts['workspace'] as string);
    const conductor = new Conductor({
      resume: Boolean(opts['resume']),
      shadow: Boolean(opts['shadow']),
      dryRun: Boolean(opts['dryRun']),
      workspaceRoot,
      maxParallel: parseInt(String(opts['maxParallel']), 10),
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
  .command('status')
  .description('Show pipeline status for current task')
  .option('--workspace <path>', 'Workspace root', process.cwd())
  .action(async (opts: Record<string, string>) => {
    const root = path.resolve(opts['workspace']);
    const store = new StateStore(root);
    const stateResult = await store.read();
    if (!stateResult.ok) { console.error(stateResult.error); process.exit(1); }

    const { task_id, phase_status, sub_tasks } = stateResult.value;
    console.log(`Task: ${task_id}  Status: ${phase_status}`);
    for (const [id, entry] of Object.entries(sub_tasks)) {
      const strike = entry.strike ? ` (strike ${entry.strike})` : '';
      console.log(`  ${entry.status.padEnd(12)} ${entry.agent_role.padEnd(16)} ${id}${strike}`);
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
  .requiredOption('--spec <file>', 'Path to the feature spec file (markdown)')
  .option('--skip <agents>', 'Comma-separated agent roles to skip (e.g. frontend,tech-writer)')
  .option('--workspace <path>', 'Workspace root', process.cwd())
  .action(async (taskId: string, opts: Record<string, string>) => {
    const root = path.resolve(opts['workspace']);
    const initializer = new TaskInitializer(root);

    const skipAgents = opts['skip']
      ? opts['skip'].split(',').map(s => s.trim())
      : [];

    const result = await initializer.init({
      taskId,
      specFile: path.resolve(opts['spec']),
      workspaceRoot: root,
      skipAgents: skipAgents as never[],
    });

    if (!result.ok) {
      console.error(`Error: ${result.error}`);
      process.exit(1);
    }

    const { taskDir, stateFile, subTaskCount, pipeline } = result.value;

    console.log(`\nTask ${taskId} initialised`);
    console.log(`  Spec copied to: ${taskDir}/task.md`);
    console.log(`  State file:     ${stateFile}`);
    console.log(`\nPipeline (${subTaskCount} sub-tasks):`);
    console.log(TaskInitializer.describePipeline(skipAgents as never[]));
    console.log(`\nRun with:  arbiter conduct ${taskId} --workspace ${root}`);
    console.log(`Resume:    arbiter conduct ${taskId} --resume --workspace ${root}`);

    void pipeline; // used in describePipeline above
  });

taskCmd
  .command('list')
  .description('List all tasks initialised in this workspace')
  .option('--workspace <path>', 'Workspace root', process.cwd())
  .action(async (opts: Record<string, string>) => {
    const root = path.resolve(opts['workspace']);
    const fsModule = await import('node:fs/promises');
    const tasksDir = path.join(root, '.arbiter', 'tasks');
    let entries: string[];
    try {
      const dirents = await fsModule.readdir(tasksDir, { withFileTypes: true });
      entries = dirents.filter(d => d.isDirectory()).map(d => d.name);
    } catch {
      console.log('No tasks found (workspace not initialised or no tasks created yet).');
      return;
    }
    if (entries.length === 0) { console.log('No tasks found.'); return; }

    // Read state.json to annotate the active task with its status
    const store = new StateStore(root);
    const stateResult = await store.read();
    const activeTaskId = stateResult.ok ? stateResult.value.task_id : null;
    const activeStatus = stateResult.ok ? stateResult.value.phase_status : null;

    entries.forEach(name => {
      const isActive = name === activeTaskId;
      const statusStr = isActive && activeStatus ? `  [${activeStatus}]` : '';
      const marker = isActive ? ' *' : '';
      console.log(`  ${name}${marker}${statusStr}`);
    });
  });

taskCmd
  .command('show <task-id>')
  .description('Show pipeline status for a specific task')
  .option('--workspace <path>', 'Workspace root', process.cwd())
  .action(async (taskId: string, opts: Record<string, string>) => {
    const root = path.resolve(opts['workspace']);
    const store = new StateStore(root);
    const stateResult = await store.read();
    if (!stateResult.ok) { console.error(stateResult.error); process.exit(1); }

    const { task_id, phase_status, sub_tasks } = stateResult.value;
    if (task_id !== taskId) {
      console.error(`State is for task "${task_id}", not "${taskId}". Use \`arbiter status\` to see the current active task.`);
      process.exit(1);
    }
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
    const store = new StateStore(root);
    const stateResult = await store.read();
    if (!stateResult.ok) { console.error(stateResult.error); process.exit(1); }

    const state = stateResult.value;
    if (state.task_id !== taskId) {
      console.error(`State is for task "${state.task_id}", not "${taskId}"`);
      process.exit(1);
    }

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
    const store = new StateStore(root);
    const stateResult = await store.read();
    if (!stateResult.ok) { console.error(stateResult.error); process.exit(1); }

    const { task_id, phase_status, sub_tasks } = stateResult.value;
    if (task_id !== taskId) {
      console.error(`State is for task "${task_id}", not "${taskId}"`);
      process.exit(1);
    }

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
    const taskDir = path.join(root, '.arbiter', 'tasks', taskId);
    const store = new StateStore(root);
    const stateResult = await store.read();
    if (!stateResult.ok) { console.error(stateResult.error); process.exit(1); }

    const state = stateResult.value;
    if (state.task_id !== taskId) {
      console.error(`State is for task "${state.task_id}", not "${taskId}"`);
      process.exit(1);
    }

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

program.parseAsync(process.argv).catch(err => {
  console.error(err);
  process.exit(1);
});
