import { useMemo } from 'react';
import type { Job } from '../../../api/types';
import styles from './CliStats.module.css';

const META = [
  { key: 'babysitter', label: 'Babysitter', emoji: '🧠', grad: '#f59e0b,#fb923c' },
  { key: 'front',      label: 'Front',      emoji: '⚛',  grad: '#38bdf8,#818cf8' },
  { key: 'backend',    label: 'Backend',    emoji: '⚙',  grad: '#34d399,#059669' },
  { key: 'push',       label: 'Push',       emoji: '🧪', grad: '#c084fc,#818cf8' },
  { key: 'review',     label: 'Review',     emoji: '🔍', grad: '#fb7185,#f43f5e' },
];

function normStage(s: string) { return s.startsWith('babysitter') ? 'babysitter' : s; }

function fmtDur(s: number) {
  if (!s || s < 0) return '';
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
}

export function CliStats({ jobs }: { jobs: Job[] }) {
  const totals = useMemo(() => {
    const acc: Record<string, number[]> = { babysitter: [], front: [], backend: [], push: [], review: [] };
    jobs.forEach((j) =>
      (j.stage_history ?? []).forEach((h) => {
        const k = normStage(h.stage);
        if (k in acc && h.duration_s > 0) acc[k].push(h.duration_s);
      })
    );
    return acc;
  }, [jobs]);

  const hasData = Object.values(totals).some((a) => a.length > 0);
  if (!hasData) return null;

  return (
    <div>
      <div className="section-title" style={{ fontSize: 10, marginBottom: 8 }}>Avg Time per CLI</div>
      <div className={styles.grid}>
        {META.map((m) => {
          const arr = totals[m.key];
          if (!arr.length) return null;
          const avg = Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
          return (
            <div key={m.key} className={styles.card} style={{ '--cg': `linear-gradient(135deg,${m.grad})` } as React.CSSProperties}>
              <div className={styles.emoji}>{m.emoji}</div>
              <div className={styles.avg} style={{ background: `linear-gradient(135deg,${m.grad})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                {fmtDur(avg)}
              </div>
              <div className={styles.name}>{m.label}</div>
              <div className={styles.count}>{arr.length} job{arr.length !== 1 ? 's' : ''}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
