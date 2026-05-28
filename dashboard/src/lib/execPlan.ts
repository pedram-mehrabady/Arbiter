import type { Job, BoardData, StageHistoryEntry } from '../api/types';

const STAGE_LABEL: Record<string, string> = {
  'reframe':        'reframe',
  'questions':      'questions',
  'research':       'research',
  'design':         'design',
  'design-errors':  'design-review',
  'plan':           'plan',
  'frontend':       'frontend',
  'backend':        'backend',
  'test-writer':    'test-writer',
  'reviewer':       'reviewer',
  'tech-writer':    'tech-writer',
};

const SKIP_SUFFIXES = new Set([
  'spec', 'question-report', 'design-report', 'frontend-report',
  'backend-report', 'debug-notes', 'lessons',
]);

// Non-numbered files that ARE real stage outputs (integrator writes integration.md without a prefix)
const SPECIAL_STAGE_FILES: Record<string, string> = {
  'integration': 'integrator',
};

const STAGE_SEQUENCE = [
  'reframe', 'questions', 'research', 'design', 'design-review',
  'integrator', 'plan', 'frontend', 'backend', 'test-writer', 'reviewer',
];

export type ExecPlanFile = { name: string; mtime_ms: number };

export function fileToStage(filename: string): string | null {
  const base = filename.replace(/\.(md|json)$/, '');

  // Non-numbered special stage files (e.g. integration.md)
  if (SPECIAL_STAGE_FILES[base]) return SPECIAL_STAGE_FILES[base];

  // Numbered files: must start with digits then a hyphen
  const match = base.match(/^\d+-(.+)$/);
  if (!match) return null;
  const suffix = match[1];
  if (SKIP_SUFFIXES.has(suffix)) return null;
  return STAGE_LABEL[suffix] ?? suffix;
}

export function buildStageHistory(files: ExecPlanFile[]): {
  history: StageHistoryEntry[];
  started_at: string | null;
  last_activity_ms: number | null;
} {
  // Sort by filename so stage order is always correct (0-, 1-, 2-…)
  const stageFiles = [...files]
    .filter((f) => fileToStage(f.name) !== null)
    .sort((a, b) => a.name.localeCompare(b.name));

  const history: StageHistoryEntry[] = [];
  const seen = new Set<string>();

  for (const f of stageFiles) {
    const stage = fileToStage(f.name)!;
    if (seen.has(stage)) continue;
    seen.add(stage);
    // Duration kept at 0 — mtime ordering is unreliable across agents;
    // total elapsed is computed from started_at in the stats bar instead.
    history.push({ stage, duration_s: 0, outcome: 'complete' });
  }

  // started_at = earliest mtime across all stage files (best proxy for "when this task began")
  const mtimes = stageFiles.map((f) => f.mtime_ms).filter((m) => m > 0);
  const minMtime = mtimes.length > 0 ? Math.min(...mtimes) : 0;
  const started_at = minMtime > 0 ? new Date(minMtime).toISOString() : null;

  const maxMtime = stageFiles.length > 0 ? Math.max(...stageFiles.map((f) => f.mtime_ms)) : 0;
  const last_activity_ms = maxMtime > 0 ? maxMtime : null;
  return { history, started_at, last_activity_ms };
}

function inferNextStage(completed: string[]): string | null {
  const done = new Set(completed);
  for (const s of STAGE_SEQUENCE) {
    if (!done.has(s)) return s;
  }
  return null;
}

interface DirectStageEntry { dir: string; status: Job['status'] }

export function synthesizeJobsFromBoard(
  board: BoardData | null,
  execPlanFiles: Record<string, ExecPlanFile[]>,
  existingJobs: Job[],
  execPlanStage?: Record<string, DirectStageEntry>,
): Job[] {
  const existing = new Set(existingJobs.map((j) => j.ticket ?? j.id));
  const out: Job[] = [];
  const synthesised = new Set<string>();

  function makeJob(ticket: string, title: string, status: Job['status'], fallbackLabel?: string): Job {
    const files = execPlanFiles[ticket] ?? [];
    const { history, started_at, last_activity_ms } = buildStageHistory(files);
    const completedNames = history.map((s) => s.stage);
    const nextStage = inferNextStage(completedNames);

    return {
      id: ticket,
      ticket,
      title,
      status,
      stage_label: nextStage ?? fallbackLabel ?? (completedNames[completedNames.length - 1] ?? ''),
      stage_history: history.length > 0 ? history : undefined,
      started_at: started_at ?? undefined,
      last_activity_ms: last_activity_ms ?? undefined,
    };
  }

  // Direct scan results (live, not board-stale)
  if (execPlanStage) {
    for (const [ticket, stg] of Object.entries(execPlanStage)) {
      if (existing.has(ticket)) continue;
      const title = board?.states[stg.dir]?.find((i) => i.id === ticket)?.title ?? ticket;
      out.push(makeJob(ticket, title, stg.status));
      synthesised.add(ticket);
    }
  }

  // Fallback: board.json for tickets the direct scan missed
  if (board) {
    const stageDefs: Array<[string, Job['status'], string?]> = [
      ['02-incubating', 'building'],
      ['03-building',   'building', 'building'],
      ['04-human-gate', 'building', 'gate'],
      ['05-review',     'building', 'review'],
      ['06-completed',  'done'],
      ['07-failed',     'failed'],
    ];
    for (const [stageKey, status, fallback] of stageDefs) {
      for (const item of board.states[stageKey] ?? []) {
        if (item.id.startsWith('.') || existing.has(item.id) || synthesised.has(item.id)) continue;
        out.push(makeJob(item.id, item.title, status, fallback));
        synthesised.add(item.id);
      }
    }
  }

  return out;
}

export function activeExecPlanTickets(board: BoardData | null): string[] {
  if (!board) return [];
  const tickets: string[] = [];
  for (const stage of ['02-incubating', '03-building', '04-human-gate', '05-review']) {
    for (const item of board.states[stage] ?? []) {
      if (!item.id.startsWith('.')) tickets.push(item.id);
    }
  }
  return tickets;
}
