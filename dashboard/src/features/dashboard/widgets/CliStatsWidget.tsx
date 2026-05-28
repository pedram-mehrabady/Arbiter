import { useAppStore } from '../../../store/useAppStore';
import { CliStats } from '../../arbiter/components/CliStats';
import styles from './CliStatsWidget.module.css';

export function CliStatsWidget() {
  const jobs = useAppStore((s) => s.arbiterState.jobs);
  const hasHistory = jobs.some((j) => (j.stage_history ?? []).length > 0);
  if (!hasHistory) return <div className={styles.empty}>No stage history yet — jobs in progress will populate this</div>;
  return <CliStats jobs={jobs} />;
}
