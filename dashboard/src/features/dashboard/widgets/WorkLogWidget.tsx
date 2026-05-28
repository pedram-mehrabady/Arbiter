import { useAppStore } from '../../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { CliWorkLog } from '../../arbiter/components/CliWorkLog';
import styles from './WorkLogWidget.module.css';

export function WorkLogWidget() {
  const { jobs, cliStats } = useAppStore(useShallow((s) => ({
    jobs: s.arbiterState.jobs,
    cliStats: s.cliStats,
  })));
  const hasData = cliStats || jobs.some((j) => (j.stage_history ?? []).length > 0);
  if (!hasData) return <div className={styles.empty}>Time tracking will appear here as CLIs run</div>;
  return <CliWorkLog jobs={jobs} cliStats={cliStats} />;
}
