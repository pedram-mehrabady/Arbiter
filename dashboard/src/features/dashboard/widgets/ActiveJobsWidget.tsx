import { useAppStore } from '../../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { JobCard } from '../../arbiter/components/JobCard';
import styles from './ActiveJobsWidget.module.css';

const ACTIVE_STATUSES = new Set(['queued', 'building', 'paused', 'plan-ready', 'planned']);

export function ActiveJobsWidget() {
  const { jobs, openJobDetail } = useAppStore(useShallow((s) => ({
    jobs: s.arbiterState.jobs,
    openJobDetail: s.openJobDetail,
  })));

  const active = jobs.filter((j) => ACTIVE_STATUSES.has(j.status));
  if (!active.length) return <div className={styles.empty}>No active jobs — start a new task with Quick Actions</div>;

  return (
    <div className={styles.list}>
      {active.map((j) => (
        <div
          key={j.id}
          className={styles.cardWrap}
          onClick={() => openJobDetail(j.id)}
        >
          <JobCard job={j} />
        </div>
      ))}
    </div>
  );
}
