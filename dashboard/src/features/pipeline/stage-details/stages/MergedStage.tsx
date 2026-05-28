import type { Job } from '../../../../api/types';
import css from '../shared.module.css';

function fmtDur(secs: number) {
  if (!secs) return '—';
  if (secs < 60) return secs + 's';
  if (secs < 3600) return Math.floor(secs / 60) + 'm';
  return Math.floor(secs / 3600) + 'h ' + Math.floor((secs % 3600) / 60) + 'm';
}

export function MergedStage({ job }: { job: Job }) {
  const history = job.stage_history ?? [];
  const totalSecs = history.reduce((sum, h) => sum + (h.duration_s ?? 0), 0);

  const byStage: Record<string, number> = {};
  for (const h of history) {
    byStage[h.stage] = (byStage[h.stage] ?? 0) + (h.duration_s ?? 0);
  }

  const startedAt  = job.started_at ? new Date(job.started_at) : null;
  const mergedAt   = job.completed_at ? new Date(job.completed_at) : null;
  const wallClock  = startedAt && mergedAt ? Math.floor((mergedAt.getTime() - startedAt.getTime()) / 1000) : 0;

  return (
    <>
      <div className={css.kpiRow}>
        {totalSecs > 0 && <div className={css.kpi}><span className={css.kpiNum}>{fmtDur(totalSecs)}</span><span className={css.kpiLbl}>Agent time</span></div>}
        {wallClock > 0  && <div className={css.kpi}><span className={css.kpiNum}>{fmtDur(wallClock)}</span><span className={css.kpiLbl}>Wall clock</span></div>}
        <div className={css.kpi}><span className={css.kpiNum}>{(job.rework_history ?? []).length}</span><span className={css.kpiLbl}>Total reworks</span></div>
        <div className={css.kpi}><span className={css.kpiNum}>{history.length}</span><span className={css.kpiLbl}>Stage runs</span></div>
      </div>

      {Object.keys(byStage).length > 0 && (
        <div className={css.section}>
          <div className={css.sectionTitle}>Time per stage</div>
          {Object.entries(byStage).map(([stage, secs]) => (
            <div key={stage} className={css.row}>
              <span className={css.rowLabel}>{stage}</span>
              <span className={css.rowValue}>{fmtDur(secs)}</span>
            </div>
          ))}
        </div>
      )}

      {job.pr_url && (
        <div className={css.section}>
          <div className={css.sectionTitle}>Pull request</div>
          <div className={css.row}>
            <span className={css.rowLabel}>Merged PR</span>
            <span className={css.rowValue}>{job.pr_url}</span>
          </div>
        </div>
      )}

      {mergedAt && (
        <div className={css.section}>
          <div className={css.sectionTitle}>Timeline</div>
          {startedAt && (
            <div className={css.row}>
              <span className={css.rowLabel}>Started</span>
              <span className={css.rowValue}>{startedAt.toLocaleString()}</span>
            </div>
          )}
          <div className={css.row}>
            <span className={css.rowLabel}>Merged</span>
            <span className={css.rowValue}>{mergedAt.toLocaleString()}</span>
          </div>
        </div>
      )}
    </>
  );
}
