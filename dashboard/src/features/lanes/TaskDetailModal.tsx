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

export function TaskDetailModal({ taskId, onClose }: Props) {
  const { liveApi, settings } = useAppStore((s) => ({ liveApi: s.liveApi, settings: s.settings }));
  const [docs, setDocs] = useState<Array<{ label: string; content: string }>>([]);
  const [activeDoc, setActiveDoc] = useState(0);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const api = liveApi as unknown as { readRepoFile?: (p: string) => Promise<string | null> } | null;
      const found: Array<{ label: string; content: string }> = [];
      for (const a of ARTIFACTS) {
        const content = api?.readRepoFile ? await api.readRepoFile(`arbiter/tasks/${taskId}/${a.file}`) : null;
        if (content) found.push({ label: a.label, content });
      }
      if (alive) { setDocs(found); setLoading(false); }
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
            {loading ? <div className={css.dim}>Loading artifacts…</div> : docs.length === 0 ? (
              <div className={css.dim}>No artifacts yet for this task.</div>
            ) : (
              <>
                <div className={css.tabs}>
                  {docs.map((d, i) => (
                    <button key={d.label} className={`${css.docTab} ${i === activeDoc ? css.docTabActive : ''}`} onClick={() => setActiveDoc(i)}>{d.label}</button>
                  ))}
                </div>
                <pre className={css.docContent}>{docs[activeDoc]?.content}</pre>
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
