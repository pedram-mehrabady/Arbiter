import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { DEFAULT_FLOW } from './flow';
import css from './TaskDetailModal.module.css';

interface Props { taskId: string; subtitle?: string; onClose: () => void; }
interface ChatMsg { role: 'user' | 'assistant'; content: string; ts?: string }
type UsageRow = { agent_role?: string; model?: string; input_tokens?: number; output_tokens?: number; context_tokens?: number; cost_usd?: number; ts?: string };

// Artifacts we try to load (agent → output file), in flow order. task.md is the PRD.
const ARTIFACTS: Array<{ label: string; file: string }> = [
  { label: 'PRD', file: 'task.md' },
  ...DEFAULT_FLOW.flatMap((l) => l.agents.map((a) => ({ label: a.label, file: `${a.id}-output.md` }))),
];

function fmtNum(n: number): string { return n.toLocaleString(); }
function fmtDuration(ms: number): string {
  if (ms <= 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60); return `${m}m ${s % 60}s`;
}

function LogView({ usage }: { usage: UsageRow[] }) {
  const sum = (f: (r: UsageRow) => number) => usage.reduce((a, r) => a + f(r), 0);
  const totalTokens = sum(r => (r.input_tokens ?? 0) + (r.output_tokens ?? 0));
  const totalCtx = sum(r => r.context_tokens ?? 0);
  const totalCost = sum(r => r.cost_usd ?? 0);
  const times = usage.map(r => (r.ts ? Date.parse(r.ts) : NaN)).filter(n => !Number.isNaN(n));
  const duration = times.length >= 2 ? Math.max(...times) - Math.min(...times) : 0;
  if (usage.length === 0) return <div className={css.dim}>No run history yet — this task hasn’t executed any steps.</div>;
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

export function TaskDetailModal({ taskId, subtitle, onClose }: Props) {
  const { liveApi, settings } = useAppStore(useShallow((s) => ({ liveApi: s.liveApi, settings: s.settings })));
  const api = liveApi as unknown as {
    readRepoFile?: (p: string) => Promise<string | null>;
    writeRepoFile?: (p: string, c: string) => Promise<void>;
    readUsageForTask?: (id: string) => Promise<UsageRow[]>;
  } | null;

  const [docs, setDocs] = useState<Array<{ label: string; content: string }>>([]);
  const [tab, setTab] = useState<string>('PRD');       // doc label, or 'LOG'
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // ── Load everything: artifacts, usage log, persisted chat history ──────────
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const found: Array<{ label: string; content: string }> = [];
      for (const a of ARTIFACTS) {
        const content = api?.readRepoFile ? await api.readRepoFile(`arbiter/tasks/${taskId}/${a.file}`) : null;
        if (content) found.push({ label: a.label, content });
      }
      const u = api?.readUsageForTask ? await api.readUsageForTask(taskId) : [];
      const chatRaw = api?.readRepoFile ? await api.readRepoFile(`arbiter/tasks/${taskId}/chat.jsonl`) : null;
      const chat: ChatMsg[] = chatRaw
        ? chatRaw.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) as ChatMsg[]
        : [];
      if (alive) {
        setDocs(found);
        setUsage(u);
        setMessages(chat);
        setTab(found[0]?.label ?? 'PRD');
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [taskId, liveApi]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const activeDoc = docs.find(d => d.label === tab);

  const persistChat = useCallback(async (msgs: ChatMsg[]) => {
    if (!api?.writeRepoFile) return;
    try { await api.writeRepoFile(`arbiter/tasks/${taskId}/chat.jsonl`, msgs.map(m => JSON.stringify(m)).join('\n') + '\n'); } catch { /* best-effort */ }
  }, [api, taskId]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy) return;
    const provider = settings.assistantProvider;
    const userMsg: ChatMsg = { role: 'user', content: text, ts: new Date().toISOString() };
    const next = [...messages, userMsg];
    setMessages(next); setDraft(''); setBusy(true);
    void persistChat(next);

    if (!provider) {
      const m = [...next, { role: 'assistant' as const, content: 'Set an assistant provider + API key in Settings to chat here.' }];
      setMessages(m); setBusy(false); void persistChat(m); return;
    }
    const ctx = tab === 'LOG' ? '(run log)' : (activeDoc?.content ?? '');
    const system = [
      `You are working on task ${taskId} in an AI dev pipeline, currently its "${tab}".`,
      `Help the user refine or adjust it. Be concise and concrete.`,
      `Current content:\n\n${ctx.slice(0, 6000)}`,
    ].join('\n');
    try {
      const res = await fetch('/api/run-assistant', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model: settings.assistantModel || 'claude-opus-4-7', apiKey: settings.anthropicApiKey || undefined,
          messages: [{ role: 'user', content: system }, ...next.map(m => ({ role: m.role, content: m.content }))] }),
      });
      const data = await res.json() as { ok: boolean; reply?: string; error?: string };
      const m = [...next, { role: 'assistant' as const, content: data.ok ? (data.reply ?? '') : `Error: ${data.error}`, ts: new Date().toISOString() }];
      setMessages(m); void persistChat(m);
    } catch (e) {
      const m = [...next, { role: 'assistant' as const, content: `Chat unavailable: ${(e as Error).message}` }];
      setMessages(m); void persistChat(m);
    } finally { setBusy(false); }
  }, [draft, busy, settings, messages, tab, activeDoc, taskId, persistChat]);

  return (
    <div className={css.overlay} onClick={onClose}>
      <div className={css.modal} onClick={(e) => e.stopPropagation()}>
        <header className={css.head}>
          <div>
            <h3>{taskId}</h3>
            {subtitle && <span className={css.subtitle}>{subtitle}</span>}
          </div>
          <button className={css.close} onClick={onClose}>✕</button>
        </header>
        <div className={css.body}>
          <div className={css.docPane}>
            {loading ? <div className={css.dim}>Loading…</div> : (
              <>
                <div className={css.tabs}>
                  {docs.map((d) => (
                    <button key={d.label} className={`${css.docTab} ${tab === d.label ? css.docTabActive : ''}`} onClick={() => setTab(d.label)}>{d.label}</button>
                  ))}
                  <button className={`${css.docTab} ${tab === 'LOG' ? css.docTabActive : ''}`} onClick={() => setTab('LOG')}>📊 Log</button>
                </div>
                {tab === 'LOG'
                  ? <LogView usage={usage} />
                  : docs.length === 0
                    ? <div className={css.dim}>No artifacts yet — this task hasn’t produced any step outputs.</div>
                    : <pre className={css.docContent}>{activeDoc?.content}</pre>}
              </>
            )}
          </div>
          <div className={css.chatPane}>
            <div className={css.chatHead}>Chat — {tab === 'LOG' ? 'this task' : tab}</div>
            <div className={css.chatLog}>
              {messages.length === 0 && <div className={css.dim}>Discuss or refine this step with the AI. History is saved with the task.</div>}
              {messages.map((m, i) => (
                <div key={i} className={m.role === 'user' ? css.userMsg : css.aiMsg}>{m.content}</div>
              ))}
              {busy && <div className={css.aiMsg}>…</div>}
              <div ref={bottomRef} />
            </div>
            <div className={css.chatInput}>
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
                placeholder="Message the AI about this step…" rows={2} />
              <button onClick={() => void send()} disabled={busy}>Send</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
