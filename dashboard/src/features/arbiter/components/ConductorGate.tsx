import { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import styles from './ConductorGate.module.css';
import type { GateName, ConductorSession } from '../../../api/types';
import { DEFAULT_ARBITER_CONFIG } from '../../../api/types';

const FALLBACK_LABELS: Record<GateName, string> = {
  discovery: 'Gate 1 — Discovery Review',
  design:    'Gate 2 — Design Review',
  frontend:  'Gate 3 — Frontend Review',
  schema:    'Schema Gate',
};

const FALLBACK_DESCRIPTIONS: Record<GateName, string> = {
  discovery: 'Review what the agents understood about this task before design begins.',
  design:    'Review the design and schema decisions before implementation starts.',
  frontend:  'Test the UI and confirm it\'s ready before backend and tests run.',
  schema:    'Review the database schema changes.',
};

interface Props {
  taskId: string;
  gate: GateName;
  session: ConductorSession;
}

export function ConductorGate({ taskId, gate, session }: Props) {
  const {
    liveApi,
    settings,
    sendConductorMsg,
    approveConductorGate,
    showToast,
    conductorArtifacts,
    arbiterConfig,
  } = useAppStore(useShallow((s) => ({
    liveApi: s.liveApi,
    settings: s.settings,
    sendConductorMsg: s.sendConductorMsg,
    approveConductorGate: s.approveConductorGate,
    showToast: s.showToast,
    conductorArtifacts: s.conductorArtifacts,
    arbiterConfig: s.arbiterConfig,
  })));

  const configGates = (arbiterConfig ?? DEFAULT_ARBITER_CONFIG).gates;
  const GATE_LABELS: Record<string, string> = {
    ...FALLBACK_LABELS,
    ...Object.fromEntries(configGates.map((g) => [g.key, g.label])),
  };
  const GATE_DESCRIPTIONS: Record<string, string> = {
    ...FALLBACK_DESCRIPTIONS,
    ...Object.fromEntries(configGates.map((g) => [g.key, g.description])),
  };

  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [selectedArtifact, setSelectedArtifact] = useState<string | null>(null);
  const [artifactExpanded, setArtifactExpanded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const artifacts = conductorArtifacts[taskId] ?? {};
  const artifactNames = Object.keys(artifacts);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [session.messages]);

  // Auto-focus input when gate opens
  useEffect(() => {
    if (session.messages.length === 0) {
      // Trigger opening briefing on first render
      handleOpeningBriefing();
    }
    inputRef.current?.focus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleOpeningBriefing() {
    if (!settings.anthropicApiKey) return;
    if (session.messages.length > 0) return;
    setSending(true);
    try {
      await sendConductorMsg(taskId, gate, '');
    } finally {
      setSending(false);
    }
  }

  async function handleSend() {
    const text = inputText.trim();
    if (!text || sending) return;
    setInputText('');
    setSending(true);
    try {
      await sendConductorMsg(taskId, gate, text);
    } catch (err) {
      showToast('Failed to send message — check your API key in settings');
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  async function handleApprove() {
    if (!session.all_resolved) return;
    setShowConfirm(false);
    try {
      await approveConductorGate(taskId, gate);
      showToast(`Gate ${gate} approved — pipeline continuing`);
    } catch {
      showToast('Failed to write approval — check your connection');
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const hasApiKey = Boolean(settings.anthropicApiKey);

  return (
    <div className={styles.overlay}>
      <div className={styles.panel}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.gateTag}>⚡ {GATE_LABELS[gate]}</span>
            <span className={styles.gateDesc}>{GATE_DESCRIPTIONS[gate]}</span>
          </div>
          <div className={styles.headerRight}>
            <span className={styles.taskId}>{taskId}</span>
          </div>
        </div>

        <div className={styles.body}>
          {/* Left: Artifacts panel */}
          <div className={styles.artifactsPane}>
            <div className={styles.artifactsHeader}>Artifacts</div>
            {artifactNames.length === 0 ? (
              <div className={styles.noArtifacts}>No artifacts loaded yet.</div>
            ) : (
              <div className={styles.artifactList}>
                {artifactNames.map((name) => (
                  <button
                    key={name}
                    className={`${styles.artifactBtn} ${selectedArtifact === name ? styles.artifactBtnActive : ''}`}
                    onClick={() => {
                      if (selectedArtifact === name) {
                        setArtifactExpanded((v) => !v);
                      } else {
                        setSelectedArtifact(name);
                        setArtifactExpanded(true);
                      }
                    }}
                  >
                    <span className={styles.artifactIcon}>📄</span>
                    <span className={styles.artifactName}>{name}</span>
                    <span className={styles.artifactChevron}>{selectedArtifact === name && artifactExpanded ? '▲' : '▶'}</span>
                  </button>
                ))}
              </div>
            )}

            {selectedArtifact && artifactExpanded && artifacts[selectedArtifact] && (
              <div className={styles.artifactContent}>
                <div className={styles.artifactContentHeader}>
                  <span>{selectedArtifact}</span>
                  <button className={styles.closeArtifact} onClick={() => setArtifactExpanded(false)}>✕</button>
                </div>
                <pre className={styles.artifactPre}>{artifacts[selectedArtifact]}</pre>
              </div>
            )}

            {/* Open items */}
            {session.open_items.length > 0 && (
              <div className={styles.openItems}>
                <div className={styles.openItemsHeader}>Open items</div>
                {session.open_items.map((item) => (
                  <div key={item.id} className={`${styles.openItem} ${item.resolved ? styles.openItemDone : ''}`}>
                    <span className={styles.openItemDot}>{item.resolved ? '✓' : '○'}</span>
                    <span className={styles.openItemText}>{item.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right: Chat panel */}
          <div className={styles.chatPane}>
            {!hasApiKey && (
              <div className={styles.noApiKey}>
                ⚠ No API key — add your Anthropic API key in Settings to chat with the Conductor.
              </div>
            )}

            <div className={styles.messages}>
              {session.messages.length === 0 && !sending && (
                <div className={styles.emptyChat}>
                  {hasApiKey
                    ? 'Starting briefing…'
                    : 'Add an API key to start the conductor briefing.'}
                </div>
              )}
              {session.messages.map((msg, i) => (
                <div key={i} className={`${styles.bubble} ${msg.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant}`}>
                  <div className={styles.bubbleRole}>{msg.role === 'user' ? 'You' : 'Conductor'}</div>
                  <div className={styles.bubbleText}>{msg.content}</div>
                </div>
              ))}
              {sending && (
                <div className={`${styles.bubble} ${styles.bubbleAssistant}`}>
                  <div className={styles.bubbleRole}>Conductor</div>
                  <div className={`${styles.bubbleText} ${styles.typing}`}>
                    <span>•</span><span>•</span><span>•</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input area */}
            <div className={styles.inputArea}>
              <textarea
                ref={inputRef}
                className={styles.textarea}
                rows={2}
                placeholder={hasApiKey ? 'Ask the conductor anything…' : 'Add API key in Settings first'}
                value={inputText}
                disabled={!hasApiKey || sending}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <div className={styles.inputActions}>
                <button
                  className={styles.sendBtn}
                  disabled={!hasApiKey || !inputText.trim() || sending}
                  onClick={handleSend}
                >
                  Send
                </button>
                <button
                  className={`${styles.approveBtn} ${session.all_resolved ? styles.approveBtnReady : styles.approveBtnDisabled}`}
                  disabled={!session.all_resolved}
                  title={session.all_resolved ? 'All items resolved — click to approve' : 'Chat with the conductor until all items are resolved'}
                  onClick={() => setShowConfirm(true)}
                >
                  ✅ Approve
                </button>
              </div>
              {!session.all_resolved && session.messages.length > 0 && (
                <div className={styles.resolveHint}>
                  Chat until the conductor marks everything resolved before approving.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Confirm dialog */}
      {showConfirm && (
        <div className={styles.confirmOverlay} onClick={(e) => e.target === e.currentTarget && setShowConfirm(false)}>
          <div className={styles.confirmDialog}>
            <div className={styles.confirmTitle}>Are you sure?</div>
            <div className={styles.confirmBody}>
              Approving <strong>{GATE_LABELS[gate]}</strong> will advance the pipeline to the next phase.
              This cannot be undone.
            </div>
            <div className={styles.confirmActions}>
              <button className={styles.confirmApprove} onClick={handleApprove}>
                Yes, approve and continue
              </button>
              <button className={styles.confirmCancel} onClick={() => setShowConfirm(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
