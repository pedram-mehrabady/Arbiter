import type { Job } from '../../../../api/types';
import css from '../shared.module.css';

export function CheckStage({ job }: { job: Job }) {
  const checkEntries = (job.stage_history ?? []).filter(
    (h) => h.stage.includes('check') || h.stage.includes('gate') || h.stage.includes('review-gate')
  );
  const reworks = (job.rework_history ?? []).filter(
    (r) => r.to_stage.includes('check') || r.to_stage.includes('gate')
  );
  const passes = checkEntries.filter((h) => h.outcome === 'pass').length;
  const fails  = checkEntries.filter((h) => h.outcome === 'fail').length;

  return (
    <>
      <div className={css.kpiRow}>
        <div className={css.kpi}><span className={css.kpiNum}>{checkEntries.length || '—'}</span><span className={css.kpiLbl}>Gate runs</span></div>
        {passes > 0 && <div className={css.kpi}><span className={css.kpiNum}>{passes}</span><span className={css.kpiLbl}>Passed</span></div>}
        {fails > 0  && <div className={css.kpi}><span className={css.kpiNum}>{fails}</span><span className={css.kpiLbl}>Failed</span></div>}
        <div className={css.kpi}><span className={css.kpiNum}>{reworks.length}</span><span className={css.kpiLbl}>Reworks</span></div>
      </div>

      {checkEntries.length > 0 ? (
        <div className={css.section}>
          <div className={css.sectionTitle}>Gate history</div>
          {checkEntries.map((h, i) => (
            <div key={i} className={css.histItem}>
              <span className={css.histStage}>{h.stage}</span>
              <span className={css.histDur}>{h.duration_s ? Math.floor(h.duration_s / 60) + 'm' : '—'}</span>
              <span className={`${css.histOutcome} ${h.outcome === 'pass' ? css.pass : h.outcome === 'rework' ? css.rework : css.fail}`}>
                {h.outcome}
              </span>
            </div>
          ))}
        </div>
      ) : <p className={css.empty}>No gate runs recorded yet.</p>}

      {reworks.length > 0 && (
        <div className={css.section}>
          <div className={css.sectionTitle}>Sent back — reasons</div>
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

      <div className={css.liveNote}>
        Connect your repo to see live gate output (typecheck, lint, test coverage, build).
      </div>
    </>
  );
}
