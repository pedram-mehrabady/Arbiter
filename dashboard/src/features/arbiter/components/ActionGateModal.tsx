import { useState } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import styles from './ActionGateModal.module.css';

const STATUS_ICON: Record<string, string> = { pass: '✅', warn: '⚠', fail: '❌' };

export function ActionGateModal() {
  const { arbiterState, liveApi, showToast, dismissedGateIds, dismissGate } = useAppStore(useShallow((s) => ({
    arbiterState: s.arbiterState,
    liveApi: s.liveApi,
    showToast: s.showToast,
    dismissedGateIds: s.dismissedGateIds,
    dismissGate: s.dismissGate,
  })));

  const rawApproval = arbiterState.pending_approval ?? null;
  const rawQuestion = arbiterState.question ?? null;
  const approval = rawApproval && !dismissedGateIds.includes(rawApproval.id) ? rawApproval : null;
  const question = rawQuestion && !dismissedGateIds.includes(rawQuestion.id) ? rawQuestion : null;

  const [freeText, setFreeText] = useState('');
  const [busy, setBusy] = useState(false);

  if (!approval && !question) return null;

  const gateId = approval?.id ?? question?.id ?? 'unknown';

  const sendResponse = async (value: string) => {
    setBusy(true);
    try {
      if (liveApi) await liveApi.writeResponse(gateId, value);
      showToast(liveApi ? 'Response sent — pipeline continuing' : 'Dismissed (not connected)');
    } catch {
      showToast('Failed to write response — dismissed locally');
    } finally {
      setBusy(false);
      dismissGate(gateId); // close it and keep it closed across polls
    }
  };

  const dismiss = () => dismissGate(gateId);

  if (approval) {
    const items = approval.items ?? [];
    const failCount = items.filter((i) => i.status === 'fail').length;
    const warnCount = items.filter((i) => i.status === 'warn').length;

    const heading = approval.gate_title ?? approval.stage ?? 'Action Required';
    const summary = approval.summary ?? approval.title ?? '';
    const details = approval.details ?? null;
    const brief = approval.links?.brief ?? null;
    const prUrl = approval.links?.pr ?? null;

    return (
      <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && dismiss()}>
        <div className={`modal ${styles.gateModal}`}>
          <div className="modal-hdr">
            <div>
              <div className="modal-title">⚠ Action Required — {heading}</div>
              <div className="modal-sub">Babysitter is waiting for your decision before the pipeline continues</div>
            </div>
            <button className="modal-close" onClick={dismiss}>✕</button>
          </div>
          <div className="modal-body">
            {summary && <div className={styles.summary}>{summary}</div>}

            {items.length > 0 && (
              <div className={styles.checklist}>
                {items.map((item, i) => (
                  <div key={i} className={`${styles.checkItem} ${styles['check_' + item.status]}`}>
                    <span className={styles.checkIcon}>{STATUS_ICON[item.status]}</span>
                    <div>
                      <div className={styles.checkLabel}>{item.label}</div>
                      {item.detail && <div className={styles.checkDetail}>{item.detail}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {details && (
              <div className={styles.checklist}>
                {details.database && (
                  <div className={styles.checkItem}>
                    <span className={styles.checkIcon}>🗄</span>
                    <div>
                      <div className={styles.checkLabel}>Database</div>
                      <div className={styles.checkDetail}>{details.database}</div>
                    </div>
                  </div>
                )}
                {details.complexity && (
                  <div className={styles.checkItem}>
                    <span className={styles.checkIcon}>📊</span>
                    <div>
                      <div className={styles.checkLabel}>Complexity</div>
                      <div className={styles.checkDetail}>{details.complexity}</div>
                    </div>
                  </div>
                )}
                {details.api_endpoints && details.api_endpoints.length > 0 && (
                  <div className={styles.checkItem}>
                    <span className={styles.checkIcon}>🔌</span>
                    <div>
                      <div className={styles.checkLabel}>API Endpoints</div>
                      {details.api_endpoints.map((ep) => (
                        <div key={ep} className={styles.checkDetail}>{ep}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {(brief || prUrl) && (
              <div className={styles.summary}>
                {brief && <div>📄 {brief}</div>}
                {prUrl && <div>🔗 {prUrl}</div>}
              </div>
            )}

            {approval.explanation && (
              <div className={styles.explanation}>{approval.explanation}</div>
            )}

            {approval.warning && (
              <div className={styles.warnNote}>⚠ {approval.warning}</div>
            )}

            <div className={styles.gateActions}>
              {failCount === 0 ? (
                <button className="btn-primary" disabled={busy} onClick={() => sendResponse('approve')}>
                  {approval.approve_label ?? '✅ Approve — Continue Pipeline'}
                </button>
              ) : (
                <div className={styles.blockNote}>
                  🚫 {failCount} check{failCount > 1 ? 's' : ''} failed — fix before approving
                </div>
              )}
              {warnCount > 0 && failCount === 0 && (
                <div className={styles.warnNote}>⚠ {warnCount} warning{warnCount > 1 ? 's' : ''} — review before approving</div>
              )}
              <button className="btn-secondary" disabled={busy} onClick={() => sendResponse('reject')}>
                ✕ Reject — Stop here
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Question mode
  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && dismiss()}>
      <div className={`modal ${styles.gateModal}`}>
        <div className="modal-hdr">
          <div>
            <div className="modal-title">❓ Decision Needed</div>
            <div className="modal-sub">Babysitter is waiting for your decision before the pipeline continues</div>
          </div>
          <button className="modal-close" onClick={dismiss}>✕</button>
        </div>
        <div className="modal-body">
          <div className={styles.question}>{question!.question}</div>
          {question!.why_asking && (
            <div className={styles.whyAsking}>Why: {question!.why_asking}</div>
          )}

          {question!.options && question!.options.length > 0 && (
            <div className={styles.options}>
              {question!.options.map((opt) => (
                <button
                  key={opt.value}
                  className={`btn-secondary ${styles.optionBtn}`}
                  disabled={busy}
                  onClick={() => sendResponse(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {question!.allow_free_text && (
            <div className={styles.freeTextWrap}>
              <textarea
                className="arbiter-textarea"
                rows={3}
                placeholder="Type your answer…"
                value={freeText}
                onChange={(e) => setFreeText(e.target.value)}
              />
              <div className="widget-row">
                <button className="btn-primary" disabled={busy || !freeText.trim()} onClick={() => sendResponse(freeText)}>
                  Send Answer
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
