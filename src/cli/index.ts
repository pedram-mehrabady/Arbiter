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

const program = new Command();

program
  .name('arbiter')
  .description('Deterministic multi-agent AI pipeline for structured feature delivery')
  .version('0.1.0');

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
      dryRun: Boolean(opts['dry-run']),
      workspaceRoot,
      maxParallel: parseInt(String(opts['max-parallel']), 10),
    });
    const result = await conductor.conduct(taskId);
    if (!result.ok) {
      console.error(`\nError: ${result.error}`);
      process.exit(1);
    }
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

program.parseAsync(process.argv).catch(err => {
  console.error(err);
  process.exit(1);
});
