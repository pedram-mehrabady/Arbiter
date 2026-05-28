import { useState, useEffect } from 'react';
import { useAppStore } from './store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { TopBar } from './components/TopBar';
import { Toast } from './components/Toast';
import { WatcherModal } from './components/WatcherModal';
import { ConnectModal } from './components/ConnectModal';
import { PipelineView } from './features/pipeline/PipelineView';
import { ReportsView } from './features/reports/ReportsView';
import { FlowView } from './features/flow/FlowView';
import { BoardView } from './features/board/BoardView';
import { PlanModal } from './features/arbiter/components/PlanModal';
import { PlanReviewModal } from './features/arbiter/components/PlanReviewModal';
import { ActionGateModal } from './features/arbiter/components/ActionGateModal';
import { ConductorGate } from './features/arbiter/components/ConductorGate';
import { DeveloperSetupModal } from './features/developer/DeveloperSetupModal';
import { ConductorBanner } from './components/ConductorBanner';
import { useDeveloperActivity } from './hooks/useDeveloperActivity';
import { getDeveloperName } from './lib/developer';
import styles from './App.module.css';

type MainTab = 'pipeline' | 'reports' | 'flow' | 'board';

export default function App() {
  const [tab, setTab] = useState<MainTab>('pipeline');
  const [needsSetup, setNeedsSetup] = useState(() => getDeveloperName() === null);
  const [profileOpen, setProfileOpen] = useState(false);

  const { openModal, arbiterState, activeConductorGate, conductorSessions, openConductorGate, isConnected, connectDev, settings } = useAppStore(useShallow((s) => ({
    openModal:           s.openModal,
    arbiterState:        s.arbiterState,
    activeConductorGate: s.activeConductorGate,
    conductorSessions:   s.conductorSessions,
    openConductorGate:   s.openConductorGate,
    isConnected:         s.isConnected,
    connectDev:          s.connectDev,
    settings:            s.settings,
  })));

  // Auto-reconnect on startup when a repo path was previously saved
  useEffect(() => {
    const p = settings.repoPath?.trim();
    if (!isConnected && p && (p.startsWith('/') || /^[A-Za-z]:[/\\]/.test(p))) {
      connectDev(p);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useDeveloperActivity();

  const pendingApproval = arbiterState.pending_approval ?? null;
  const pendingQuestion = arbiterState.question ?? null;
  const pendingGates = arbiterState.pending_gates ?? [];

  return (
    <div className={styles.shell}>
      <TopBar onOpenProfile={() => setProfileOpen(true)} />

      <nav className={styles.tabNav}>
        <button
          className={`${styles.tabBtn}${tab === 'pipeline' ? ' ' + styles.tabBtnActive : ''}`}
          onClick={() => setTab('pipeline')}
        >
          Pipeline
        </button>
        <button
          className={`${styles.tabBtn}${tab === 'reports' ? ' ' + styles.tabBtnActive : ''}`}
          onClick={() => setTab('reports')}
        >
          Reports
        </button>
        <button
          className={`${styles.tabBtn}${tab === 'flow' ? ' ' + styles.tabBtnActive : ''}`}
          onClick={() => setTab('flow')}
        >
          Flow
        </button>
        <button
          className={`${styles.tabBtn}${tab === 'board' ? ' ' + styles.tabBtnActive : ''}`}
          onClick={() => setTab('board')}
        >
          Board
        </button>
      </nav>

      <ConductorBanner />

      {pendingGates.length > 0 && !activeConductorGate && (
        <div className="gate-pending-banner" style={{ padding: '8px 24px' }}>
          {pendingGates.map((pg) => (
            <button
              key={`${pg.task_id}-${pg.gate}`}
              className="gate-pending-btn"
              onClick={() => openConductorGate(pg.task_id, pg.gate)}
            >
              ⚡ Gate waiting: <strong>{pg.gate}</strong> for <code>{pg.task_id}</code> — click to review
            </button>
          ))}
        </div>
      )}

      <div className={styles.content}>
        {tab === 'pipeline' && <PipelineView />}
        {tab === 'reports'  && <ReportsView />}
        {tab === 'flow'     && <FlowView />}
        {tab === 'board'    && <BoardView />}
      </div>

      {openModal === 'plan'       && <PlanModal />}
      {openModal === 'planReview' && <PlanReviewModal />}
      {(pendingApproval || pendingQuestion) && <ActionGateModal />}

      {activeConductorGate && conductorSessions[activeConductorGate.taskId] && (
        <ConductorGate
          taskId={activeConductorGate.taskId}
          gate={activeConductorGate.gate}
          session={conductorSessions[activeConductorGate.taskId]}
        />
      )}

      <WatcherModal />
      <ConnectModal />
      <Toast />

      {(needsSetup || profileOpen) && (
        <DeveloperSetupModal
          required={needsSetup}
          onDone={() => { setNeedsSetup(false); setProfileOpen(false); }}
        />
      )}
    </div>
  );
}
