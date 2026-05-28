import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { CliStats } from './components/CliStats';
import { CliWorkLog } from './components/CliWorkLog';
import { AgentCard } from './components/AgentCard';
import { JobCard } from './components/JobCard';
import { ConductorGate } from './components/ConductorGate';
import type { AgentKey } from '../../api/types';

const KNOWN_AGENTS: AgentKey[] = ['reframe', 'question', 'research', 'design', 'plan', 'integrator', 'frontend', 'backend', 'test-writer', 'reviewer', 'tech-writer'];
import { PlanModal } from './components/PlanModal';
import { PlanReviewModal } from './components/PlanReviewModal';
import { ActionGateModal } from './components/ActionGateModal';
import { ImprovementsDrawer } from './components/ImprovementsDrawer';

export function ArbiterTab() {
  const {
    isConnected,
    lastUpdated,
    arbiterState,
    agentData,
    cliStats,
    showCompleted,
    toggleShowCompleted,
    openModal,
    setOpenModal,
    activeConductorGate,
    conductorSessions,
    openConductorGate,
  } = useAppStore(useShallow((s) => ({
    isConnected: s.isConnected,
    lastUpdated: s.lastUpdated,
    arbiterState: s.arbiterState,
    agentData: s.agentData,
    cliStats: s.cliStats,
    showCompleted: s.showCompleted,
    toggleShowCompleted: s.toggleShowCompleted,
    openModal: s.openModal,
    setOpenModal: s.setOpenModal,
    activeConductorGate: s.activeConductorGate,
    conductorSessions: s.conductorSessions,
    openConductorGate: s.openConductorGate,
  })));

  const pendingGates = arbiterState.pending_gates ?? [];
  const allJobs = arbiterState.jobs ?? [];
  const activeJobs = allJobs.filter((j) => !['done', 'merged', 'shipped'].includes(j.status));
  const doneJobs = allJobs.filter((j) => ['done', 'merged', 'shipped'].includes(j.status));

  const updatedStr = lastUpdated
    ? lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : 'not connected';

  return (
    <div className="tab-pane-content">
      {/* Pending gate notification banner */}
      {pendingGates.length > 0 && !activeConductorGate && (
        <div className="gate-pending-banner">
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

      {/* Top dashboard: stats */}
      {(cliStats || allJobs.some((j) => (j.stage_history ?? []).length > 0)) && (
        <div className="top-dash">
          <CliStats jobs={allJobs} />
          <CliWorkLog jobs={allJobs} cliStats={cliStats} />
        </div>
      )}

      {/* Agent Activity */}
      <div className="section-hdr">
        <span className="section-title">Agent Activity</span>
        <span className="section-sub">Launch a CLI or send it a message</span>
      </div>
      <div className="agent-grid">
        {KNOWN_AGENTS.map((key) => (
          <AgentCard key={key} agentKey={key} data={agentData[key] ?? null} />
        ))}
      </div>

      {/* Job Pipeline */}
      <div className="section-hdr" style={{ marginTop: 18 }}>
        <span className="section-title">Job Pipeline</span>
        <span className="section-sub">
          {activeJobs.length} active{doneJobs.length > 0 ? ` · ${doneJobs.length} merged` : ''}
        </span>
        <button className="plan-btn" onClick={() => setOpenModal('plan')}>+ Plan Task</button>
        {doneJobs.length > 0 && (
          <button className="completed-toggle" onClick={toggleShowCompleted}>
            {showCompleted ? '▲ Hide' : '▼ Show'} merged ({doneJobs.length})
          </button>
        )}
        <span className="section-ts" style={{ marginLeft: 'auto' }}>
          {isConnected ? `updated ${updatedStr}` : 'not connected'}
        </span>
      </div>

      <div className="job-flows">
        {activeJobs.length === 0 && doneJobs.length === 0 && (
          <div className="empty-state">No jobs yet — click + Plan Task to get started</div>
        )}
        {activeJobs.map((job) => <JobCard key={job.id} job={job} />)}
        {showCompleted && doneJobs.map((job) => <JobCard key={job.id} job={job} />)}
      </div>

      {/* Improvements button (fixed) */}
      <button className="imp-sidebar-btn" onClick={() => setOpenModal('improvements')}>
        🔧<span>Improvements</span>
      </button>

      {/* Modals */}
      {openModal === 'plan'        && <PlanModal />}
      {openModal === 'planReview'  && <PlanReviewModal />}
      {(arbiterState.pending_approval || arbiterState.question) && <ActionGateModal />}
      {openModal === 'improvements' && <ImprovementsDrawer />}

      {/* Conductor gate overlay — shown when pipeline pauses at a human gate */}
      {activeConductorGate && conductorSessions[activeConductorGate.taskId] && (
        <ConductorGate
          taskId={activeConductorGate.taskId}
          gate={activeConductorGate.gate}
          session={conductorSessions[activeConductorGate.taskId]}
        />
      )}
    </div>
  );
}
