import { useState } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import styles from './ImprovementsWidget.module.css';

const STATUS_LABEL: Record<string, string> = { pending: 'Pending', done: '✓ Done', rejected: '✕ Rejected' };

export function ImprovementsWidget() {
  const { arbiterState, showToast, liveApi } = useAppStore(useShallow((s) => ({
    arbiterState: s.arbiterState,
    showToast: s.showToast,
    liveApi: s.liveApi,
  })));

  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const improvements = arbiterState.improvements ?? [];

  const handleSubmit = async () => {
    if (!input.trim()) return;
    if (!liveApi) { showToast('Connect your repo first'); return; }
    setBusy(true);
    try {
      await liveApi.writeImprovementItem({ id: `imp-${Date.now()}`, description: input.trim(), status: 'pending' });
      setInput('');
      showToast('Improvement queued');
    } catch {
      showToast('Failed to save improvement');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <p className={styles.hint}>
        Factory issues only — slow steps, broken checks, missing automation. Not product features.
      </p>
      <div className={styles.inputRow}>
        <input
          className={styles.input}
          placeholder="Describe the issue…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSubmit()}
        />
        <button className="btn-primary" disabled={busy || !input.trim()} onClick={handleSubmit}>
          Add
        </button>
      </div>
      {improvements.length > 0 && (
        <div className={styles.list}>
          {improvements.map((item) => (
            <div key={item.id} className={`${styles.item} ${styles['item_' + item.status]}`}>
              <span className={styles.itemStatus}>{STATUS_LABEL[item.status] ?? item.status}</span>
              <span className={styles.itemDesc}>{item.description}</span>
            </div>
          ))}
        </div>
      )}
      {improvements.length === 0 && (
        <div className={styles.empty}>No improvements queued yet</div>
      )}
    </div>
  );
}
