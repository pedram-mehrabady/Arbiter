import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { DEFAULT_FLOW } from './flow';
import css from './TaskDetailModal.module.css';

interface Props { taskId: string; onClose: () => void; }
interface ChatMsg { role: 'user' | 'assistant'; content: string; }

// Step artifacts we try to load for a task (agent → output file), in flow order.
const ARTIFACTS: Array<{ label: string; file: string }> = [
  { label: 'PRD / Task', file: 'task.md' },
  ...DEFAULT_FLOW.flatMap((l) => l.agents.map((a) => ({ label: a.label, file: `${a.id}-output.md` }))),
];

type UsageRow = { agent_role?: string; model?: string; input_tokens?: number; output_tokens?: number; context_tokens?: number; cost_usd?: number; ts?: string };

function fmtNum(n: number): string { return n.toLocaleString(); }
function fmtDuration(ms: number): string {
  if (ms <= 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60); return `${m}m ${s % 60}s`;
}

function renderLog(usage: UsageRow[]) {
  const sum = (f: (r: UsageRow) => number) => usage.reduce((a, r) => a + f(r), 0);
  const totalTokens = sum(r => (r.input_tokens ?? 0) + (r.output_tokens ?? 0));
  const totalCtx = sum(r => r.context_tokens ?? 0);
  const totalCost = sum(r => r.cost_usd ?? 0);
  const times = usage.map(r => (r.ts ? Date.parse(r.ts) : NaN)).filter(n => !Number.isNaN(n));
  const duration = times.length >= 2 ? Math.max(...times) - Math.min(...times) : 0;
  return (
    <div className={css.log}>
      <div className={css.logTotals}>
        <span><strong>{usage.length}</strong> steps</span>
        <span><strong>{fmtDuration(duration)}</strong> total</span>
        <span><strong>{fmtNum(totalTokens)}</strong> tokens</span>
        <span><strong>{fmtNum(totalCtx)}</strong> context</span>
        <span><strong>${totalCost.toFixed(4)}</strong></span>
      </div>
      <table className={css.logTable}>
        <thead><tr><th>Step</th><th>Model</th><th>Tokens</th><th>Context</th><th>Cost</th></tr></thead>
        <tbody>
          {usage.map((r, i) => (
            <tr key={i}>
              <td>{r.agent_role ?? '—'}</td>
              <td className={css.logModel}>{(r.model ?? '').replace('claude-', '')}</td>
              <td>{fmtNum((r.input_tokens ?? 0) + (r.output_tokens ?? 0))}</td>
              <td>{fmtNum(r.context_tokens ?? 0)}</td>
              <td>${(r.cost_usd ?? 0).toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TaskDetailModal({ taskId, onClose }: Props) {
  const { liveApi, settings } = useAppStore((s) => ({ liveApi: s.liveApi, settings: s.settings }));
  const [docs, setDocs] = useState<Array<{ label: string; content: string }>>([]);
  const [activeDoc, setActiveDoc] = useState(0);
  const [showLog, setShowLog] = useState(false);
  const [usage, setUsage] = useState<Array<{ agent_role?: string; model?: string; input_tokens?: number; output_tokens?: number; context_tokens?: number; cost_usd?: number; ts?: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const api = liveApi as unknown as { readRepoFile?: (p: string) => Promise<string | null>; readUsageForTask?: (id: string) => Promise<typeof usage> } | null;
      const found: Array<{ label: string; content: string }> = [];
      for (const a of ARTIFACTS) {
        const content = api?.readRepoFile ? await api.readRepoFile(`arbiter/tasks/${taskId}/${a.file}`) : null;
        if (content) found.push({ label: a.label, content });
      }
      const u = api?.readUsageForTask ? await api.readUsageForTask(taskId) : [];
      if (alive) { setDocs(found); setUsage(u); setLoading(false); }
    })();
    return () => { alive = false; };
  }, [taskId, liveApi]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy) return;
    const provider = settings.assistantProvider;
    if (!provider) { setMessages((m) => [...m, { role: 'assistant', content: 'Set an assistant provider + API key in Settings to chat.' }]); return; }
    const doc = docs[activeDoc];
    const system = [
      `You are discussing task ${taskId} in an AI dev pipeline, specifically its "${doc?.label ?? 'task'}".`,
      `Help refine or adjust it. Here is the current content:`,
      '',
      (doc?.content ?? '').slice(0, 6000),
    ].join('\n');
    setMessages((m) => [...m, { role: 'user', content: text }]);
    setDraft(''); setBusy(true);
    try {
      const res = await fetch('/api/run-assistant', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model: settings.assistantModel || 'claude-opus-4-7', apiKey: settings.anthropicApiKey || undefined,
          messages: [{ role: 'user', content: system }, { role: 'user', content: text }] }),
      });
      const data = await res.json() as { ok: boolean; reply?: string; error?: string };
      setMessages((m) => [...m, { role: 'assistant', content: data.ok ? (data.reply ?? '') : `Error: ${data.error}` }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: `Chat unavailable: ${(e as Error).message}` }]);
    } finally { setBusy(false); }
  }, [draft, busy, settings, docs, activeDoc, taskId]);

  return (
    <div className={css.overlay} onClick={onClose}>
      <div className={css.modal} onClick={(e) => e.stopPropagation()}>
        <header className={css.head}>
          <h3>{taskId}</h3>
          <button className={css.close} onClick={onClose}>✕</button>
        </header>
        <div className={css.body}>
          <div className={css.docPane}>
            {loading ? <div className={css.dim}>Loading…</div> : (
              <>
                <div className={css.tabs}>
                  {docs.map((d, i) => (
                    <button key={d.label} className={`${css.docTab} ${!showLog && i === activeDoc ? css.docTabActive : ''}`} onClick={() => { setShowLog(false); setActiveDoc(i); }}>{d.label}</button>
                  ))}
                  {usage.length > 0 && (
                    <button className={`${css.docTab} ${showLog ? css.docTabActive : ''}`} onClick={() => setShowLog(true)}>📊 Log</button>
                  )}
                </div>
                {showLog ? renderLog(usage) : docs.length === 0
                  ? <div className={css.dim}>No artifacts yet for this task.</div>
                  : <pre className={css.docContent}>{docs[activeDoc]?.content}</pre>}
              </>
            )}
          </div>
          <div className={css.chatPane}>
            <div className={css.chatLog}>
              {messages.length === 0 && <div className={css.dim}>Ask the AI to refine or adjust this step…</div>}
              {messages.map((m, i) => (
                <div key={i} className={m.role === 'user' ? css.userMsg : css.aiMsg}>{m.content}</div>
              ))}
              {busy && <div className={css.aiMsg}>…</div>}
              <div ref={bottomRef} />
            </div>
            <div className={css.chatInput}>
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
                placeholder="Discuss this step…" rows={2} />
              <button onClick={() => void send()} disabled={busy}>Send</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
