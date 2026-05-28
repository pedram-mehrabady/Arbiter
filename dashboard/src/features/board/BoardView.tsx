import { useEffect, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { shellCmd } from '../../lib/osCmd';
import type { BoardData } from '../../api/types';
import styles from './BoardView.module.css';

// All plans across the exec-plan state machine, read from .arbiter/board.json
// (the projection written by scripts/write-board.sh — the conductor refreshes it).
const COLUMNS: [string, string][] = [
  ['00-proposed',   'Proposed'],
  ['01-inbox',      'Up Next'],
  ['02-incubating', 'Incubating'],
  ['03-building',   'Building'],
  ['04-human-gate', 'Human Gate'],
  ['05-review',     'Review'],
  ['06-completed',  'Done'],
  ['07-failed',     'Failed'],
];

export function BoardView() {
  const liveApi = useAppStore((s) => s.liveApi);
  const os      = useAppStore((s) => s.settings.os);
  const [board, setBoard] = useState<BoardData | null>(null);

  useEffect(() => {
    if (!liveApi) return;
    let alive = true;
    const load = async () => { const b = await liveApi.readBoard(); if (alive) setBoard(b); };
    load();
    const id = setInterval(load, 4000);
    return () => { alive = false; clearInterval(id); };
  }, [liveApi]);

  if (!liveApi) return <div className={styles.empty}>Connect the repo to see the plans board.</div>;
  if (!board) return <div className={styles.empty}>No <code>.arbiter/board.json</code> yet — run the conductor, or <code>{shellCmd('scripts/write-board.sh', os)}</code>.</div>;

  const queue = board.queue ?? [];
  const rank = new Map(queue.map((id, i) => [id, i + 1] as const));

  return (
    <div className={styles.wrap}>
      <div className={styles.meta}>updated {new Date(board.generated).toLocaleTimeString()} · {queue.length} queued</div>
      <div className={styles.board}>
        {COLUMNS.map(([key, label]) => {
          const items = board.states?.[key] ?? [];
          return (
            <div key={key} className={styles.col}>
              <div className={styles.colHead}>{label}<span className={styles.count}>{items.length}</span></div>
              {items.map((it) => (
                <div key={it.id} className={styles.card}>
                  <div className={styles.cardTitle}>
                    {rank.has(it.id) && <span className={styles.badge}>{rank.get(it.id)}</span>}
                    {it.title || it.id}
                  </div>
                  <div className={styles.cardMeta}>{it.id}{it.archetype ? ` · ${it.archetype}` : ''}</div>
                </div>
              ))}
              {items.length === 0 && <div className={styles.colEmpty}>—</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
