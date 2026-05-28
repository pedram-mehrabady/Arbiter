import type { Job } from '../../../../api/types';
import s from '../shared.module.css';

function fmtDur(secs: number) {
  if (!secs) return '—';
  if (secs < 60) return secs + 's';
  if (secs < 3600) return Math.floor(secs / 60) + 'm';
  return Math.floor(secs / 3600) + 'h ' + Math.floor((secs % 3600) / 60) + 'm';
}

export function BriefStage({ job }: { job: Job }) {
  const p = job.planSections;
  const history = (job.stage_history ?? []).filter((h) => h.stage.includes('babysitter') && !h.stage.includes('-'));
  const histEntry = history[0];

  return (
    <>
      <div className={s.kpiRow}>
        {job.complexity && <div className={s.kpi}><span className={s.kpiNum}>{job.complexity}</span><span className={s.kpiLbl}>Complexity</span></div>}
        {histEntry && <div className={s.kpi}><span className={s.kpiNum}>{fmtDur(histEntry.duration_s)}</span><span className={s.kpiLbl}>Brief time</span></div>}
        {job.estimated_stages && Object.entries(job.estimated_stages).map(([k, v]) => (
          <div key={k} className={s.kpi}><span className={s.kpiNum}>{v}</span><span className={s.kpiLbl}>{k}</span></div>
        ))}
      </div>

      {(job.requirements || p?.requirements) && (
        <div className={s.section}>
          <div className={s.sectionTitle}>Requirements</div>
          <p className={s.prose}>{p?.requirements || job.requirements}</p>
        </div>
      )}

      {p?.acceptance && (
        <div className={s.section}>
          <div className={s.sectionTitle}>Acceptance criteria</div>
          <p className={s.prose}>{p.acceptance}</p>
        </div>
      )}

      {p?.edgeCases && (
        <div className={s.section}>
          <div className={s.sectionTitle}>Edge cases</div>
          <p className={s.prose}>{p.edgeCases}</p>
        </div>
      )}

      {p?.technical && (
        <div className={s.section}>
          <div className={s.sectionTitle}>Technical notes</div>
          <p className={s.prose}>{p.technical}</p>
        </div>
      )}

      {p?.openQuestions && (
        <div className={s.section}>
          <div className={s.sectionTitle}>Open questions</div>
          <p className={s.prose}>{p.openQuestions}</p>
        </div>
      )}

      {!p && !job.requirements && <p className={s.empty}>Plan not yet written for this job.</p>}
    </>
  );
}
