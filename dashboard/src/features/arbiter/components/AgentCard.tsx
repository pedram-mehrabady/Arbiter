import { useAppStore } from '../../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import type { AgentData } from '../../../api/types';
import styles from './AgentCard.module.css';

const AGENT_META: Record<string, { label: string; emoji: string; color: string }> = {
  reframe:        { label: 'reframe',      emoji: '🔍', color: styles.colorFront   },
  question:       { label: 'question',     emoji: '❓', color: styles.colorFront   },
  research:       { label: 'research',     emoji: '📚', color: styles.colorFront   },
  design:         { label: 'design',       emoji: '🎨', color: styles.colorPush    },
  plan:           { label: 'plan',         emoji: '📋', color: styles.colorPush    },
  integrator:     { label: 'integrator',   emoji: '🔗', color: styles.colorBackend },
  frontend:       { label: 'frontend',     emoji: '⚛️', color: styles.colorFront   },
  backend:        { label: 'backend',      emoji: '⚙️', color: styles.colorBackend },
  'test-writer':  { label: 'test-writer',  emoji: '🧪', color: styles.colorPush    },
  debugger:       { label: 'debugger',     emoji: '🐛', color: styles.colorBackend },
  reviewer:       { label: 'reviewer',     emoji: '🔎', color: styles.colorPush    },
  'tech-writer':  { label: 'tech-writer',  emoji: '📝', color: styles.colorFront   },
  surveyor:       { label: 'surveyor',     emoji: '📊', color: styles.colorBackend },
};

function elapsedStr(startedAt: string) {
  const secs = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  if (secs < 60) return secs + 's';
  if (secs < 3600) return Math.floor(secs / 60) + 'm';
  return Math.floor(secs / 3600) + 'h ' + Math.floor((secs % 3600) / 60) + 'm';
}

interface Props { agentKey: string; data: AgentData | null; }

export function AgentCard({ agentKey, data }: Props) {
  const { sendAgentMessage } = useAppStore(useShallow((s) => ({
    sendAgentMessage: s.sendAgentMessage,
  })));

  const meta = AGENT_META[agentKey] ?? { label: agentKey, emoji: '🤖', color: styles.colorFront };
  const isWorking = data?.status === 'working';

  async function handleSend(msg: string) {
    if (!msg.trim()) return;
    await sendAgentMessage(agentKey, msg);
  }

  return (
    <div className={`${styles.card}${isWorking ? ' ' + styles.working : ''}`}>
      <div className={styles.hdr}>
        <span className={`${styles.dot} ${isWorking ? styles.dotWorking : styles.dotIdle}`} />
        <span className={`${styles.name} ${meta.color}`}>{meta.emoji} {meta.label}</span>
        <span className={`${styles.badge} ${isWorking ? styles.badgeWorking : styles.badgeIdle}`}>
          {isWorking ? 'Working' : 'Idle'}
        </span>
      </div>
      {data?.module && (
        <div className={styles.module}>{data.module}{data.phase ? ` · ${data.phase}` : ''}</div>
      )}
      <div className={styles.task}>{data?.task ?? 'Waiting for task'}</div>
      {isWorking && data?.started_at && (
        <div className={styles.elapsed}>⏱ {elapsedStr(data.started_at)} ago</div>
      )}
      <div className={styles.msgRow}>
        <input
          className={styles.msgInput}
          type="text"
          placeholder={`Message to ${meta.label}…`}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const t = e.currentTarget;
              handleSend(t.value).then(() => { t.value = ''; });
            }
          }}
        />
        <button
          className={styles.sendBtn}
          onClick={(e) => {
            const inp = (e.currentTarget.previousSibling as HTMLInputElement);
            handleSend(inp.value).then(() => { inp.value = ''; });
          }}
        >Send</button>
      </div>
    </div>
  );
}
