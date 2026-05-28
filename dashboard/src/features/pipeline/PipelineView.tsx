import { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import type { Job } from '../../api/types';
import { JobCard } from '../arbiter/components/JobCard';
import { JobDetailModal } from '../dashboard/JobDetailModal';
import { StageDetailModal } from './stage-details/StageDetailModal';
import { PlansPanel } from '../plans/PlansPanel';
import { PlanDetailPanel } from '../plans/PlanDetailPanel';
import styles from './PipelineView.module.css';

// ── Jobs panel ───────────────────────────────────────────────────────────────
type Filter = 'active' | 'completed' | 'all';

const ACTIVE_STATUSES   = new Set(['planned', 'plan-ready', 'queued', 'building', 'paused']);
const DONE_STATUSES     = new Set(['done', 'merged', 'shipped', 'failed']);

function filterJobs(jobs: Job[], f: Filter): Job[] {
  if (f === 'active')    return jobs.filter((j) => ACTIVE_STATUSES.has(j.status));
  if (f === 'completed') return jobs.filter((j) => DONE_STATUSES.has(j.status));
  return jobs;
}

function JobsPanel() {
  const { jobs, openJobDetail, setOpenModal } = useAppStore(useShallow((s) => ({
    jobs:          s.arbiterState.jobs,
    openJobDetail: s.openJobDetail,
    setOpenModal:  s.setOpenModal,
  })));
  const [filter, setFilter] = useState<Filter>('active');
  const visible = filterJobs(jobs, filter);

  return (
    <div className={styles.jobsCard}>
      <div className={styles.jobsHeader}>
        <div className={styles.jobsFilterRow}>
          {(['active', 'all', 'completed'] as Filter[]).map((f) => (
            <button
              key={f}
              className={`${styles.filterBtn}${filter === f ? ' ' + styles.filterBtnActive : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'active' ? 'Active' : f === 'completed' ? 'Completed' : 'All'}
              <span className={styles.filterCount}>{filterJobs(jobs, f).length}</span>
            </button>
          ))}
        </div>
        <button className={styles.newTaskBtn} onClick={() => setOpenModal('plan')}>
          + Plan New Task
        </button>
      </div>

      <div className={styles.jobsList}>
        {visible.length === 0 ? (
          <div className={styles.emptyJobs}>
            {filter === 'active' ? 'No active jobs — click "+ Plan New Task" to start one' : 'No jobs here yet'}
          </div>
        ) : (
          visible.map((j) => (
            <div key={j.id} className={styles.jobRow} onClick={() => openJobDetail(j.id)}>
              <JobCard job={j} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── PipelineView ─────────────────────────────────────────────────────────────
export function PipelineView() {
  return (
    <div className={styles.view}>
      <PlansPanel />
      <JobsPanel />
      <PlanDetailPanel />
      <JobDetailModal />
      <StageDetailModal />
    </div>
  );
}