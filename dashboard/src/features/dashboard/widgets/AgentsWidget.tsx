import { useAppStore } from '../../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { AgentCard } from '../../arbiter/components/AgentCard';
import type { AgentKey } from '../../../api/types';
import styles from './AgentsWidget.module.css';

const AGENTS: AgentKey[] = [
  'reframe', 'research', 'design', 'design-critic', 'integrator', 'plan',
  'frontend', 'backend', 'test-writer', 'reviewer', 'tech-writer', 'debugger',
];

export function AgentsWidget() {
  const agentData = useAppStore((s) => s.agentData);
  return (
    <div className={styles.grid}>
      {AGENTS.map((key) => (
        <AgentCard key={key} agentKey={key} data={agentData[key] ?? null} />
      ))}
    </div>
  );
}
