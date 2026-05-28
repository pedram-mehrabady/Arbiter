import { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { PlanItem, Job, PlanType, PendingApproval } from '../../api/types';
import { planPhase, phaseGroup } from '../../lib/planPhase';
import { ExtractModal } from './ExtractModal';
import css from './PlansPanel.module.css';

// ── Constants ─────────────────────────────────────────────────────────────────
const STALE_MS = 2 * 60 * 60 * 1000; // 2 hours

// ── Display status ────────────────────────────────────────────────────────────
type DisplayStatus = 'active' | 'gate' | 'plan_ready' | 'queued' | 'draft' | 'done' | 'failed';

function getDisplayStatus(
  plan: PlanItem,
  jobs: Job[],
  pa?: PendingApproval | null,
): DisplayStatus {
  const { phase, job } = planPhase(plan, jobs, pa ?? null);
  if (phase === 'failed') return 'failed';
  if (phaseGroup(phase) === 'done') return 'done';
  if (phase === 'gate') return 'gate';
  if (phase === 'draft') return 'draft';
  if (phase === 'submitted') return 'queued';
  // phase === 'building' — check if stale
  if (job?.last_activity_ms && Date.now() - job.last_activity_ms > STALE_MS) {
    const completed = new Set((job.stage_history ?? []).map((s) => s.stage));
    return completed.has('plan') ? 'plan_ready' : 'queued';
  }
  return 'active';
}

// ── Status badge ──────────────────────────────────────────────────────────────
const STATUS_META: Record<DisplayStatus, { label: string; cls: string }> = {
  active:     { label: '● Building',    cls: css.statusActive     },
  gate:       { label: '⚠ Needs Input', cls: css.statusGate       },
  plan_ready: { label: '◦ Plan Ready',  cls: css.statusPlanReady  },
  queued:     { label: '⧗ Queued',      cls: css.statusQueued     },
  draft:      { label: '○ Draft',       cls: css.statusDraft      },
  done:       { label: '✓ Done',        cls: css.statusDone       },
  failed:     { label: '✕ Failed',      cls: css.statusFailed     },
};

function StatusBadge({ status }: { status: DisplayStatus }) {
  const m = STATUS_META[status];
  return <span className={`${css.statusBadge} ${m.cls}`}>{m.label}</span>;
}

// ── Type badge ────────────────────────────────────────────────────────────────
const TYPE_META: Record<PlanType, { label: string; icon: string; cls: string }> = {
  feature:  { label: 'Feature',  icon: '✨', cls: css.typeFeature  },
  bug:      { label: 'Bug',      icon: '🐛', cls: css.typeBug      },
  refactor: { label: 'Refactor', icon: '♻️', cls: css.typeRefactor },
  chore:    { label: 'Chore',    icon: '🔧', cls: css.typeChore    },
};

const TYPE_FILTERS: { key: 'all' | PlanType; label: string }[] = [
  { key: 'all',      label: 'All'         },
  { key: 'feature',  label: '✨ Feature'  },
  { key: 'bug',      label: '🐛 Bug'      },
  { key: 'refactor', label: '♻️ Refactor' },
  { key: 'chore',    label: '🔧 Chore'    },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtStageDur(s: number): string {
  if (s <= 0) return '';
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function totalDur(job?: Job): number {
  const histDur = (job?.stage_history ?? []).reduce((sum, s) => sum + s.duration_s, 0);
  if (histDur > 0) return histDur;
  if (job?.started_at) return Math.round((Date.now() - new Date(job.started_at).getTime()) / 1000);
  return 0;
}

function totalTokens(job?: Job): number | null {
  const hist = job?.stage_history ?? [];
  if (!hist.some((s) => s.tokens_used != null)) return job?.tokens_used ?? null;
  const sum = hist.reduce((a, s) => a + (s.tokens_used ?? 0), 0);
  return (sum + (job?.tokens_used ?? 0)) || null;
}

function fmtTokens(n: number | null): string {
  if (n == null) return '—';
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function fmtTs(ts?: string | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function planTitle(plan: PlanItem): string {
  // Don't repeat the ticket if it's identical to the title
  if (!plan.title || plan.title === plan.ticket) return plan.ticket;
  return plan.title;
}

// ── In-Progress card ──────────────────────────────────────────────────────────
function ActiveCard({ plan, jobs, pendingApproval }: {
  plan: PlanItem; jobs: Job[]; pendingApproval?: PendingApproval | null;
}) {
  const { selectPlan, approveGate } = useAppStore(useShallow((s) => ({
    selectPlan:  s.selectPlan,
    approveGate: s.approveGate,
  })));
  const { phase, job } = planPhase(plan, jobs, pendingApproval ?? null);
  const meta = TYPE_META[plan.planType ?? 'feature'];
  const isGate = phase === 'gate';
  const history = job?.stage_history ?? [];

  return (
    <div
      className={`${css.activeCard}${isGate ? ' ' + css.activeCardGate : ''}`}
      onClick={() => selectPlan(plan.id)}
    >
      <div className={css.activeTop}>
        <span className={css.activeTicket}>{plan.ticket}</span>
        <span className={`${css.typeBadge} ${meta.cls}`}>{meta.icon} {meta.label}</span>
        <StatusBadge status={isGate ? 'gate' : 'active'} />
      </div>
      <div className={css.activeTitle}>{planTitle(plan)}</div>

      {/* Stage pills */}
      <div className={css.stagePills}>
        {history.map((s, i) => {
          const dur = fmtStageDur(s.duration_s);
          return (
            <span key={i} className={css.stagePillDone} title={`${s.stage} — ${s.outcome}`}>
              ✓ {s.stage}{dur && <span className={css.stagePillDur}> {dur}</span>}
            </span>
          );
        })}
        {(phase === 'building' || isGate) && job?.stage_label && (
          <span className={isGate ? css.stagePillGate : css.stagePillActive}>
            {isGate ? '⚠' : '▶'} {isGate ? (pendingApproval?.gate ?? job.stage_label) : job.stage_label}
          </span>
        )}
      </div>

      {/* Stats bar */}
      {(job?.started_at || totalDur(job) > 0 || totalTokens(job) != null) && (
        <div className={css.statsBar}>
          {totalDur(job) > 0 && (
            <span className={css.statItem}>
              <span className={css.statLabel}>⏱</span>
              <span className={css.statValue}>{fmtStageDur(totalDur(job))}</span>
            </span>
          )}
          {totalDur(job) > 0 && <span className={css.statDivider} />}
          {job?.started_at && (
            <span className={css.statItem}>
              <span className={css.statLabel}>started</span>
              <span className={css.statValue}>{fmtTs(job.started_at)}</span>
            </span>
          )}
          {job?.started_at && job?.completed_at && <span className={css.statDivider} />}
          {job?.completed_at && (
            <span className={css.statItem}>
              <span className={css.statLabel}>ended</span>
              <span className={css.statValue}>{fmtTs(job.completed_at)}</span>
            </span>
          )}
          <span className={css.statDivider} />
          <span className={css.statItem}>
            <span className={css.statLabel}>tokens</span>
            <span className={css.statValue}>{fmtTokens(totalTokens(job))}</span>
          </span>
        </div>
      )}

      {/* Gate banner or footer */}
      {isGate && pendingApproval ? (
        <div className={css.gateBanner}>
          <div className={css.gateBannerLeft}>
            <span className={css.gateBannerIcon}>⚠</span>
            <div>
              <div className={css.gateBannerTitle}>Action required</div>
              <div className={css.gateBannerSub}>{pendingApproval.gate_title ?? pendingApproval.title ?? 'Review needed'}</div>
            </div>
          </div>
          <div className={css.gateBannerActions}>
            <button className={css.gateBannerApprove} onClick={(e) => { e.stopPropagation(); approveGate(); }}>
              ✓ Approve
            </button>
            <button className={css.gateBannerView} onClick={(e) => { e.stopPropagation(); selectPlan(plan.id); }}>
              View Chat →
            </button>
          </div>
        </div>
      ) : (
        <div className={css.activeFooter}>
          <span className={css.activeViewLink}>View →</span>
        </div>
      )}
    </div>
  );
}

// ── Generic plan row (for plan_ready, queued, pipeline) ───────────────────────
function PlanRow({ plan, jobs, pa, status }: {
  plan: PlanItem; jobs: Job[]; pa?: PendingApproval | null; status: DisplayStatus;
}) {
  const selectPlan = useAppStore((s) => s.selectPlan);
  const { job } = planPhase(plan, jobs, pa ?? null);
  const meta = TYPE_META[plan.planType ?? 'feature'];
  const history = job?.stage_history ?? [];
  const dur = totalDur(job);

  return (
    <div className={css.row} onClick={() => selectPlan(plan.id)}>
      <span className={css.ticket}>{plan.ticket}</span>
      <div className={css.planInfo}>
        <span className={css.ptitle}>{planTitle(plan)}</span>
        {history.length > 0 && (
          <div className={css.stageHistoryDots}>
            {history.map((s, i) => (
              <span key={i} className={css.stageHistoryDot} title={s.stage}>✓</span>
            ))}
            {job?.stage_label && (
              <span className={css.stageMini}>▶ {job.stage_label}</span>
            )}
          </div>
        )}
      </div>
      <span className={`${css.typeBadge} ${meta.cls}`}>{meta.icon} {meta.label}</span>
      <StatusBadge status={status} />
      {dur > 0 && <span className={css.elapsedBadge}>{fmtStageDur(dur)}</span>}
    </div>
  );
}

// ── Backlog row (draggable draft items) ───────────────────────────────────────
function BacklogRow({ plan, selected, jobs, pa }: {
  plan: PlanItem; selected: boolean; jobs: Job[]; pa?: PendingApproval | null;
}) {
  const { selectPlan, submitToFactory, isConnected } = useAppStore(useShallow((s) => ({
    selectPlan:      s.selectPlan,
    submitToFactory: s.submitToFactory,
    isConnected:     s.isConnected,
  })));

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: plan.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : undefined };
  const meta = TYPE_META[plan.planType ?? 'feature'];

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${css.row}${selected ? ' ' + css.rowSelected : ''}`}
      onClick={() => selectPlan(plan.id)}
    >
      <span className={css.handle} {...attributes} {...listeners} onClick={(e) => e.stopPropagation()}>⠿</span>
      <span className={css.rank}>{plan.priority + 1}</span>
      <span className={css.ticket}>{plan.ticket}</span>
      <div className={css.planInfo}>
        <span className={css.ptitle}>{planTitle(plan)}</span>
      </div>
      <span className={`${css.typeBadge} ${meta.cls}`}>{meta.icon} {meta.label}</span>
      <button
        className={css.startBtn}
        onClick={(e) => { e.stopPropagation(); submitToFactory(plan.id); }}
        disabled={!isConnected}
        title={!isConnected ? 'Connect repo first' : 'Submit to factory'}
      >
        📤 Submit
      </button>
    </div>
  );
}

// ── Done row ──────────────────────────────────────────────────────────────────
function DoneRow({ plan, jobs }: { plan: PlanItem; jobs: Job[] }) {
  const selectPlan = useAppStore((s) => s.selectPlan);
  const meta = TYPE_META[plan.planType ?? 'feature'];
  const job = jobs.find((j) => j.ticket === plan.ticket || j.id === plan.ticket);
  const dur = totalDur(job);
  const tok = totalTokens(job);
  const failed = job?.status === 'failed';

  return (
    <div className={`${css.row} ${failed ? css.rowFailed : css.rowDone}`} onClick={() => selectPlan(plan.id)}>
      <span className={failed ? css.failIcon : css.doneCheck}>{failed ? '✕' : '✓'}</span>
      <span className={css.ticket}>{plan.ticket}</span>
      <span className={css.ptitle}>{planTitle(plan)}</span>
      {dur > 0 && <span className={css.doneDur} title="total build time">⏱ {fmtStageDur(dur)}</span>}
      {tok != null && <span className={css.doneDur} title="total tokens">{fmtTokens(tok)} tok</span>}
      <span className={`${css.typeBadge} ${meta.cls}`}>{meta.icon} {meta.label}</span>
    </div>
  );
}

// ── Section header helper ─────────────────────────────────────────────────────
function SectionHdr({ dotCls, title, count, children }: {
  dotCls?: string; title: string; count?: number; children?: React.ReactNode;
}) {
  return (
    <div className={css.sectionHdr}>
      <span className={`${css.sectionDot}${dotCls ? ' ' + dotCls : ''}`} />
      <span className={css.sectionTitle}>{title}</span>
      {count != null && <span className={css.sectionCount}>{count}</span>}
      <div className={css.spacer} />
      {children}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────
export function PlansPanel() {
  const { plans, jobs, pendingApproval, selectedPlanId, reorderPlans, setOpenModal } = useAppStore(
    useShallow((s) => ({
      plans:           s.plans,
      jobs:            s.arbiterState.jobs,
      pendingApproval: s.arbiterState.pending_approval,
      selectedPlanId:  s.selectedPlanId,
      reorderPlans:    s.reorderPlans,
      setOpenModal:    s.setOpenModal,
    }))
  );

  const [tab, setTab]             = useState<'active' | 'all' | 'completed'>('active');
  const [typeFilter, setTypeFilter] = useState<'all' | PlanType>('all');
  const [deferredOpen, setDeferredOpen] = useState(false);
  const [extractOpen, setExtractOpen]   = useState(false);

  const sorted = [...plans].sort((a, b) => a.priority - b.priority);

  // Compute display status for every plan once
  const withStatus = sorted.map((p) => ({
    plan:   p,
    status: getDisplayStatus(p, jobs, pendingApproval),
  }));

  // Tab counts
  const activeCount    = withStatus.filter((x) => x.status === 'active' || x.status === 'gate').length;
  const completedCount = withStatus.filter((x) => x.status === 'done'   || x.status === 'failed').length;
  const allCount       = withStatus.length;

  // Grouped slices
  const activeItems    = withStatus.filter((x) => x.status === 'active' || x.status === 'gate');
  const planReadyItems = withStatus.filter((x) => x.status === 'plan_ready');
  const queuedItems    = withStatus.filter((x) => x.status === 'queued');
  const draftItems     = withStatus.filter((x) => x.status === 'draft' && !x.plan.deferred);
  const deferredItems  = withStatus.filter((x) => x.status === 'draft' && x.plan.deferred);
  const doneItems      = withStatus.filter((x) => x.status === 'done');
  const failedItems    = withStatus.filter((x) => x.status === 'failed');

  const filteredDraft = typeFilter === 'all'
    ? draftItems
    : draftItems.filter((x) => (x.plan.planType ?? 'feature') === typeFilter);

  const draftIds = filteredDraft.map((x) => x.plan.id);
  const sensors  = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function onDragEnd(e: DragEndEvent) {
    const { active: drag, over } = e;
    if (!over || drag.id === over.id) return;
    const oldIdx = draftIds.indexOf(String(drag.id));
    const newIdx = draftIds.indexOf(String(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    reorderPlans(arrayMove(draftIds, oldIdx, newIdx));
  }

  return (
    <div className={css.panel}>
      {/* ── Tab bar ── */}
      <div className={css.tabBar}>
        <button
          className={tab === 'active' ? css.tabActive : css.tab}
          onClick={() => setTab('active')}
        >
          Active <span className={css.tabCount}>{activeCount}</span>
        </button>
        <button
          className={tab === 'all' ? css.tabActive : css.tab}
          onClick={() => setTab('all')}
        >
          All <span className={css.tabCount}>{allCount}</span>
        </button>
        <button
          className={tab === 'completed' ? css.tabActive : css.tab}
          onClick={() => setTab('completed')}
        >
          Completed <span className={css.tabCount}>{completedCount}</span>
        </button>
        <div className={css.tabSpacer} />
        <button className={css.docBtn} onClick={() => setExtractOpen(true)}>📄 From doc</button>
        <button className={css.newBtn} onClick={() => setOpenModal('plan')}>+ New Task</button>
      </div>

      {/* ── Active tab ── */}
      {tab === 'active' && (
        <>
          {activeItems.length === 0 ? (
            <div className={css.emptyTab}>
              <span className={css.emptyTabIcon}>⚙</span>
              <span>Factory is idle — no tasks actively building</span>
            </div>
          ) : (
            <section className={css.section}>
              <SectionHdr dotCls={css.dotActive} title="In Progress" count={activeItems.length} />
              {activeItems.map(({ plan }) => (
                <ActiveCard key={plan.id} plan={plan} jobs={jobs} pendingApproval={pendingApproval} />
              ))}
            </section>
          )}
        </>
      )}

      {/* ── All tab ── */}
      {tab === 'all' && (
        <>
          {/* In Progress */}
          {activeItems.length > 0 && (
            <section className={css.section}>
              <SectionHdr dotCls={css.dotActive} title="In Progress" count={activeItems.length} />
              {activeItems.map(({ plan }) => (
                <ActiveCard key={plan.id} plan={plan} jobs={jobs} pendingApproval={pendingApproval} />
              ))}
            </section>
          )}

          {/* Plan Ready */}
          {planReadyItems.length > 0 && (
            <section className={css.section}>
              <SectionHdr dotCls={css.dotPlanReady} title="Plan Ready" count={planReadyItems.length} />
              <div className={css.list}>
                {planReadyItems.map(({ plan }) => (
                  <PlanRow key={plan.id} plan={plan} jobs={jobs} pa={pendingApproval} status="plan_ready" />
                ))}
              </div>
            </section>
          )}

          {/* In Pipeline (queued/submitted) */}
          {queuedItems.length > 0 && (
            <section className={css.section}>
              <SectionHdr dotCls={css.dotPipeline} title="In Pipeline" count={queuedItems.length} />
              <div className={css.list}>
                {queuedItems.map(({ plan }) => (
                  <PlanRow key={plan.id} plan={plan} jobs={jobs} pa={pendingApproval} status="queued" />
                ))}
              </div>
            </section>
          )}

          {/* Backlog (draft) */}
          <section className={css.section}>
            <SectionHdr title="Backlog" count={draftItems.length}>
              <button className={css.newBtn} onClick={() => setOpenModal('plan')}>+ New</button>
            </SectionHdr>

            <div className={css.typeFilterRow}>
              {TYPE_FILTERS.map((f) => (
                <button
                  key={f.key}
                  className={`${css.typeChip}${typeFilter === f.key ? ' ' + css.typeChipActive : ''}`}
                  onClick={() => setTypeFilter(f.key)}
                >
                  {f.label}
                  {f.key !== 'all' && (
                    <span className={css.chipCount}>
                      {draftItems.filter((x) => (x.plan.planType ?? 'feature') === f.key).length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={draftIds} strategy={verticalListSortingStrategy}>
                <div className={css.list}>
                  {filteredDraft.length === 0 ? (
                    <div className={css.empty}>
                      {draftItems.length === 0
                        ? <>No ideas yet — click <strong>+ New Task</strong> or <strong>📄 From doc</strong></>
                        : <>No {typeFilter !== 'all' ? typeFilter : ''} plans in backlog.</>}
                    </div>
                  ) : (
                    filteredDraft.map(({ plan }) => (
                      <BacklogRow
                        key={plan.id}
                        plan={plan}
                        selected={plan.id === selectedPlanId}
                        jobs={jobs}
                        pa={pendingApproval}
                      />
                    ))
                  )}
                </div>
              </SortableContext>
            </DndContext>
          </section>

          {/* Deferred */}
          {deferredItems.length > 0 && (
            <section className={css.section}>
              <button className={css.doneToggle} onClick={() => setDeferredOpen((v) => !v)}>
                <span className={`${css.sectionDot} ${css.dotDeferred}`} />
                <span className={css.sectionTitle}>Deferred</span>
                <span className={css.sectionCount}>{deferredItems.length}</span>
                <span className={css.chevron}>{deferredOpen ? '▲' : '▾'}</span>
              </button>
              {deferredOpen && (
                <div className={css.list}>
                  {deferredItems.map(({ plan }) => {
                    const meta = TYPE_META[plan.planType ?? 'feature'];
                    return (
                      <div key={plan.id} className={`${css.row} ${css.rowDeferred}`}
                        onClick={() => useAppStore.getState().selectPlan(plan.id)}>
                        <span className={css.deferredIcon}>💤</span>
                        <span className={css.ticket}>{plan.ticket}</span>
                        <span className={css.ptitle}>{planTitle(plan)}</span>
                        <span className={`${css.typeBadge} ${meta.cls}`}>{meta.icon} {meta.label}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}
        </>
      )}

      {/* ── Completed tab ── */}
      {tab === 'completed' && (
        <>
          {completedCount === 0 ? (
            <div className={css.emptyTab}>
              <span className={css.emptyTabIcon}>✓</span>
              <span>Nothing completed yet</span>
            </div>
          ) : (
            <>
              {doneItems.length > 0 && (
                <section className={css.section}>
                  <SectionHdr dotCls={css.dotDone} title="Done" count={doneItems.length} />
                  <div className={css.list}>
                    {doneItems.map(({ plan }) => <DoneRow key={plan.id} plan={plan} jobs={jobs} />)}
                  </div>
                </section>
              )}
              {failedItems.length > 0 && (
                <section className={css.section}>
                  <SectionHdr dotCls={css.dotFailed} title="Failed" count={failedItems.length} />
                  <div className={css.list}>
                    {failedItems.map(({ plan }) => <DoneRow key={plan.id} plan={plan} jobs={jobs} />)}
                  </div>
                </section>
              )}
            </>
          )}
        </>
      )}

      {extractOpen && <ExtractModal onClose={() => setExtractOpen(false)} />}
    </div>
  );
}
