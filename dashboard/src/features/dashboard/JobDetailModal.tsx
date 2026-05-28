import { useState, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import type { Job, PendingApproval, PendingQuestion, AgentData } from '../../api/types';
import styles from './JobDetailModal.module.css';

// ── Pipeline stages (13-agent factory pipeline) ──────────────────────────────
const STAGES = [
  { key: 'reframe',      label: 'Reframe',  emoji: '🔍' },
  { key: 'question',     label: 'Q&A',      emoji: '❓' },
  { key: 'research',     label: 'Research', emoji: '📚' },
  { key: 'design',       label: 'Design',   emoji: '🎨' },
  { key: 'plan',         label: 'Plan',     emoji: '📋' },
  { key: 'frontend',     label: 'Frontend', emoji: '⚛'  },
  { key: 'backend',      label: 'Backend',  emoji: '⚙'  },
  { key: 'test-writer',  label: 'Tests',    emoji: '🧪', gate: true },
  { key: 'reviewer',     label: 'Review',   emoji: '🔬' },
  { key: 'tech-writer',  label: 'Docs',     emoji: '📝' },
  { key: 'merged',       label: 'Merged',   emoji: '✓'  },
];

function stageIdx(label: string) {
  const l = (label ?? '').toLowerCase();
  if (l === 'merged' || l === 'done' || l === 'shipped') return 10;
  if (l.includes('tech-writer') || l.includes('tech_writer')) return 9;
  if (l.includes('review')) return 8;
  if (l.includes('test')) return 7;
  if (l.includes('backend') || l.includes('api')) return 6;
  if (l.includes('frontend') || l.includes('front') || l.includes('ui')) return 5;
  if (l.includes('plan') || l.includes('integrat')) return 4;
  if (l.includes('design') || l.includes('critic')) return 3;
  if (l.includes('research')) return 2;
  if (l.includes('question')) return 1;
  if (l.includes('reframe') || l.includes('brief') || l.includes('queued')) return 0;
  return -1;
}

function fmtDur(s: number) {
  if (!s || s < 0) return '';
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
}

function elapsed(from: string | null | undefined) {
  if (!from) return null;
  const s = Math.floor((Date.now() - new Date(from).getTime()) / 1000);
  return fmtDur(s);
}

const STATUS_LABEL: Record<string, string> = {
  planned: 'Planned', 'plan-ready': 'Ready', queued: 'Queued',
  building: 'Building', paused: 'Awaiting', done: 'Merged',
  merged: 'Merged', shipped: 'Merged', failed: 'Failed',
};
const STATUS_CLS: Record<string, string> = {
  planned: 'st-planned', 'plan-ready': 'st-plan-ready', queued: 'st-queued',
  building: 'st-building', paused: 'st-paused', done: 'st-done',
  merged: 'st-done', shipped: 'st-done', failed: 'st-failed',
};
const GATE_ICON: Record<string, string> = { pass: '✅', warn: '⚠', fail: '❌' };

// ── Pipeline bar ─────────────────────────────────────────────────────────────
function PipelineBar({ job }: { job: Job }) {
  const isDone = ['done', 'merged', 'shipped'].includes(job.status);
  const cur = isDone ? STAGES.length - 1 : stageIdx(job.stage_label ?? job.status);
  return (
    <div className={styles.pipeline}>
      {STAGES.map((s, i) => {
        const done = i < cur || isDone;
        const active = i === cur && !isDone;
        return (
          <div key={s.key} className={styles.pipelineGroup}>
            <div className={`${styles.node}${s.gate ? ' ' + styles.gateNode : ''}${active ? ' ' + styles.activeNode : ''}${done ? ' ' + styles.doneNode : ''}`}>
              <span className={styles.nodeEmoji}>{s.emoji}</span>
              <span className={styles.nodeLabel}>{s.label}</span>
            </div>
            {i < STAGES.length - 1 && (
              <div className={`${styles.arrow}${done ? ' ' + styles.arrowDone : ''}`}>›</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Approval section ─────────────────────────────────────────────────────────
function ApprovalSection({ approval, onSend, busy }: {
  approval: PendingApproval;
  onSend: (v: string) => void;
  busy: boolean;
}) {
  const items     = approval.items ?? [];
  const failCount = items.filter((i) => i.status === 'fail').length;
  const warnCount = items.filter((i) => i.status === 'warn').length;
  const allPass   = failCount === 0 && warnCount === 0;

  return (
    <div className={`${styles.section} ${styles.gateSection}`}>
      <div className={styles.sectionTitle}>
        <span className={styles.gatePulse} />
        Pending Gate — {approval.gate_title ?? approval.stage}
      </div>
      <p className={styles.gateSummary}>{approval.summary ?? approval.title}</p>

      {items.length > 0 && (
        <div className={styles.checklist}>
          {items.map((item, i) => (
            <div key={i} className={`${styles.checkItem} ${styles['check_' + item.status]}`}>
              <span>{GATE_ICON[item.status]}</span>
              <div>
                <div className={styles.checkLabel}>{item.label}</div>
                {item.detail && <div className={styles.checkDetail}>{item.detail}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {approval.explanation && (
        <p className={styles.explanation}>{approval.explanation}</p>
      )}

      <div className={styles.gateActions}>
        {allPass && (
          <div className={styles.autoNote}>
            All checks passed — pipeline can continue automatically
          </div>
        )}
        <div className={styles.gateBtns}>
          <button
            className={`${styles.approveBtn}${failCount > 0 ? ' ' + styles.approveBtnBlocked : ''}`}
            disabled={busy || failCount > 0}
            onClick={() => onSend('approve')}
          >
            {failCount > 0
              ? `🚫 ${failCount} check${failCount > 1 ? 's' : ''} failed`
              : approval.approve_label ?? '✅ Approve — Continue Pipeline'}
          </button>
          <button className={styles.rejectBtn} disabled={busy} onClick={() => onSend('reject')}>
            ✕ Reject
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Question section ─────────────────────────────────────────────────────────
function QuestionSection({ question, onSend, busy }: {
  question: PendingQuestion;
  onSend: (v: string) => void;
  busy: boolean;
}) {
  const [freeText, setFreeText] = useState('');
  return (
    <div className={`${styles.section} ${styles.gateSection}`}>
      <div className={styles.sectionTitle}>
        <span className={styles.gatePulse} />
        Decision Needed
      </div>
      <p className={styles.question}>{question.question}</p>
      {question.why_asking && (
        <p className={styles.whyAsking}>Why: {question.why_asking}</p>
      )}
      {question.options && question.options.length > 0 && (
        <div className={styles.options}>
          {question.options.map((opt) => (
            <button key={opt.value} className={styles.optionBtn} disabled={busy} onClick={() => onSend(opt.value)}>
              {opt.label}
            </button>
          ))}
        </div>
      )}
      {question.allow_free_text && (
        <div className={styles.freeTextWrap}>
          <textarea
            className="arbiter-textarea"
            rows={2}
            placeholder="Type your answer…"
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
          />
          <button className={styles.approveBtn} disabled={busy || !freeText.trim()} onClick={() => onSend(freeText)}>
            Send Answer
          </button>
        </div>
      )}
    </div>
  );
}

// ── Agent emoji map ───────────────────────────────────────────────────────────
const AGENT_EMOJI: Record<string, string> = {
  reframe: '🔍', question: '❓', research: '📚', design: '🎨',
  'design-critic': '🧐', integrator: '🔌', plan: '📋', frontend: '⚛',
  backend: '⚙', 'test-writer': '🧪', reviewer: '🔬', debugger: '🐛',
  'tech-writer': '📝', surveyor: '🗺',
};

function timeSince(iso: string | undefined) {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

// ── Live agents section ───────────────────────────────────────────────────────
function LiveAgentsSection({ ticket, agents }: { ticket: string; agents: Record<string, AgentData> }) {
  const working = Object.entries(agents).filter(
    ([, d]) => d.status === 'working' && (d.task === ticket || !d.task)
  );
  if (working.length === 0) return null;

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>
        <span className={styles.livePulse} /> Live Agent Activity
      </div>
      <div className={styles.agentList}>
        {working.map(([key, d]) => (
          <div key={key} className={styles.agentRow}>
            <span className={styles.agentEmoji}>{AGENT_EMOJI[key] ?? '🤖'}</span>
            <div className={styles.agentInfo}>
              <span className={styles.agentKey}>{key}</span>
              {d.phase && <span className={styles.agentPhase}>{d.phase}</span>}
            </div>
            {d.started_at && (
              <span className={styles.agentTimer}>{timeSince(d.started_at)}</span>
            )}
            <span className={styles.agentDot} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Spec viewer / editor ──────────────────────────────────────────────────────
function SpecSection({ ticket, isActive }: { ticket: string; isActive: boolean }) {
  const { readRepoFile, isConnected } = useAppStore(useShallow((s) => ({
    readRepoFile: s.readRepoFile,
    isConnected:  s.isConnected,
  })));

  const [open, setOpen]       = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !isConnected) return;
    setLoading(true);
    // Try active folder first, then inbox
    const paths = [
      `compliance/exec-plan/02-active/${ticket}/spec.md`,
      `compliance/exec-plan/01-inbox/${ticket}.md`,
      `.arbiter/plans/${ticket}.md`,
    ];
    (async () => {
      for (const p of paths) {
        const txt = await readRepoFile(p);
        if (txt !== null) { setContent(txt); break; }
      }
      setLoading(false);
    })();
  }, [open, isConnected, ticket, readRepoFile]);

  if (!isConnected) return null;

  return (
    <div className={styles.section}>
      <button className={styles.specToggle} onClick={() => setOpen((v) => !v)}>
        <span>📄 {isActive ? 'Task spec' : 'Brief'}</span>
        <span className={styles.toggleCaret}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className={styles.specBody}>
          {loading && <div className={styles.specLoading}>Reading from repo…</div>}
          {!loading && content === null && (
            <div className={styles.specMissing}>
              Spec not found yet — it will appear once the conductor picks up the task.
            </div>
          )}
          {!loading && content !== null && (
            <pre className={styles.specContent}>{content}</pre>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────
export function JobDetailModal() {
  const { arbiterState, agents, plans, messages, jobDetailId, closeJobDetail, liveApi, showToast, dismissedGateIds, dismissGate, importJobAsPlan, selectPlan, sendAgentMessage } = useAppStore(useShallow((s) => ({
    arbiterState: s.arbiterState,
    agents:      s.agentData,
    plans:       s.plans,
    messages:    s.messages,
    jobDetailId: s.jobDetailId,
    closeJobDetail: s.closeJobDetail,
    liveApi:     s.liveApi,
    showToast:   s.showToast,
    dismissedGateIds: s.dismissedGateIds,
    dismissGate: s.dismissGate,
    importJobAsPlan: s.importJobAsPlan,
    selectPlan:  s.selectPlan,
    sendAgentMessage: s.sendAgentMessage,
  })));

  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState('');

  if (!jobDetailId) return null;

  const job = arbiterState.jobs.find((j) => j.id === jobDetailId);
  if (!job) return null;

  const rawApproval = arbiterState.pending_approval?.job_id === jobDetailId ? arbiterState.pending_approval : null;
  const rawQuestion = arbiterState.question?.job_id          === jobDetailId ? arbiterState.question          : null;
  const approval  = rawApproval && !dismissedGateIds.includes(rawApproval.id) ? rawApproval : null;
  const question  = rawQuestion && !dismissedGateIds.includes(rawQuestion.id) ? rawQuestion : null;
  const isDone    = ['done', 'merged', 'shipped'].includes(job.status);
  const ticket    = job.ticket ?? job.id;
  const matchedPlan = plans.find((p) => p.ticket === ticket);
  const inPlans   = !!matchedPlan;
  const history   = job.stage_history ?? [];

  const thread = [...messages].filter((m) => m.ticket === ticket).sort((a, b) => (a.ts < b.ts ? -1 : 1));
  const replyTarget = 'factory';

  const handleImport = async () => {
    await importJobAsPlan(job.id);
    closeJobDetail();
  };

  const handleReply = () => {
    const body = reply.trim();
    if (!body) return;
    sendAgentMessage(replyTarget, body, ticket);
    setReply('');
  };
  const reworks   = job.rework_history ?? [];
  const elapsed_  = elapsed(job.started_at);
  const totalDur  = job.started_at && job.completed_at
    ? fmtDur(Math.floor((new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()) / 1000))
    : null;

  const sendResponse = async (value: string) => {
    const id = approval?.id ?? question?.id ?? 'unknown';
    setBusy(true);
    try {
      if (liveApi) await liveApi.writeResponse(id, value);
      showToast(liveApi ? 'Response sent — pipeline continuing' : 'Dismissed (not connected)');
    } catch {
      showToast('Failed to write response — dismissed locally');
    } finally {
      setBusy(false);
      dismissGate(id);   // keep the gate closed across polls + other modals
      closeJobDetail();
    }
  };

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && closeJobDetail()}>
      <div className={styles.modal}>

        {/* ── Header ── */}
        <div className={styles.modalHdr}>
          <div className={styles.hdrLeft}>
            <span className={`status-badge ${STATUS_CLS[job.status] ?? ''}`}>{STATUS_LABEL[job.status] ?? job.status}</span>
            {job.ticket && <span className={styles.ticket}>{job.ticket}</span>}
            <span className={styles.jobTitle}>{job.title}</span>
          </div>
          <div className={styles.hdrRight}>
            {elapsed_ && !isDone && <span className={styles.meta}>started {elapsed_} ago</span>}
            {totalDur && isDone && <span className={styles.meta}>⏱ {totalDur}</span>}
            {isDone && job.pr_url && (
              <a className={styles.prLink} href={job.pr_url} target="_blank" rel="noopener">Open PR ↗</a>
            )}
            {inPlans ? (
              <button
                className={styles.importBtn}
                onClick={() => { selectPlan(plans.find((p) => p.ticket === (job.ticket ?? job.id))!.id); closeJobDetail(); }}
              >
                ↗ Open in Plans
              </button>
            ) : (
              <button className={styles.importBtn} onClick={handleImport}>↓ Add to Plans</button>
            )}
            <button className={styles.closeBtn} onClick={closeJobDetail}>✕</button>
          </div>
        </div>

        <div className={styles.body}>

          {/* ── Pipeline ── */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Pipeline</div>
            <PipelineBar job={job} />
          </div>

          {/* ── Pending gate / question — shown prominently at top ── */}
          {approval  && <ApprovalSection  approval={approval}  onSend={sendResponse} busy={busy} />}
          {question  && <QuestionSection  question={question}  onSend={sendResponse} busy={busy} />}

          {/* ── Live agent activity (while building) ── */}
          {!isDone && <LiveAgentsSection ticket={ticket} agents={agents} />}

          {/* ── Task spec / brief ── */}
          <SpecSection ticket={ticket} isActive={!isDone && job.status !== 'planned' && job.status !== 'plan-ready'} />

          {/* ── Conversation with the CLI working this ticket ── */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Conversation · {replyTarget}</div>
            <div className={styles.chatFeed}>
              {thread.length === 0 ? (
                <div className={styles.chatEmpty}>No messages yet for {ticket}.</div>
              ) : (
                thread.map((m, i) => {
                  const mine = m.from === 'pedram';
                  return (
                    <div key={i} className={`${styles.chatMsg} ${mine ? styles.chatMine : styles.chatCli}`}>
                      <div className={`${styles.chatBubble} ${mine ? styles.chatBubbleMine : styles.chatBubbleCli}`}>{m.text}</div>
                      <div className={styles.chatMeta}>{mine ? `you → ${m.to ?? '?'}` : m.from}</div>
                    </div>
                  );
                })
              )}
            </div>
            <div className={styles.chatComposer}>
              <input
                className={styles.chatInput}
                type="text"
                placeholder={liveApi ? `Message ${replyTarget}…` : 'Connect repo to message'}
                value={reply}
                disabled={!liveApi}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleReply(); }}
              />
              <button className={styles.chatSend} onClick={handleReply} disabled={!liveApi || !reply.trim()}>Send</button>
            </div>
          </div>

          {/* ── Stage history ── */}
          {history.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionTitle}>Stage History</div>
              <div className={styles.histList}>
                {history.map((h, i) => (
                  <div key={i} className={styles.histRow}>
                    <span className={styles.histStage}>{h.stage}</span>
                    <span className={styles.histDur}>{fmtDur(h.duration_s) || '—'}</span>
                    <span className={`${styles.histOutcome} ${h.outcome === 'pass' ? styles.outcomePass : h.outcome === 'rework' ? styles.outcomeRework : styles.outcomeFail}`}>
                      {h.outcome}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Rework log ── */}
          {reworks.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionTitle}>Rework Log</div>
              <div className={styles.reworkList}>
                {reworks.map((r, i) => (
                  <div key={i} className={styles.reworkRow}>
                    <span className={styles.reworkTag}>↩ sent back</span>
                    <span className={styles.reworkStage}>{r.to_stage}</span>
                    <span className={styles.reworkReason}>{r.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Requirements (if any) ── */}
          {job.requirements && (
            <div className={styles.section}>
              <div className={styles.sectionTitle}>Requirements</div>
              <p className={styles.reqText}>{job.requirements}</p>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
