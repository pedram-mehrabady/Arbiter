import { useAppStore } from '../../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { BriefStage }   from './stages/BriefStage';
import { FrontStage }   from './stages/FrontStage';
import { CheckStage }   from './stages/CheckStage';
import { BackendStage } from './stages/BackendStage';
import { PushStage }    from './stages/PushStage';
import { ReviewStage }  from './stages/ReviewStage';
import { MergedStage }  from './stages/MergedStage';
import css from './StageDetailModal.module.css';
import type { Job } from '../../../api/types';

const STAGE_LABELS: Record<string, string> = {
  brief:    'Brief',
  front:    'Frontend',
  check:    'Gate check',
  backend:  'Backend',
  push:     'Push',
  review:   'Review',
  merged:   'Merged',
  gate:     'Gate',
};

function StageContent({ job, stageKey }: { job: Job; stageKey: string }) {
  const key = stageKey.toLowerCase();
  if (key === 'brief'   || key === 'babysitter') return <BriefStage   job={job} />;
  if (key === 'front')                           return <FrontStage   job={job} />;
  if (key === 'check'   || key === 'gate')       return <CheckStage   job={job} />;
  if (key === 'backend' || key === 'be')         return <BackendStage job={job} />;
  if (key === 'push')                            return <PushStage    job={job} />;
  if (key === 'review')                          return <ReviewStage  job={job} />;
  if (key === 'merged'  || key === 'done')       return <MergedStage  job={job} />;
  return <p style={{ fontSize: 13, color: 'var(--muted)' }}>No detail view for "{stageKey}".</p>;
}

export function StageDetailModal() {
  const { stageDetail, closeStageDetail, arbiterState } = useAppStore(
    useShallow((s) => ({
      stageDetail:      s.stageDetail,
      closeStageDetail: s.closeStageDetail,
      arbiterState:      s.arbiterState,
    }))
  );

  if (!stageDetail) return null;

  const job = arbiterState.jobs.find((j) => j.id === stageDetail.jobId);
  if (!job) return null;

  const label = STAGE_LABELS[stageDetail.stageKey.toLowerCase()] ?? stageDetail.stageKey;

  return (
    <div className={css.overlay} onClick={closeStageDetail}>
      <div className={css.modal} onClick={(e) => e.stopPropagation()}>
        <div className={css.header}>
          <span className={css.stageTag}>{label}</span>
          <span className={css.title}>{job.title}</span>
          <button className={css.closeBtn} onClick={closeStageDetail}>✕</button>
        </div>
        <div className={css.body}>
          <StageContent job={job} stageKey={stageDetail.stageKey} />
        </div>
      </div>
    </div>
  );
}
