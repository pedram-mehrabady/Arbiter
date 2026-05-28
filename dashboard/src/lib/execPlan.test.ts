import { describe, it, expect } from 'vitest';
import {
  fileToStage,
  buildStageHistory,
  synthesizeJobsFromBoard,
  activeExecPlanTickets,
} from './execPlan';
import type { BoardData, Job } from '../api/types';

// ── fileToStage() ─────────────────────────────────────────────────────────────

describe('fileToStage', () => {
  it('maps numbered stage files to their labels', () => {
    expect(fileToStage('0-reframe.md')).toBe('reframe');
    expect(fileToStage('1-questions.md')).toBe('questions');
    expect(fileToStage('2-research.md')).toBe('research');
    expect(fileToStage('3-design.md')).toBe('design');
    expect(fileToStage('5-plan.md')).toBe('plan');      // different number prefix — must still work
    expect(fileToStage('6-frontend.md')).toBe('frontend');
    expect(fileToStage('7-backend.md')).toBe('backend');
    expect(fileToStage('8-test-writer.md')).toBe('test-writer');
    expect(fileToStage('9-reviewer.md')).toBe('reviewer');
  });

  it('handles two-digit numeric prefix', () => {
    expect(fileToStage('10-tech-writer.md')).toBe('tech-writer');
  });

  it('skips metadata/report files', () => {
    expect(fileToStage('spec.md')).toBeNull();            // no numeric prefix, not a special file
    expect(fileToStage('question-report.json')).toBeNull();
    expect(fileToStage('design-report.json')).toBeNull();
  });

  it('maps integration.md (no numeric prefix) to integrator stage', () => {
    expect(fileToStage('integration.md')).toBe('integrator');
  });

  it('skips known metadata suffixes even when numbered', () => {
    // e.g. if factory ever writes "0-spec.md" it should be skipped
    expect(fileToStage('0-spec.md')).toBeNull();
    expect(fileToStage('1-question-report.json')).toBeNull();
  });

  it('returns unknown suffixes as-is (forward-compatible)', () => {
    expect(fileToStage('4-new-agent.md')).toBe('new-agent');
  });

  it('returns null for files without a numeric prefix', () => {
    expect(fileToStage('design.md')).toBeNull();
    expect(fileToStage('README.md')).toBeNull();
    expect(fileToStage('.DS_Store')).toBeNull();
  });

  it('design-errors suffix maps to design-review label', () => {
    expect(fileToStage('3-design-errors.md')).toBe('design-review');
  });
});

// ── buildStageHistory() ───────────────────────────────────────────────────────

describe('buildStageHistory', () => {
  it('produces history in filename sort order, not mtime order', () => {
    // mtime of questions < mtime of reframe — but filename sort puts reframe first
    const files = [
      { name: '0-reframe.md',   mtime_ms: 2000 },
      { name: '1-questions.md', mtime_ms: 1000 }, // earlier mtime, but LATER stage number
    ];
    const { history } = buildStageHistory(files);
    expect(history.map((h) => h.stage)).toEqual(['reframe', 'questions']);
  });

  it('skips metadata files', () => {
    const files = [
      { name: '0-reframe.md',       mtime_ms: 1000 },
      { name: 'spec.md',            mtime_ms: 900  },
      { name: 'question-report.json', mtime_ms: 950 },
    ];
    const { history } = buildStageHistory(files);
    expect(history.map((h) => h.stage)).toEqual(['reframe']);
  });

  it('deduplicates repeated stage labels (e.g. design + design-errors → design, design-review)', () => {
    const files = [
      { name: '3-design.md',        mtime_ms: 1000 },
      { name: '3-design-errors.md', mtime_ms: 1100 },
    ];
    const { history } = buildStageHistory(files);
    const labels = history.map((h) => h.stage);
    expect(labels).toContain('design');
    expect(labels).toContain('design-review');
    expect(labels.length).toBe(2); // no duplicates
  });

  it('sets started_at to the minimum mtime of stage files', () => {
    const files = [
      { name: '0-reframe.md',   mtime_ms: 5000 },
      { name: '1-questions.md', mtime_ms: 2000 }, // earliest
    ];
    const { started_at } = buildStageHistory(files);
    expect(started_at).toBe(new Date(2000).toISOString());
  });

  it('started_at is null when all mtimes are 0', () => {
    const files = [{ name: '0-reframe.md', mtime_ms: 0 }];
    const { started_at } = buildStageHistory(files);
    expect(started_at).toBeNull();
  });

  it('last_activity_ms is the maximum mtime across stage files', () => {
    const files = [
      { name: '0-reframe.md',   mtime_ms: 1000 },
      { name: '1-questions.md', mtime_ms: 5000 }, // latest
      { name: '2-research.md',  mtime_ms: 3000 },
    ];
    const { last_activity_ms } = buildStageHistory(files);
    expect(last_activity_ms).toBe(5000);
  });

  it('last_activity_ms is null when all mtimes are 0', () => {
    const files = [{ name: '0-reframe.md', mtime_ms: 0 }];
    const { last_activity_ms } = buildStageHistory(files);
    expect(last_activity_ms).toBeNull();
  });

  it('returns empty history for empty file list', () => {
    const { history, started_at } = buildStageHistory([]);
    expect(history).toEqual([]);
    expect(started_at).toBeNull();
  });

  it('all stage entries have outcome "complete"', () => {
    const files = [
      { name: '0-reframe.md',   mtime_ms: 1000 },
      { name: '1-questions.md', mtime_ms: 2000 },
    ];
    const { history } = buildStageHistory(files);
    expect(history.every((h) => h.outcome === 'complete')).toBe(true);
  });
});

// ── synthesizeJobsFromBoard() ─────────────────────────────────────────────────

function makeBoard(overrides: Partial<BoardData['states']> = {}): BoardData {
  return {
    generated: '2026-05-27T00:00:00',
    states: {
      '00-proposed': [],
      '01-inbox': [],
      '02-incubating': [],
      '03-building': [],
      '04-human-gate': [],
      '05-review': [],
      '06-completed': [],
      '07-failed': [],
      ...overrides,
    },
    queue: [],
  };
}

describe('synthesizeJobsFromBoard', () => {
  it('returns empty array for null board', () => {
    expect(synthesizeJobsFromBoard(null, {}, [])).toEqual([]);
  });

  it('synthesizes a building job for ticket in 02-incubating', () => {
    const board = makeBoard({
      '02-incubating': [{ id: 'FEAT-52', title: 'My feature', archetype: '' }],
    });
    const jobs = synthesizeJobsFromBoard(board, {}, []);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].ticket).toBe('FEAT-52');
    expect(jobs[0].status).toBe('building');
  });

  it('synthesizes stage history from provided file listing', () => {
    const board = makeBoard({
      '02-incubating': [{ id: 'FEAT-52', title: 'My feature', archetype: '' }],
    });
    const files = {
      'FEAT-52': [
        { name: '0-reframe.md',   mtime_ms: 1000 },
        { name: '1-questions.md', mtime_ms: 2000 },
      ],
    };
    const jobs = synthesizeJobsFromBoard(board, files, []);
    expect(jobs[0].stage_history?.map((s) => s.stage)).toEqual(['reframe', 'questions']);
  });

  it('infers next stage label from completed stages', () => {
    const board = makeBoard({
      '02-incubating': [{ id: 'FEAT-52', title: 'f', archetype: '' }],
    });
    const files = {
      'FEAT-52': [
        { name: '0-reframe.md',   mtime_ms: 1000 },
        { name: '1-questions.md', mtime_ms: 2000 },
        { name: '2-research.md',  mtime_ms: 3000 },
        { name: '3-design.md',    mtime_ms: 4000 },
      ],
    };
    const jobs = synthesizeJobsFromBoard(board, files, []);
    // After design, next is design-review (design-critic), then integrator
    expect(jobs[0].stage_label).toBe('design-review');
  });

  it('shows integrator as active after design-review completes', () => {
    const board = makeBoard({
      '02-incubating': [{ id: 'FEAT-52', title: 'f', archetype: '' }],
    });
    const files = {
      'FEAT-52': [
        { name: '0-reframe.md',        mtime_ms: 1000 },
        { name: '1-questions.md',      mtime_ms: 2000 },
        { name: '2-research.md',       mtime_ms: 3000 },
        { name: '3-design.md',         mtime_ms: 4000 },
        { name: '3-design-errors.md',  mtime_ms: 5000 }, // design-review done
      ],
    };
    const jobs = synthesizeJobsFromBoard(board, files, []);
    expect(jobs[0].stage_label).toBe('integrator');
  });

  it('shows plan as active after integrator completes', () => {
    const board = makeBoard({
      '02-incubating': [{ id: 'FEAT-52', title: 'f', archetype: '' }],
    });
    const files = {
      'FEAT-52': [
        { name: '0-reframe.md',        mtime_ms: 1000 },
        { name: '1-questions.md',      mtime_ms: 2000 },
        { name: '2-research.md',       mtime_ms: 3000 },
        { name: '3-design.md',         mtime_ms: 4000 },
        { name: '3-design-errors.md',  mtime_ms: 5000 },
        { name: 'integration.md',      mtime_ms: 6000 }, // integrator done
      ],
    };
    const jobs = synthesizeJobsFromBoard(board, files, []);
    expect(jobs[0].stage_label).toBe('plan');
  });

  it('does NOT synthesize tickets already in existingJobs (real jobs take precedence)', () => {
    const board = makeBoard({
      '02-incubating': [{ id: 'FEAT-52', title: 'f', archetype: '' }],
    });
    const realJob: Job = { id: 'FEAT-52', ticket: 'FEAT-52', title: 'real', status: 'building' };
    const jobs = synthesizeJobsFromBoard(board, {}, [realJob]);
    expect(jobs).toHaveLength(0);
  });

  it('skips .DS_Store and other dot-files in board entries', () => {
    const board = makeBoard({
      '02-incubating': [
        { id: '.DS_Store', title: '.DS_Store', archetype: '' },
        { id: 'FEAT-52',   title: 'f',         archetype: '' },
      ],
    });
    const jobs = synthesizeJobsFromBoard(board, {}, []);
    expect(jobs.map((j) => j.id)).not.toContain('.DS_Store');
    expect(jobs).toHaveLength(1);
  });

  it('synthesizes done job for 06-completed', () => {
    const board = makeBoard({
      '06-completed': [{ id: 'FEAT-50', title: 'done', archetype: '' }],
    });
    const jobs = synthesizeJobsFromBoard(board, {}, []);
    expect(jobs[0].status).toBe('done');
  });

  it('synthesizes failed job for 07-failed', () => {
    const board = makeBoard({
      '07-failed': [{ id: 'FEAT-51', title: 'failed', archetype: '' }],
    });
    const jobs = synthesizeJobsFromBoard(board, {}, []);
    expect(jobs[0].status).toBe('failed');
  });

  it('direct execPlanStage overrides board state (live scan wins)', () => {
    const board = makeBoard({
      '02-incubating': [{ id: 'FEAT-52', title: 'f', archetype: '' }],
    });
    // Direct scan says it's actually in 03-building now (board is stale)
    const directStage = { 'FEAT-52': { dir: '03-building', status: 'building' as const } };
    const jobs = synthesizeJobsFromBoard(board, {}, [], directStage);
    expect(jobs).toHaveLength(1);       // only one, not duplicated
    expect(jobs[0].status).toBe('building');
  });

  it('does not duplicate a ticket that appears in both direct scan and board', () => {
    const board = makeBoard({
      '02-incubating': [{ id: 'FEAT-52', title: 'f', archetype: '' }],
    });
    const directStage = { 'FEAT-52': { dir: '02-incubating', status: 'building' as const } };
    const jobs = synthesizeJobsFromBoard(board, {}, [], directStage);
    expect(jobs).toHaveLength(1);
  });
});

// ── activeExecPlanTickets() ───────────────────────────────────────────────────

describe('activeExecPlanTickets', () => {
  it('returns null → empty array', () => {
    expect(activeExecPlanTickets(null)).toEqual([]);
  });

  it('collects tickets from stages 02–05', () => {
    const board = makeBoard({
      '02-incubating': [{ id: 'FEAT-52', title: '', archetype: '' }],
      '03-building':   [{ id: 'FEAT-51', title: '', archetype: '' }],
      '04-human-gate': [{ id: 'FEAT-50', title: '', archetype: '' }],
      '05-review':     [{ id: 'FEAT-49', title: '', archetype: '' }],
    });
    const tickets = activeExecPlanTickets(board);
    expect(tickets).toContain('FEAT-52');
    expect(tickets).toContain('FEAT-51');
    expect(tickets).toContain('FEAT-50');
    expect(tickets).toContain('FEAT-49');
    expect(tickets).toHaveLength(4);
  });

  it('excludes dot-files like .DS_Store', () => {
    const board = makeBoard({
      '02-incubating': [{ id: '.DS_Store', title: '', archetype: '' }],
    });
    expect(activeExecPlanTickets(board)).toEqual([]);
  });

  it('does not include 01-inbox or 06-completed tickets', () => {
    const board = makeBoard({
      '01-inbox':     [{ id: 'FEAT-53', title: '', archetype: '' }],
      '06-completed': [{ id: 'FEAT-48', title: '', archetype: '' }],
    });
    expect(activeExecPlanTickets(board)).toEqual([]);
  });
});
