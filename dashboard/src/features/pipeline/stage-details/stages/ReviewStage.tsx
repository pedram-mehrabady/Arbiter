import type { Job } from '../../../../api/types';
import css from '../shared.module.css';

export function ReviewStage({ job }: { job: Job }) {
  const entries = (job.stage_history ?? []).filter(
    (h) => h.stage === 'review' || h.stage.includes('review')
  );
  const reworks = (job.rework_history ?? []).filter(
    (r) => r.to_stage === 'review' || r.to_stage.includes('review')
  );
  const total = entries.reduce((sum, h) => sum + (h.duration_s ?? 0), 0);

  return (
    <>
      <div className={css.kpiRow}>
        <div className={css.kpi}><span className={css.kpiNum}>{entries.length || '—'}</span><span className={css.kpiLbl}>Review rounds</span></div>
        {total > 0 && <div className={css.kpi}><span className={css.kpiNum}>{Math.floor(total / 60)}m</span><span className={css.kpiLbl}>Total time</span></div>}
        <div className={css.kpi}><span className={css.kpiNum}>{reworks.length}</span><span className={css.kpiLbl}>Reworks</span></div>
      </div>

      {job.pr_url && (
        <div className={css.section}>
          <div className={css.sectionTitle}>Pull request</div>
          <div className={css.row}>
            <span className={css.rowLabel}>PR URL</span>
            <span className={css.rowValue}>{job.pr_url}</span>
          </div>
        </div>
      )}

      {entries.length > 0 ? (
        <div className={css.section}>
          <div className={css.sectionTitle}>Review history</div>
          {entries.map((h, i) => (
            <div key={i} className={css.histItem}>
              <span className={css.histStage}>{h.stage} · round {i + 1}</span>
              <span className={css.histDur}>{h.duration_s ? Math.floor(h.duration_s / 60) + 'm' : '—'}</span>
              <span className={`${css.histOutcome} ${h.outcome === 'pass' ? css.pass : h.outcome === 'rework' ? css.rework : css.fail}`}>
                {h.outcome}
              </span>
            </div>
          ))}
        </div>
      ) : <p className={css.empty}>Review stage not yet started.</p>}

      {reworks.length > 0 && (
        <div className={css.section}>
          <div className={css.sectionTitle}>Review feedback — sent back</div>
          {reworks.map((r, i) => (
            <div key={i} className={css.row}>
              <span className={css.rowLabel}>↩ to {r.to_stage}</span>
              <span className={css.rowValue}>{r.reason}</span>
            </div>
          ))}
        </div>
      )}

      {job.planSections?.acceptance && (
        <div className={css.section}>
          <div className={css.sectionTitle}>Acceptance criteria (reference)</div>
          <p className={css.prose}>{job.planSections.acceptance}</p>
        </div>
      )}
    </>
  );
}
