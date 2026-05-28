import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { renderMarkdown } from '../../lib/markdown';
import { planPhase } from '../../lib/planPhase';
import type { StageHistoryEntry } from '../../api/types';
import css from './PlanDetailPanel.module.css';

function fmtDuration(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function fmtTs(ts?: string | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function totalTokens(job: import('../../api/types').Job | undefined): number | null {
  const hist = job?.stage_history ?? [];
  if (!hist.some((s) => s.tokens_used != null)) return job?.tokens_used ?? null;
  const sum = hist.reduce((a, s) => a + (s.tokens_used ?? 0), 0);
  return (sum + (job?.tokens_used ?? 0)) || null;
}

function fmtTokens(n: number | null): string {
  if (n == null) return '—';
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

type View = 'split' | 'edit' | 'preview' | 'chat' | 'prd';

function fmtTime(ts: string): string {
  const d = new Date(ts);
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function PlanDetailPanel() {
  const {
    plans, selectedPlanId, isConnected, messages, jobs, pendingApproval,
    updatePlanMd, reloadPlanFromDisk, deletePlan, selectPlan,
    sendAgentMessage, setPlanExtraDocs, setPlanStatus, submitToFactory, approveGate,
  } = useAppStore(useShallow((s) => ({
    plans:             s.plans,
    jobs:              s.arbiterState.jobs,
    pendingApproval:   s.arbiterState.pending_approval,
    selectedPlanId:    s.selectedPlanId,
    isConnected:       s.isConnected,
    messages:          s.messages,
    updatePlanMd:      s.updatePlanMd,
    reloadPlanFromDisk: s.reloadPlanFromDisk,
    deletePlan:        s.deletePlan,
    selectPlan:        s.selectPlan,
    sendAgentMessage:  s.sendAgentMessage,
    setPlanExtraDocs:  s.setPlanExtraDocs,
    setPlanStatus:     s.setPlanStatus,
    submitToFactory:   s.submitToFactory,
    approveGate:       s.approveGate,
  })));

  const plan = plans.find((p) => p.id === selectedPlanId) ?? null;
  const planMd = plan?.md ?? '';
  const planDocs = plan?.extraDocs ?? '';

  const [draft, setDraft] = useState(planMd);
  const [view, setView] = useState<View>('split');
  const [saveNote, setSaveNote] = useState('');
  const [reply, setReply] = useState('');
  const [docs, setDocs] = useState(planDocs);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraft(planMd);
    setSaveNote('');
  }, [selectedPlanId, planMd]);

  useEffect(() => {
    setDocs(planDocs);
  }, [selectedPlanId, planDocs]);

  const thread = plan
    ? [...messages].filter((m) => m.ticket === plan.ticket).sort((a, b) => (a.ts < b.ts ? -1 : 1))
    : [];

  // Scroll to top synchronously when chat view opens (so stats card is visible)
  useLayoutEffect(() => {
    if (view === 'chat' && chatRef.current) chatRef.current.scrollTop = 0;
  }, [view, selectedPlanId]);

  // Scroll to bottom only when new messages arrive
  const prevThreadLen = useRef(thread.length);
  useEffect(() => {
    if (view !== 'chat' || !chatRef.current) return;
    if (thread.length > prevThreadLen.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
    prevThreadLen.current = thread.length;
  }, [thread.length]);

  const close = useCallback(() => selectPlan(null), [selectPlan]);

  // Close on Escape
  useEffect(() => {
    if (!plan) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') close(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [plan, close]);

  if (!plan) return null;

  const dirty = draft !== plan.md;
  const docsDirty = docs !== (plan.extraDocs ?? '');
  const complete = plan.status === 'ready';
  const { phase, job } = planPhase(plan, jobs, pendingApproval);
  const jobDone = phase === 'done';
  const isGateForMe = phase === 'gate' && !!pendingApproval &&
    (pendingApproval.ticket === plan.ticket || pendingApproval.job_id === plan.ticket);

  const jobTotalDur = (job?.stage_history ?? []).reduce((sum, s) => sum + s.duration_s, 0);
  const jobTok = totalTokens(job);
  const showJobStats = !!job && (!!job.started_at || jobTotalDur > 0);

  function save() {
    updatePlanMd(plan!.id, draft);
    setSaveNote('Saved');
    setTimeout(() => setSaveNote(''), 1800);
  }

  function handleReadyToggle() {
    if (plan!.status === 'ready') {
      setPlanStatus(plan!.id, 'draft');
    } else {
      setPlanStatus(plan!.id, 'ready');
      setView('prd');
    }
  }

  const CONFIRM_WORDS = new Set(['confirm', 'approve', 'approved', 'yes', 'ok', 'proceed']);

  function sendReply() {
    const body = reply.trim();
    if (!body) return;
    sendAgentMessage('factory', body, plan!.ticket);
    setReply('');
    if (isGateForMe && CONFIRM_WORDS.has(body.toLowerCase())) {
      approveGate();
    }
  }

  function saveDocs() {
    setPlanExtraDocs(plan!.id, docs);
    setSaveNote('Docs saved');
    setTimeout(() => setSaveNote(''), 1800);
  }

  function handleDelete() {
    if (confirm(`Delete plan "${plan!.title}"?`)) deletePlan(plan!.id);
  }

  async function handleSubmit() {
    if (dirty) updatePlanMd(plan!.id, draft);
    await submitToFactory(plan!.id);
  }

  return (
    <div className={css.overlay} onClick={(e) => e.target === e.currentTarget && close()}>
      <div className={css.dialog}>
      <div className={css.panel}>
      <div className={css.header}>
        <span className={css.hTicket}>{plan.ticket}</span>
        <span className={css.hTitle}>{plan.title}</span>
        {isConnected && (
          <button className={css.iconBtn} title="Reload PRD from disk" onClick={() => reloadPlanFromDisk(plan.id)}>↻</button>
        )}
        <button className={css.iconBtn} title="Close" onClick={close}>✕</button>
        <button className={css.iconBtn} title="Delete plan" onClick={handleDelete}>🗑</button>
      </div>

      <div className={css.tabs}>
        {(['split', 'edit', 'preview', 'chat', ...(complete ? ['prd' as View] : [])] as View[]).map((v) => (
          <button
            key={v}
            className={`${css.tab}${view === v ? ' ' + css.tabActive : ''}${v === 'prd' ? ' ' + css.tabPrd : ''}`}
            onClick={() => setView(v)}
          >
            {v === 'split' ? 'Split' : v === 'edit' ? 'Edit' : v === 'preview' ? 'Preview' : v === 'chat' ? 'Chat' : '✓ PRD'}
            {v === 'chat' && thread.length > 0 && <span className={css.chatCount}>{thread.length}</span>}
          </button>
        ))}
      </div>

      <div className={css.body}>
        {view === 'edit' && (
          <textarea className={css.editor} value={draft} spellCheck={false} onChange={(e) => setDraft(e.target.value)} />
        )}
        {view === 'preview' && <div className={css.preview}>{renderMarkdown(draft)}</div>}
        {view === 'split' && (
          <div className={css.split}>
            <textarea className={css.editor} value={draft} spellCheck={false} onChange={(e) => setDraft(e.target.value)} />
            <div className={css.preview}>{renderMarkdown(draft)}</div>
          </div>
        )}
        {view === 'chat' && (
          <div className={css.chatWrap}>
            <div className={css.chatFeed} ref={chatRef}>
              {/* Job stats card */}
              {showJobStats && (
                <div className={css.jobStats}>
                  <div className={css.jobStatItem}>
                    <span className={css.jobStatLabel}>Started</span>
                    <span className={css.jobStatValue}>{fmtTs(job!.started_at)}</span>
                  </div>
                  <div className={css.jobStatItem}>
                    <span className={css.jobStatLabel}>Ended</span>
                    <span className={css.jobStatValue}>{job!.completed_at ? fmtTs(job!.completed_at) : '—'}</span>
                  </div>
                  <div className={css.jobStatItem}>
                    <span className={css.jobStatLabel}>Total time</span>
                    <span className={css.jobStatValue}>{jobTotalDur > 0 ? fmtDuration(jobTotalDur) : '—'}</span>
                    {(job!.stage_history?.length ?? 0) > 0 && (
                      <span className={css.jobStatSub}>{job!.stage_history!.length} stages</span>
                    )}
                  </div>
                  <div className={css.jobStatItem}>
                    <span className={css.jobStatLabel}>Tokens</span>
                    <span className={css.jobStatValue}>{fmtTokens(jobTok)}</span>
                  </div>
                </div>
              )}

              {/* Stage timeline — shown whenever the job has history */}
              {job?.stage_history && job.stage_history.length > 0 && (
                <div className={css.stageTimeline}>
                  {(job.stage_history as StageHistoryEntry[]).map((s, i) => (
                    <div key={i} className={`${css.stageTimelineStep} ${css.stageTimelineDone}`}>
                      <div className={css.stageTimelineDot}>✓</div>
                      <div className={css.stageTimelineInfo}>
                        <span className={css.stageTimelineLabel}>{s.stage}</span>
                        <span className={css.stageTimelineDur}>{fmtDuration(s.duration_s)}</span>
                        {s.tokens_used != null && (
                          <span className={css.stageTimelineDur}>{fmtTokens(s.tokens_used)} tok</span>
                        )}
                      </div>
                    </div>
                  ))}
                  {(phase === 'building' || phase === 'gate') && job.stage_label && (
                    <div className={`${css.stageTimelineStep} ${phase === 'gate' ? css.stageTimelineGate : css.stageTimelineActive}`}>
                      <div className={css.stageTimelineDot}>{phase === 'gate' ? '⚠' : '▶'}</div>
                      <div className={css.stageTimelineInfo}>
                        <span className={css.stageTimelineLabel}>{job.stage_label}</span>
                        {phase === 'gate' && <span className={css.stageTimelineNeedsInput}>needs input</span>}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Gate alert bubble — synthesized from pending_approval */}
              {isGateForMe && pendingApproval && (
                <div className={css.gateBubble}>
                  <div className={css.gateBubbleHeader}>
                    <span className={css.gateIcon}>⏸</span>
                    <span>{pendingApproval.gate_title ?? pendingApproval.title ?? 'Review needed'}</span>
                  </div>
                  {pendingApproval.explanation && (
                    <div className={css.gateBubbleBody}>{pendingApproval.explanation}</div>
                  )}
                  {pendingApproval.details && Object.keys(pendingApproval.details).length > 0 && (
                    <div className={css.gateDetails}>
                      {Object.entries(pendingApproval.details)
                        .filter(([, v]) => v != null)
                        .map(([k, v]) => (
                          <div key={k} className={css.gateDetailRow}>
                            <span className={css.gateDetailKey}>{k}:</span>
                            <span className={css.gateDetailVal}>{Array.isArray(v) ? v.join(', ') : String(v)}</span>
                          </div>
                        ))}
                    </div>
                  )}
                  <button className={css.approveBtn} onClick={approveGate} disabled={!isConnected}>
                    ✅ Approve — continue to next stage
                  </button>
                </div>
              )}

              {/* Message thread */}
              {thread.length === 0 && !isGateForMe ? (
                <div className={css.chatEmpty}>
                  No messages yet for {plan.ticket}.<br />
                  Submit to factory to start the pipeline — agent updates will appear here.
                </div>
              ) : (
                thread.map((m, i) => {
                  const mine = m.from === 'pedram';
                  const isConductor = m.from === 'conductor';
                  return (
                    <div key={i} className={`${css.cMsg} ${mine ? css.cMine : css.cCli}`}>
                      <div className={`${css.cBubble} ${mine ? css.cBubbleMine : isConductor ? css.cBubbleConductor : css.cBubbleCli}`}>
                        {m.text}
                      </div>
                      <div className={css.cMeta}>{mine ? `you → ${m.to ?? '?'}` : m.from}{m.ts && ` · ${fmtTime(m.ts)}`}</div>
                    </div>
                  );
                })
              )}
            </div>
            <div className={css.chatComposer}>
              <input
                className={css.chatInput}
                type="text"
                placeholder={!isConnected ? 'Connect repo to reply' : isGateForMe ? 'Type "confirm" to approve gate, or reply…' : 'Reply to factory agent…'}
                value={reply}
                disabled={!isConnected}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') sendReply(); }}
              />
              <button className={css.chatSend} onClick={sendReply} disabled={!isConnected || !reply.trim()}>Send</button>
            </div>
          </div>
        )}
        {view === 'prd' && (
          <div className={css.prdWrap}>
            <div className={css.prdScroll}>
              <div className={css.prdDoc}>{renderMarkdown(plan.md)}</div>

              <div className={css.docsSection}>
                <div className={css.docsHdr}>
                  <span className={css.docsTitle}>📎 Extra documents</span>
                  <span className={css.docsHint}>handed to factory alongside the brief</span>
                  <span className={css.spacer} />
                  <button className={css.saveBtn2} onClick={saveDocs} disabled={!docsDirty}>💾 Save docs</button>
                </div>
                <textarea
                  className={css.docsArea}
                  placeholder="Paste any extra reference docs here — API specs, designs, links, examples… Saved with the plan and sent to factory on Submit."
                  value={docs}
                  spellCheck={false}
                  onChange={(e) => setDocs(e.target.value)}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className={css.footer}>
        <label className={css.readyToggle} title="Mark the brief ready before submitting to factory">
          <span className={`${css.switch}${complete ? ' ' + css.switchOn : ''}`} onClick={handleReadyToggle}>
            <span className={css.knob} />
          </span>
          {complete ? 'Brief ready' : 'Mark ready'}
        </label>

        <button className={css.saveBtn2} onClick={save} disabled={!dirty}>💾 Save</button>
        {saveNote && <span className={css.saveNote}>{saveNote}</span>}

        <div className={css.spacer} />

        {jobDone ? (
          <span className={css.brainstorming}>✓ done</span>
        ) : phase === 'gate' ? (
          <span className={css.gateStatus}>⚠ Needs your input — check Chat tab</span>
        ) : phase === 'building' ? (
          <span className={css.brainstorming}>⚙ {job?.stage_label ?? 'Factory building…'}</span>
        ) : phase === 'submitted' ? (
          <span className={css.brainstorming}>⏳ Submitted — factory running</span>
        ) : (
          <button
            className={css.startBtn}
            onClick={handleSubmit}
            disabled={!isConnected}
            title={!isConnected ? 'Connect repo first' : 'Submit brief to factory inbox'}
          >
            📤 Submit to Factory
          </button>
        )}
      </div>
    </div>
    </div>
    </div>
  );
}
