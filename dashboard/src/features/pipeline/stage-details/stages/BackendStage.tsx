import type { Job } from '../../../../api/types';
import css from '../shared.module.css';

export function BackendStage({ job }: { job: Job }) {
  const entries = (job.stage_history ?? []).filter(
    (h) => h.stage === 'backend' || h.stage.includes('backend')
  );
  const reworks = (job.rework_history ?? []).filter(
    (r) => r.to_stage === 'backend' || r.to_stage.includes('backend')
  );
  const total = entries.reduce((sum, h) => sum + (h.duration_s ?? 0), 0);
  const p = job.planSections;

  return (
    <>
      <div className={css.kpiRow}>
        <div className={css.kpi}><span className={css.kpiNum}>{entries.length || '—'}</span><span className={css.kpiLbl}>Attempts</span></div>
        {total > 0 && <div className={css.kpi}><span className={css.kpiNum}>{Math.floor(total / 60)}m</span><span className={css.kpiLbl}>Total time</span></div>}
        {job.estimated_stages?.backend && (
          <div className={css.kpi}><span className={css.kpiNum}>{job.estimated_stages.backend}</span><span className={css.kpiLbl}>Estimated</span></div>
        )}
        <div className={css.kpi}><span className={css.kpiNum}>{reworks.length}</span><span className={css.kpiLbl}>Reworks</span></div>
      </div>

      {p?.technical && (
        <div className={css.section}>
          <div className={css.sectionTitle}>Technical approach</div>
          <p className={css.prose}>{p.technical}</p>
        </div>
      )}

      {p?.edgeCases && (
        <div className={css.section}>
          <div className={css.sectionTitle}>Edge cases & constraints</div>
          <p className={css.prose}>{p.edgeCases}</p>
        </div>
      )}

      {entries.length > 0 && (
        <div className={css.section}>
          <div className={css.sectionTitle}>Stage history</div>
          {entries.map((h, i) => (
            <div key={i} className={css.histItem}>
              <span className={css.histStage}>backend · attempt {i + 1}</span>
              <span className={css.histDur}>{h.duration_s ? Math.floor(h.duration_s / 60) + 'm' : '—'}</span>
              <span className={`${css.histOutcome} ${h.outcome === 'pass' ? css.pass : h.outcome === 'rework' ? css.rework : css.fail}`}>
                {h.outcome}
              </span>
            </div>
          ))}
        </div>
      )}

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

      <div className={css.liveNote}>
        Connect your repo to see DB schema, EF migrations, and new endpoints for this job.
      </div>
    </>
  );
}
