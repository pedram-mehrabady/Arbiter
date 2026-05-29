import { useState, useRef } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { DEFAULT_FLOW, type CardLifecycle, type LaneCard } from './flow';
import { TaskDetailModal } from './TaskDetailModal';
import css from './LanesView.module.css';

const LIFECYCLE_LABEL: Record<CardLifecycle, string> = {
  queued: 'queued',
  running: 'running',
  'needs-gate': 'needs gate',
  done: 'done',
};

export function LanesView() {
  const { laneCards, isConnected, createBrainstormTask, resolveEngineGate, promoteTask, showToast } = useAppStore(useShallow((s) => ({
    laneCards: s.laneCards,
    isConnected: s.isConnected,
    createBrainstormTask: s.createBrainstormTask,
    resolveEngineGate: s.resolveEngineGate,
    promoteTask: s.promoteTask,
    showToast: s.showToast,
  })));

  const [openTask, setOpenTask] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newIdea, setNewIdea] = useState('');
  const [attachment, setAttachment] = useState<{ name: string; content: string } | null>(null);
  const [dragged, setDragged] = useState<LaneCard | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const downPos = useRef<{ x: number; y: number } | null>(null);

  const onDropLane = (targetLaneId: string) => {
    const card = dragged;
    setDragged(null); setDragOver(null);
    if (!card) return;
    const targetIdx = DEFAULT_FLOW.findIndex((l) => l.id === targetLaneId);
    if (targetIdx <= card.laneIndex) { showToast('Drag a card forward to advance it'); return; }
    if (card.gateId) {
      void resolveEngineGate(card.gateId, 'approved'); // approving the gate advances the running pipeline
    } else if (card.laneId === 'brainstorm') {
      void promoteTask(card.taskId); // hand the cooked idea to the factory daemon
    } else {
      showToast('This task advances automatically — no gate to approve here', 5000);
    }
  };

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try { setAttachment({ name: file.name, content: await file.text() }); }
    catch { showToast('Could not read that file (text files only)', 4000); }
  };

  const submitIdea = async () => {
    if (!newTitle.trim()) return;
    const id = await createBrainstormTask(newTitle, newIdea || newTitle, attachment ?? undefined);
    setNewTitle(''); setNewIdea(''); setAttachment(null); setCreating(false);
    if (id) setOpenTask(id);
  };
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const cardsAt = (laneId: string, columnId: string): LaneCard[] =>
    laneCards.filter((c) => c.laneId === laneId && c.columnId === columnId);

  return (
    <div className={css.board}>
      {!isConnected && (
        <div className={css.hint}>Connect a repo to populate the lanes. The structure below is your pipeline; cards appear as tasks move through it.</div>
      )}

      {DEFAULT_FLOW.map((lane) => {
        const isCollapsed = collapsed.has(lane.id);
        const laneCount = laneCards.filter((c) => c.laneId === lane.id).length;
        const columns = [...lane.agents.map((a) => ({ id: a.id, label: a.label })), { id: 'done', label: 'Done' }];
        return (
          <section
            key={lane.id}
            className={`${css.lane} ${dragOver === lane.id ? css.laneDragOver : ''}`}
            onDragOver={(e) => { if (dragged) { e.preventDefault(); setDragOver(lane.id); } }}
            onDragLeave={() => setDragOver((d) => (d === lane.id ? null : d))}
            onDrop={() => onDropLane(lane.id)}
          >
            <header className={css.laneHead} onClick={() => toggle(lane.id)}>
              <span className={css.caret}>{isCollapsed ? '▸' : '▾'}</span>
              <h3 className={css.laneTitle}>{lane.title}</h3>
              <span className={`${css.enterBadge} ${lane.enter === 'manual' ? css.enterManual : css.enterAuto}`}>
                {lane.enter === 'manual' ? 'drag to start' : 'auto'}
              </span>
              {lane.gateBeforeExit && <span className={css.gateBadge}>gate before exit</span>}
              <span className={css.laneCount}>{laneCount}</span>
            </header>

            {!isCollapsed && (
              <div className={css.columns}>
                {columns.map((col) => {
                  const cards = cardsAt(lane.id, col.id);
                  const isDone = col.id === 'done';
                  return (
                    <div key={col.id} className={`${css.column} ${isDone ? css.doneColumn : ''}`}>
                      <div className={css.columnHead}>
                        {isDone ? '✓ ' : ''}{col.label}
                        {cards.length > 0 && <span className={css.colCount}>{cards.length}</span>}
                      </div>
                      <div className={css.cards}>
                        {lane.id === 'brainstorm' && col.id === 'ideation' && (
                          creating ? (
                            <div className={css.createForm} onClick={(e) => e.stopPropagation()}>
                              <input className={css.createInput} autoFocus placeholder="Idea title…" value={newTitle}
                                onChange={(e) => setNewTitle(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') void submitIdea(); if (e.key === 'Escape') setCreating(false); }} />
                              <textarea className={css.createArea} placeholder="Describe the idea (optional)…" rows={3}
                                value={newIdea} onChange={(e) => setNewIdea(e.target.value)} />
                              <label className={css.attachRow}>
                                <input type="file" accept=".md,.txt,.json,.yaml,.yml,text/*" onChange={onPickFile} />
                                {attachment ? `📎 ${attachment.name}` : '📎 Attach a doc (optional)'}
                              </label>
                              <div className={css.createActions}>
                                <button className={css.createBtn} onClick={() => void submitIdea()}>Start</button>
                                <button className={css.cancelBtn} onClick={() => setCreating(false)}>Cancel</button>
                              </div>
                            </div>
                          ) : (
                            <button className={css.newIdea} onClick={() => setCreating(true)}>+ New idea</button>
                          )
                        )}
                        {cards.map((card) => (
                          <div
                            key={card.taskId}
                            className={css.card}
                            role="button"
                            draggable
                            onDragStart={() => setDragged(card)}
                            onDragEnd={() => { setDragged(null); setDragOver(null); }}
                            onPointerDown={(e) => { downPos.current = { x: e.clientX, y: e.clientY }; }}
                            onPointerUp={(e) => {
                              const d = downPos.current; downPos.current = null;
                              if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) setOpenTask(card.taskId);
                            }}
                          >
                            <span className={css.cardId}>{card.taskId}</span>
                            <span className={`${css.badge} ${css['lc_' + card.lifecycle.replace('-', '_')]}`}>
                              {LIFECYCLE_LABEL[card.lifecycle]}
                            </span>
                          </div>
                        ))}
                        {cards.length === 0 && <div className={css.empty} />}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}

      {openTask && (() => {
        const c = laneCards.find((x) => x.taskId === openTask);
        const laneTitle = DEFAULT_FLOW.find((l) => l.id === c?.laneId)?.title;
        const subtitle = c ? `${laneTitle ?? c.laneId} · ${c.lifecycle}` : undefined;
        return <TaskDetailModal taskId={openTask} subtitle={subtitle} onClose={() => setOpenTask(null)} />;
      })()}
    </div>
  );
}
