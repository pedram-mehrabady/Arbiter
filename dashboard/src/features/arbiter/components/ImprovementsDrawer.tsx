import { useState } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import styles from './ImprovementsDrawer.module.css';

const STATUS_LABEL: Record<string, string> = { pending: 'Pending', done: '✓ Done', rejected: '✕ Rejected' };

export function ImprovementsDrawer() {
  const { setOpenModal, arbiterState, showToast, liveApi } = useAppStore(useShallow((s) => ({
    setOpenModal: s.setOpenModal,
    arbiterState: s.arbiterState,
    showToast: s.showToast,
    liveApi: s.liveApi,
  })));

  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const improvements = arbiterState.improvements ?? [];

  const close = () => setOpenModal(null);

  const handleSubmit = async () => {
    if (!input.trim()) return;
    if (!liveApi) {
      showToast('Connect your repo first');
      return;
    }
    setBusy(true);
    try {
      const item = { id: `imp-${Date.now()}`, description: input.trim(), status: 'pending' as const };
      await liveApi.writeImprovementItem(item);
      setInput('');
      showToast('Improvement queued');
    } catch {
      showToast('Failed to save improvement');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && close()}>
      <div className={styles.drawer}>
        <div className={styles.hdr}>
          <div>
            <div className="modal-title">🔧 Pipeline Improvements</div>
            <div className="modal-sub">Not for product features — describe something slow, broken, or missing in the factory itself</div>
          </div>
          <button className="modal-close" onClick={close}>✕</button>
        </div>

        <div className={styles.body}>
          <div className={styles.callout}>
            Examples: "Arbiter-push takes 40 minutes on large test suites",
            "Integration checker misses the DMs→share path",
            "Babysitter spec review item 4 is too vague".
          </div>

          <textarea
            className="arbiter-textarea"
            rows={3}
            placeholder="Describe the issue or improvement..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />

          <div className="widget-row">
            <button className="btn-primary" disabled={busy || !input.trim()} onClick={handleSubmit}>
              Queue Improvement
            </button>
          </div>

          {improvements.length > 0 && (
            <div className={styles.list}>
              {improvements.map((item) => (
                <div key={item.id} className={`${styles.item} ${styles['item_' + item.status]}`}>
                  <span className={styles.itemStatus}>{STATUS_LABEL[item.status] ?? item.status}</span>
                  <span className={styles.itemDesc}>{item.description}</span>
                  {item.affects && <span className={styles.itemAffects}>{item.affects}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
