import { useState } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import type { Job } from '../../../api/types';
import styles from './DoneJobsWidget.module.css';

const DONE_STATUSES = new Set(['done', 'merged', 'shipped']);

function fmtDur(started: string | null | undefined, ended: string | null | undefined) {
  if (!started || !ended) return null;
  const s = Math.floor((new Date(ended).getTime() - new Date(started).getTime()) / 1000);
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
}

function DoneRow({ job, onClick }: { job: Job; onClick: () => void }) {
  const dur = fmtDur(job.started_at, job.completed_at);
  return (
    <div className={styles.row} onClick={onClick}>
      <span className="status-badge st-done">Merged</span>
      {job.ticket && <span className={styles.ticket}>{job.ticket}</span>}
      <span className={styles.title}>{job.title}</span>
      <span className={styles.spacer} />
      {dur && <span className={styles.dur}>⏱ {dur}</span>}
      {job.pr_url && (
        <a className={styles.prLink} href={job.pr_url} target="_blank" rel="noopener"
           onClick={(e) => e.stopPropagation()}>PR ↗</a>
      )}
    </div>
  );
}

export function DoneJobsWidget() {
  const { jobs, openJobDetail } = useAppStore(useShallow((s) => ({
    jobs: s.arbiterState.jobs,
    openJobDetail: s.openJobDetail,
  })));
  const [limit, setLimit] = useState(10);

  const done = jobs.filter((j) => DONE_STATUSES.has(j.status));
  if (!done.length) return <div className={styles.empty}>Completed jobs will appear here once merged</div>;

  const visible = done.slice(0, limit);
  return (
    <div className={styles.wrap}>
      <div className={styles.list}>
        {visible.map((j) => <DoneRow key={j.id} job={j} onClick={() => openJobDetail(j.id)} />)}
      </div>
      {done.length > limit && (
        <button className={styles.moreBtn} onClick={() => setLimit((l) => l + 10)}>
          Show {Math.min(10, done.length - limit)} more ({done.length - limit} remaining)
        </button>
      )}
    </div>
  );
}
