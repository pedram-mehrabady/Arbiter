import { useMemo } from 'react';
import type { Job, CliStats as CliStatsT } from '../../../api/types';
import styles from './CliWorkLog.module.css';

const META = [
  { key: 'babysitter', label: 'Babysitter', emoji: '🧠', grad: '#f59e0b,#fb923c' },
  { key: 'front',      label: 'Front',      emoji: '⚛',  grad: '#38bdf8,#818cf8' },
  { key: 'backend',    label: 'Backend',    emoji: '⚙',  grad: '#34d399,#059669' },
  { key: 'push',       label: 'Push',       emoji: '🧪', grad: '#c084fc,#818cf8' },
];

function normStage(s: string) { return s.startsWith('babysitter') ? 'babysitter' : s; }

function fmtDur(s: number) {
  if (!s || s < 0) return '';
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
}

function fmtCtx(chars: number) {
  if (!chars) return '—';
  if (chars < 1000) return chars + ' ch';
  if (chars < 1_000_000) return Math.round(chars / 1000) + 'k';
  return (chars / 1_000_000).toFixed(1) + 'M';
}

export function CliWorkLog({ jobs, cliStats }: { jobs: Job[]; cliStats: CliStatsT | null }) {
  const fromJobs = useMemo(() => {
    const acc: Record<string, { s: number; n: number }> = {
      babysitter: { s: 0, n: 0 }, front: { s: 0, n: 0 }, backend: { s: 0, n: 0 }, push: { s: 0, n: 0 },
    };
    jobs.forEach((j) =>
      (j.stage_history ?? []).forEach((h) => {
        const k = normStage(h.stage);
        if (k in acc && h.duration_s > 0) { acc[k].s += h.duration_s; acc[k].n++; }
      })
    );
    return acc;
  }, [jobs]);

  const grandTotal = META.reduce((acc, m) => {
    const c = cliStats?.[m.key];
    const j = fromJobs[m.key];
    return acc + (c ? c.total_duration_s : j.s);
  }, 0);

  const hasData = META.some((m) => {
    const c = cliStats?.[m.key];
    const j = fromJobs[m.key];
    return (c ? c.total_duration_s : j.s) > 0;
  });

  if (!hasData && !cliStats) return null;

  return (
    <div>
      <div className={styles.label}>
        <span className="section-title" style={{ fontSize: 10 }}>CLI Work Log</span>
        {grandTotal > 0 && (
          <span className={styles.grandTotal}>{fmtDur(grandTotal)} total</span>
        )}
      </div>
      <div className={styles.grid}>
        {META.map((m) => {
          const c = cliStats?.[m.key];
          const j = fromJobs[m.key];
          const totalS = c ? c.total_duration_s : j.s;
          const sessions = c ? c.total_sessions : j.n;
          if (!totalS && !sessions) return null;
          const ctxIn  = c ? fmtCtx(c.total_context_in_chars)  : null;
          const ctxOut = c ? fmtCtx(c.total_context_out_chars) : null;
          return (
            <div key={m.key} className={styles.card} style={{ '--cg': `linear-gradient(135deg,${m.grad})` } as React.CSSProperties}>
              <div className={styles.top}>
                <span className={styles.emoji}>{m.emoji}</span>
                <span className={styles.name}>{m.label}</span>
                <span className={styles.sessions}>{sessions} sess</span>
              </div>
              <div className={styles.total} style={{ background: `linear-gradient(135deg,${m.grad})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                {fmtDur(totalS) || '—'}
              </div>
              {ctxIn && (
                <div className={styles.ctx}>
                  <span className={styles.ctxLabel}>↑</span>
                  <span className={styles.ctxVal}>{ctxIn}</span>
                  <span className={styles.ctxSep}>·</span>
                  <span className={styles.ctxLabel}>↓</span>
                  <span className={styles.ctxVal}>{ctxOut}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
