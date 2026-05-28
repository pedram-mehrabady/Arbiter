import { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { AgentCard } from '../arbiter/components/AgentCard';
import { CliStats } from '../arbiter/components/CliStats';
import { CliWorkLog } from '../arbiter/components/CliWorkLog';
import { EndpointsTable } from './sections/EndpointsTable';
import { DbActivityGrid } from './sections/DbActivityGrid';
import { ServiceMap } from './sections/ServiceMap';
import { ModuleGraph } from './sections/ModuleGraph';
import type { AgentKey } from '../../api/types';
import { getDeveloperName } from '../../lib/developer';
import styles from './ReportsView.module.css';

const AGENTS_FALLBACK: AgentKey[] = ['reframe', 'research', 'design', 'plan', 'integrator', 'frontend', 'backend', 'test-writer', 'reviewer', 'tech-writer'];
type SubTab = 'overview' | 'endpoints' | 'db' | 'service-map' | 'module-graph';

const SUB_TABS: { key: SubTab; label: string }[] = [
  { key: 'overview',      label: 'Overview'      },
  { key: 'endpoints',     label: 'Endpoints'     },
  { key: 'db',            label: 'DB Activity'   },
  { key: 'service-map',   label: 'Service Map'   },
  { key: 'module-graph',  label: 'Module Graph'  },
];

export function ReportsView() {
  const [tab, setTab] = useState<SubTab>('overview');
  const { agentData, jobs, cliStats, agentsConfig } = useAppStore(useShallow((s) => ({
    agentData:   s.agentData,
    jobs:        s.arbiterState.jobs,
    agentsConfig: s.agentsConfig,
    cliStats:  s.cliStats,
  })));
  const AGENTS: AgentKey[] = agentsConfig
    ? (agentsConfig.agents
        .filter((a) => a.phase !== 'Scheduled')
        .map((a) => a.key) as AgentKey[])
    : AGENTS_FALLBACK;

  const hasHistory = jobs.some((j) => (j.stage_history ?? []).length > 0);
  const devName = getDeveloperName();

  return (
    <div className={styles.shell}>
      <nav className={styles.subNav}>
        {SUB_TABS.map((t) => (
          <button
            key={t.key}
            className={`${styles.subBtn}${tab === t.key ? ' ' + styles.subBtnActive : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
        {devName && (
          <span className={styles.devBadge}>👤 {devName}</span>
        )}
      </nav>

      <div className={styles.content}>
        {tab === 'overview' && (
          <div className={styles.overviewGrid}>
            {/* Agents row — spans full width */}
            <div className={styles.card}>
              <div className={styles.cardTitle}>Pipeline Agents</div>
              <div className={styles.agentsGrid}>
                {AGENTS.map((key) => (
                  <AgentCard key={key} agentKey={key} data={agentData[key] ?? null} />
                ))}
              </div>
            </div>

            {/* Conductor & Gates */}
            <div className={styles.card}>
              <div className={styles.cardTitle}>Conductor &amp; Human Gates</div>
              <div className={styles.gateList}>
                {([
                  { name: 'Gate 1 — Discovery', phase: 'After research · before design', desc: 'Review what the agents understood. Chat with the Conductor to resolve all open items before design begins.' },
                  { name: 'Gate 2 — Design', phase: 'After integrator · before plan', desc: 'Review the UX, API contracts, DB schema, and integration plan. Point-of-no-return for architecture.' },
                  { name: 'Gate 3 — Frontend', phase: 'After frontend agent · before backend', desc: 'Test the rendered UI. Conductor presents the screens; approve only when the UI fully matches the spec.' },
                  { name: 'Schema Gate', phase: 'Before backend · DB changes only', desc: 'Review the Mermaid ER diagram and migration plan before any migration is written.' },
                ] as const).map((g) => (
                  <div key={g.name} className={styles.gateRow}>
                    <div className={styles.gateIcon}>⚡</div>
                    <div className={styles.gateBody}>
                      <div className={styles.gateName}>{g.name}</div>
                      <div className={styles.gatePhase}>{g.phase}</div>
                      <div className={styles.gateDesc}>{g.desc}</div>
                    </div>
                  </div>
                ))}
                <p className={styles.gateFootnote}>
                  The Conductor is a persistent LLM session that carries context across all 3 gates for a task.
                  It auto-opens in the Pipeline tab when a gate is reached. Approve only activates once the Conductor marks all items resolved.
                </p>
              </div>
            </div>

            {/* Work Log + CLI Stats side-by-side */}
            <div className={styles.card}>
              <div className={styles.cardTitle}>Work Log</div>
              {cliStats || hasHistory
                ? <CliWorkLog jobs={jobs} cliStats={cliStats} />
                : <p className={styles.empty}>Time tracking will appear as CLIs run</p>}
            </div>
            <div className={styles.card}>
              <div className={styles.cardTitle}>CLI Stats</div>
              {hasHistory
                ? <CliStats jobs={jobs} />
                : <p className={styles.empty}>No stage history yet</p>}
            </div>
          </div>
        )}

        {tab === 'endpoints' && (
          <div className={styles.singleCol}>
            <EndpointsTable />
          </div>
        )}

        {tab === 'db' && (
          <div className={styles.singleCol}>
            <DbActivityGrid />
          </div>
        )}

        {tab === 'service-map' && (
          <div className={styles.fullHeight}>
            <ServiceMap />
          </div>
        )}

        {tab === 'module-graph' && (
          <div className={styles.fullHeight}>
            <ModuleGraph />
          </div>
        )}
      </div>
    </div>
  );
}
