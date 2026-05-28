import { WidgetShell }       from './WidgetShell';
import { QuickActionsWidget } from './widgets/QuickActionsWidget';
import { AgentsWidget }       from './widgets/AgentsWidget';
import { CliStatsWidget }     from './widgets/CliStatsWidget';
import { WorkLogWidget }      from './widgets/WorkLogWidget';
import { ActiveJobsWidget }   from './widgets/ActiveJobsWidget';
import { ImprovementsWidget } from './widgets/ImprovementsWidget';
import { DoneJobsWidget }     from './widgets/DoneJobsWidget';
import styles from './DashboardGrid.module.css';

export function DashboardGrid() {
  return (
    <div className={styles.grid}>
      <div className={styles.areaQuick}>
        <WidgetShell title="Quick Actions"><QuickActionsWidget /></WidgetShell>
      </div>
      <div className={styles.areaAgents}>
        <WidgetShell title="Agents"><AgentsWidget /></WidgetShell>
      </div>
      <div className={styles.areaStats}>
        <WidgetShell title="CLI Stats"><CliStatsWidget /></WidgetShell>
      </div>
      <div className={styles.areaWorklog}>
        <WidgetShell title="Work Log"><WorkLogWidget /></WidgetShell>
      </div>
      <div className={styles.areaJobs}>
        <WidgetShell title="Active Jobs"><ActiveJobsWidget /></WidgetShell>
      </div>
      <div className={styles.areaImprovements}>
        <WidgetShell title="Improvements"><ImprovementsWidget /></WidgetShell>
      </div>
      <div className={styles.areaDone}>
        <WidgetShell title="Merged Jobs"><DoneJobsWidget /></WidgetShell>
      </div>
    </div>
  );
}
