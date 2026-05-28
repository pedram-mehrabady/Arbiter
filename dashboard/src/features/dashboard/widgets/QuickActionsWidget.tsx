import { useAppStore } from '../../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import styles from './QuickActionsWidget.module.css';

export function QuickActionsWidget() {
  const { setOpenModal, isConnected, connect, settings, lastUpdated, arbiterState } =
    useAppStore(useShallow((s) => ({
      setOpenModal:  s.setOpenModal,
      isConnected:   s.isConnected,
      connect:       s.connect,
      settings:      s.settings,
      lastUpdated:   s.lastUpdated,
      arbiterState:   s.arbiterState,
    })));

  const jobs = arbiterState.jobs;
  const active  = jobs.filter((j) => !['done','merged','shipped'].includes(j.status)).length;
  const done    = jobs.filter((j) => ['done','merged','shipped'].includes(j.status)).length;
  const planned = jobs.filter((j) => j.status === 'planned' || j.status === 'plan-ready').length;

  const hasApiKey = Boolean(settings.anthropicApiKey);

  return (
    <div className={styles.wrap}>
      <button className={styles.planBtn} onClick={() => setOpenModal('plan')}>
        + Plan New Task
      </button>

      <div className={styles.kpis}>
        <div className={styles.kpi}>
          <span className={styles.kpiNum}>{active}</span>
          <span className={styles.kpiLabel}>active</span>
        </div>
        <div className={styles.kpiDiv} />
        <div className={styles.kpi}>
          <span className={styles.kpiNum}>{planned}</span>
          <span className={styles.kpiLabel}>planned</span>
        </div>
        <div className={styles.kpiDiv} />
        <div className={styles.kpi}>
          <span className={styles.kpiNum}>{done}</span>
          <span className={styles.kpiLabel}>merged</span>
        </div>
      </div>

      <div className={styles.meta}>
        <div className={styles.metaRow}>
          <span className={styles.metaKey}>LLM</span>
          <span className={styles.metaVal}>{hasApiKey ? 'Claude (configured)' : 'Claude (no key)'}</span>
        </div>
        <div className={styles.metaRow}>
          <span className={styles.metaKey}>Repo</span>
          <span className={`${styles.metaVal} ${isConnected ? styles.live : ''}`}>
            {isConnected ? '● live' : '○ disconnected'}
          </span>
        </div>
        {lastUpdated && (
          <div className={styles.metaRow}>
            <span className={styles.metaKey}>Updated</span>
            <span className={styles.metaVal}>{lastUpdated.toLocaleTimeString()}</span>
          </div>
        )}
      </div>

      {!isConnected && (
        <button className={styles.connectBtn} onClick={connect}>
          Connect repo →
        </button>
      )}
    </div>
  );
}
