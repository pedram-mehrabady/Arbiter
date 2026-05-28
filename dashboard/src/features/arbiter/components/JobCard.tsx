import { useState, useEffect } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import type { Job, TaskTier, IronFunnelStatus, CriticalPathFlag } from '../../../api/types';
import styles from './JobCard.module.css';

interface Stage { key: string; label: string; emoji: string; type: 'main' | 'gate' | 'final'; detailKey: string; }

const PLAN_STAGE:  Stage = { key: 'plan',    label: 'Plan',   emoji: '🧠', type: 'main',  detailKey: 'brief'   };
const FRONT_STAGE: Stage = { key: 'front',   label: 'Front',  emoji: '⚛',  type: 'main',  detailKey: 'front'   };
const BE_STAGE:    Stage = { key: 'backend', label: 'BE',     emoji: '⚙',  type: 'main',  detailKey: 'backend' };
const TAIL_STAGES: Stage[] = [
  { key: 'check',  label: 'Check',  emoji: '🧠', type: 'gate',  detailKey: 'check'  },
  { key: 'push',   label: 'Push',   emoji: '🧪', type: 'main',  detailKey: 'push'   },
  { key: 'review', label: 'Review', emoji: '🔍', type: 'main',  detailKey: 'review' },
  { key: 'gate',   label: 'Gate',   emoji: '🧠', type: 'gate',  detailKey: 'gate'   },
  { key: 'merged', label: 'Merged', emoji: '✓',  type: 'final', detailKey: 'merged' },
];

function buildStages(): Stage[] {
  return [PLAN_STAGE, FRONT_STAGE, BE_STAGE, ...TAIL_STAGES];
}

// Map a stage-ish label to an index in the given dynamic stages (-1 if no match).
// Uses word boundaries so "PRD" doesn't get mistaken for "pr" (pull request → review).
function labelToStageIndex(label: string, stages: Stage[]): number {
  const l = (label ?? '').toLowerCase();
  const has = (k: string) => stages.findIndex((s) => s.key === k);
  if (/\b(merged|merge|done|shipped)\b/.test(l)) return has('merged');
  if (l === 'babysitter-review' || l.includes('gate')) return has('gate');
  if (l.includes('review') || /\bpr\b/.test(l) || l.includes('pull request')) return has('review');
  if (l.includes('push') || l.includes('test')) return has('push');
  if (l.includes('check') || l.startsWith('babysitter-')) return has('check');
  if (l.includes('backend') || l.includes('api') || /\bbe\b/.test(l)) { const i = has('backend'); return i >= 0 ? i : has('front'); }
  if (l.includes('front') || /\bui\b/.test(l)) { const i = has('front'); return i >= 0 ? i : has('backend'); }
  if (l.includes('prd') || l.includes('brief') || l.includes('plan') || l.includes('spec') || l.includes('babysitter')) return has('plan');
  return -1;
}

// Current active stage index (everything before it is done)
function currentStageIndex(job: Job, stages: Stage[]): number {
  if (['merged', 'done', 'shipped'].includes(job.status)) return stages.length - 1;
  // plan-ready / ready → the plan (brief) is done; the build stage is next/active
  if (['plan-ready', 'ready'].includes(job.status)) {
    const i = stages.findIndex((s) => s.key === 'front' || s.key === 'backend');
    return i >= 0 ? i : 0;
  }
  const fromLabel = labelToStageIndex(job.stage_label ?? '', stages);
  if (fromLabel >= 0) return fromLabel;
  if (['building', 'queued'].includes(job.status)) {
    const i = stages.findIndex((s) => s.key === 'front' || s.key === 'backend');
    return i >= 0 ? i : 0;
  }
  return 0;
}

function fmtDur(s: number) {
  if (!s || s < 0) return '';
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
}

function fmtMs(ms?: number | null): string {
  if (!ms || ms <= 0) return '';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(Math.round(ms / 100) / 10)}s`;
  return `${Math.floor(ms / 60_000)}m`;
}

const STATUS_CLASSES: Record<string, string> = {
  planned: 'st-planned', 'plan-ready': 'st-plan-ready', queued: 'st-queued',
  building: 'st-building', paused: 'st-paused', done: 'st-done',
  merged: 'st-done', shipped: 'st-done', failed: 'st-failed',
};

const STATUS_LABELS: Record<string, string> = {
  planned: 'Planned', 'plan-ready': 'Ready to Build', queued: 'Queued',
  building: 'Building', paused: 'Awaiting Check', done: 'Merged',
  merged: 'Merged', shipped: 'Merged', failed: 'Failed',
};

export function JobCard({ job }: { job: Job }) {
  const { expandedJobs, toggleJobExpand, openJobDetail, liveApi } = useAppStore(useShallow((s) => ({
    expandedJobs:    s.expandedJobs,
    toggleJobExpand: s.toggleJobExpand,
    openJobDetail:   s.openJobDetail,
    liveApi:         s.liveApi,
  })));

  const [tier, setTier] = useState<TaskTier | null>(null);
  const [ironFunnel, setIronFunnel] = useState<IronFunnelStatus | null>(null);
  const [criticalPath, setCriticalPath] = useState<CriticalPathFlag | null>(null);

  useEffect(() => {
    if (!liveApi) return;
    const api = liveApi as unknown as {
      readTaskTier?: (id: string) => Promise<TaskTier | null>;
      readIronFunnelStatus?: (id: string) => Promise<IronFunnelStatus | null>;
      readCriticalPathFlag?: (id: string) => Promise<CriticalPathFlag | null>;
    };
    if (typeof api.readTaskTier !== 'function') return;
    let cancelled = false;
    Promise.all([
      api.readTaskTier(job.id),
      api.readIronFunnelStatus?.(job.id) ?? Promise.resolve(null),
      api.readCriticalPathFlag?.(job.id) ?? Promise.resolve(null),
    ]).then(([t, f, c]) => {
      if (cancelled) return;
      setTier(t ?? null);
      setIronFunnel(f ?? null);
      setCriticalPath(c ?? null);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [liveApi, job.id]);

  const isExpanded = (expandedJobs instanceof Set) && expandedJobs.has(job.id);
  const isDone = ['done', 'shipped', 'merged'].includes(job.status);
  const isFailed = job.status === 'failed';

  const statusCls = STATUS_CLASSES[job.status] ?? '';
  const statusLabel = STATUS_LABELS[job.status] ?? job.status;

  const totalDur = job.started_at
    ? fmtDur(Math.floor((new Date(job.completed_at ?? Date.now()).getTime() - new Date(job.started_at).getTime()) / 1000))
    : '';

  const STAGES = buildStages();
  const cur = currentStageIndex(job, STAGES);
  const reworks = job.rework_history ?? [];

  // How many times the pipeline was sent back to each stage
  const reworkCounts: Record<number, number> = {};
  for (const r of reworks) {
    const idx = labelToStageIndex(r.to_stage, STAGES);
    if (idx >= 0) reworkCounts[idx] = (reworkCounts[idx] ?? 0) + 1;
  }

  const TIER_LABELS: Record<number, string> = { 1: 'T1', 2: 'T2', 3: 'T3' };
  const TIER_STYLE_KEYS: Record<number, string> = { 1: styles.tier1, 2: styles.tier2, 3: styles.tier3 };

  return (
    <div className={`${styles.card}${isFailed ? ' ' + styles.failedCard : isDone ? ' ' + styles.doneCard : job.status === 'building' ? ' ' + styles.buildingCard : ''}`}>
      <div className={styles.hdr} onClick={() => toggleJobExpand(job.id)} style={{ cursor: 'pointer' }}>
        <span className={`status-badge ${statusCls}`}>{statusLabel}</span>
        {job.ticket && <span className={styles.ticket}>{job.ticket}</span>}
        <span className={styles.title}>{job.title}</span>
        {totalDur && <span className={styles.totalTime}>⏱ {totalDur}</span>}
        {isDone && job.pr_url && (
          <a className={styles.prBtn} href={job.pr_url} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>Open PR ↗</a>
        )}
        {isDone && !job.pr_url && <span className={styles.mergedLabel}>✓ Merged</span>}
        {tier && (
          <span className={`${styles.tierBadge} ${TIER_STYLE_KEYS[tier.tier] ?? ''}`} title={`Tier ${tier.tier} — ${tier.profile}`}>
            {TIER_LABELS[tier.tier]}
          </span>
        )}
        <span className={styles.expandIcon}>{isExpanded ? '▲' : '▼'}</span>
      </div>

      {criticalPath?.isCriticalPath && (
        <div className={styles.criticalBanner}>
          ⚠ CRITICAL PATH — blocking {criticalPath.blockingCount} {criticalPath.blockingCount === 1 ? 'task' : 'tasks'}
        </div>
      )}

      <div className={styles.pipeline}>
        {STAGES.map((stage, i) => {
          const done = i < cur || isDone;
          const active = i === cur && !isDone;
          const pending = !done && !active;
          const isGate = stage.type === 'gate';
          const reworked = reworkCounts[i] ?? 0;
          return (
            <div key={stage.key} className={styles.pipelineGroup}>
              <div
                className={`${styles.node}${isGate ? ' ' + styles.gateNode : ''}${active ? ' ' + styles.activeNode : ''}${done ? ' ' + styles.doneNode : ''}${pending ? ' ' + styles.pendingNode : ''} ${styles.nodeClickable}`}
                title={reworked > 0 ? `${stage.label} — sent back ${reworked}×` : `Open ${job.ticket ?? job.title}`}
                onClick={(e) => { e.stopPropagation(); openJobDetail(job.id); }}
              >
                {reworked > 0 && <span className={styles.reworkBadge}>↩{reworked}</span>}
                <span className={styles.nodeEmoji}>{stage.emoji}</span>
                <span className={styles.nodeLabel}>{stage.label}</span>
              </div>
              {i < STAGES.length - 1 && (
                <div className={`${styles.arrow}${done ? ' ' + styles.arrowDone : ''}`}>›</div>
              )}
            </div>
          );
        })}
      </div>

      {reworks.length > 0 && (
        <div className={styles.reworkLog}>
          {reworks.map((r, i) => (
            <div key={i} className={styles.reworkEntry}>
              <span className={styles.reworkTag}>↩ sent back</span>
              <span className={styles.reworkStage}>{r.to_stage}</span>
              <span className={styles.reworkReason}>{r.reason}</span>
            </div>
          ))}
        </div>
      )}

      {isExpanded && (
        <div className={styles.detailPanel}>
          {ironFunnel && (
            <div className={styles.ironFunnel}>
              <div className={styles.ironFunnelLabel}>IRON FUNNEL</div>
              <div className={styles.ironFunnelGates}>
                {ironFunnel.gates.map((gate, i) => {
                  const statusKey = gate.status === 'passed' ? styles.gatePassed :
                    gate.status === 'failed' ? styles.gateFailed :
                    gate.status === 'running' ? styles.gateRunning :
                    gate.status === 'skipped' ? styles.gateSkipped : styles.gatePending;
                  return (
                    <div key={gate.gate} className={styles.ironFunnelGroup}>
                      <div className={`${styles.ironGate} ${statusKey}`}>
                        <span className={styles.ironGateType}>{gate.type === 'deterministic' ? '🔒' : '🤖'}</span>
                        <span className={styles.ironGateName}>{gate.name}</span>
                        <span className={styles.ironGateStatus}>
                          {gate.status === 'passed' ? `✓ ${fmtMs(gate.elapsed_ms)}` :
                           gate.status === 'failed' ? `✗ ${gate.error_count ?? 0} err` :
                           gate.status === 'running' ? '⏳' :
                           gate.status === 'skipped' ? '— skip' : '…'}
                        </span>
                      </div>
                      {i < ironFunnel.gates.length - 1 && (
                        <span className={styles.ironGateArrow}>→</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {(job.stage_history ?? []).length > 0 ? (
            <div className={styles.histList}>
              {(job.stage_history ?? []).map((h, i) => (
                <div key={i} className={styles.histRow}>
                  <span className={styles.histStage}>{h.stage}</span>
                  <span className={styles.histDur}>{fmtDur(h.duration_s) || '—'}</span>
                  <span className={`${styles.histOutcome} ${h.outcome === 'pass' ? styles.outcomePass : h.outcome === 'rework' ? styles.outcomeRework : styles.outcomeFail}`}>
                    {h.outcome}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            !ironFunnel && <div className={styles.noDetail}>No stage history yet</div>
          )}
        </div>
      )}
    </div>
  );
}
