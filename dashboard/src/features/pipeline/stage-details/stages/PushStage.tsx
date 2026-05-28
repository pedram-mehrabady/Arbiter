import type { Job } from '../../../../api/types';
import css from '../shared.module.css';

export function PushStage({ job }: { job: Job }) {
  const entries = (job.stage_history ?? []).filter(
    (h) => h.stage === 'push' || h.stage.includes('push')
  );
  const reworks = (job.rework_history ?? []).filter(
    (r) => r.to_stage === 'push' || r.to_stage.includes('push')
  );
  const total = entries.reduce((sum, h) => sum + (h.duration_s ?? 0), 0);

  return (
    <>
      <div className={css.kpiRow}>
        <div className={css.kpi}><span className={css.kpiNum}>{entries.length || '—'}</span><span className={css.kpiLbl}>Push attempts</span></div>
        {total > 0 && <div className={css.kpi}><span className={css.kpiNum}>{Math.floor(total / 60)}m</span><span className={css.kpiLbl}>Total time</span></div>}
        {job.estimated_stages?.push && (
          <div className={css.kpi}><span className={css.kpiNum}>{job.estimated_stages.push}</span><span className={css.kpiLbl}>Estimated</span></div>
        )}
        <div className={css.kpi}><span className={css.kpiNum}>{reworks.length}</span><span className={css.kpiLbl}>Reworks</span></div>
      </div>

      {entries.length > 0 ? (
        <div className={css.section}>
          <div className={css.sectionTitle}>Push history</div>
          {entries.map((h, i) => (
            <div key={i} className={css.histItem}>
              <span className={css.histStage}>push · attempt {i + 1}</span>
              <span className={css.histDur}>{h.duration_s ? Math.floor(h.duration_s / 60) + 'm' : '—'}</span>
              <span className={`${css.histOutcome} ${h.outcome === 'pass' ? css.pass : h.outcome === 'rework' ? css.rework : css.fail}`}>
                {h.outcome}
              </span>
            </div>
          ))}
        </div>
      ) : <p className={css.empty}>Push stage not yet started.</p>}

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

      {job.pr_url && (
        <div className={css.section}>
          <div className={css.sectionTitle}>Pull request</div>
          <div className={css.row}>
            <span className={css.rowLabel}>PR URL</span>
            <span className={css.rowValue}>{job.pr_url}</span>
          </div>
        </div>
      )}

      <div className={css.liveNote}>
        Connect your repo to see gate output: test count, coverage %, typecheck and lint results.
      </div>
    </>
  );
}
