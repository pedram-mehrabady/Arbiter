import type { Job } from '../../../../api/types';
import css from '../shared.module.css';

function fmtDur(secs: number) {
  if (!secs) return '—';
  if (secs < 60) return secs + 's';
  if (secs < 3600) return Math.floor(secs / 60) + 'm';
  return Math.floor(secs / 3600) + 'h ' + Math.floor((secs % 3600) / 60) + 'm';
}

function totalFrontTime(job: Job): number {
  return (job.stage_history ?? [])
    .filter((h) => h.stage === 'front' || h.stage.includes('front'))
    .reduce((sum, h) => sum + (h.duration_s ?? 0), 0);
}

export function FrontStage({ job }: { job: Job }) {
  const entries = (job.stage_history ?? []).filter((h) => h.stage === 'front');
  const reworks = (job.rework_history ?? []).filter((r) => r.to_stage === 'front' || r.to_stage.includes('front'));
  const total   = totalFrontTime(job);
  const mins    = Math.floor(total / 60);

  return (
    <>
      <div className={css.kpiRow}>
        <div className={css.kpi}><span className={css.kpiNum}>{entries.length || '—'}</span><span className={css.kpiLbl}>Attempts</span></div>
        {total > 0 && <div className={css.kpi}><span className={css.kpiNum}>{mins}m</span><span className={css.kpiLbl}>Total time</span></div>}
        <div className={css.kpi}><span className={css.kpiNum}>{reworks.length}</span><span className={css.kpiLbl}>Reworks</span></div>
      </div>

      {entries.length > 0 ? (
        <div className={css.section}>
          <div className={css.sectionTitle}>Stage history</div>
          {entries.map((h, i) => (
            <div key={i} className={css.histItem}>
              <span className={css.histStage}>front · attempt {i + 1}</span>
              <span className={css.histDur}>{h.duration_s ? Math.floor(h.duration_s / 60) + 'm' : '—'}</span>
              <span className={`${css.histOutcome} ${h.outcome === 'pass' ? css.pass : h.outcome === 'rework' ? css.rework : css.fail}`}>
                {h.outcome}
              </span>
            </div>
          ))}
        </div>
      ) : <p className={css.empty}>Front stage not yet started.</p>}

      {reworks.length > 0 && (
        <div className={css.section}>
          <div className={css.sectionTitle}>Sent back — reasons</div>
          {reworks.map((r, i) => (
            <div key={i} className={css.row}>
              <span className={css.rowLabel}>↩ reason</span>
              <span className={css.rowValue}>{r.reason}</span>
            </div>
          ))}
        </div>
      )}

      {job.planSections?.technical && (
        <div className={css.section}>
          <div className={css.sectionTitle}>Technical context (from plan)</div>
          <p className={css.prose}>{job.planSections.technical}</p>
        </div>
      )}

      <div className={css.liveNote}>
        Connect your repo to see changed files and component diff for this stage.
      </div>
    </>
  );
}
