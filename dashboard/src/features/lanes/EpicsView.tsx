import { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import css from './EpicsView.module.css';

function Bar({ pct }: { pct: number }) {
  return <div className={css.bar}><div className={css.barFill} style={{ width: `${pct}%` }} /></div>;
}

export function EpicsView() {
  const { epics, createEpic, isConnected } = useAppStore(useShallow((s) => ({
    epics: s.epics, createEpic: s.createEpic, isConnected: s.isConnected,
  })));
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [doc, setDoc] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());

  const submit = async () => {
    if (!title.trim()) return;
    await createEpic(title, doc || title);
    setTitle(''); setDoc(''); setCreating(false);
  };
  const toggle = (id: string) => setOpen((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className={css.wrap}>
      <div className={css.head}>
        <h2 className={css.h2}>Epics</h2>
        <button className={css.newBtn} onClick={() => setCreating((c) => !c)} disabled={!isConnected}>+ New Epic</button>
      </div>

      {creating && (
        <div className={css.createForm}>
          <input className={css.input} autoFocus placeholder="Epic title (the big idea)…" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className={css.area} rows={8} placeholder="Paste the brief / idea (use ## headings — each section becomes a Story)…" value={doc} onChange={(e) => setDoc(e.target.value)} />
          <div className={css.actions}>
            <button className={css.createBtn} onClick={() => void submit()}>Create &amp; decompose</button>
            <button className={css.cancelBtn} onClick={() => setCreating(false)}>Cancel</button>
          </div>
          <div className={css.hint}>The factory daemon decomposes it into Stories + Tasks (run <code>arbiter factory</code>).</div>
        </div>
      )}

      {epics.length === 0 && !creating && (
        <div className={css.empty}>No epics yet. Create one from a brief — it’s decomposed into Stories (doc sections) and Tasks that flow through the lanes.</div>
      )}

      {epics.map((e) => (
        <div key={e.id} className={css.epic}>
          <div className={css.epicHead} onClick={() => toggle(e.id)}>
            <span className={css.caret}>{open.has(e.id) ? '▾' : '▸'}</span>
            <span className={css.epicTitle}>{e.title}</span>
            <span className={css.epicId}>{e.id}</span>
            <span className={css.pct}>{e.done}/{e.total} · {e.pct}%</span>
            <div className={css.epicBar}><Bar pct={e.pct} /></div>
          </div>
          {open.has(e.id) && (
            <div className={css.stories}>
              {e.stories.length === 0 && <div className={css.dim}>Not decomposed yet — the daemon will split it into stories.</div>}
              {e.stories.map((s) => (
                <div key={s.id} className={css.story}>
                  <span className={css.storyTitle}>{s.title}</span>
                  <span className={css.storyPct}>{s.done}/{s.total} · {s.pct}%</span>
                  <div className={css.storyBar}><Bar pct={s.pct} /></div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
