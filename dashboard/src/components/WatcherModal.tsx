import { useAppStore } from '../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { shellCmd, fswatchHint } from '../lib/osCmd';
import styles from './WatcherModal.module.css';

export function WatcherModal() {
  const { openModal, setOpenModal, settings } = useAppStore(useShallow((s) => ({
    openModal: s.openModal,
    setOpenModal: s.setOpenModal,
    settings: s.settings,
  })));

  if (openModal !== 'watcher') return null;

  const path = settings.repoPath || '/path/to/foederata';
  const rawCmd = `${path}/scripts/start-arbiter-watcher.sh`;
  const cmd = shellCmd(rawCmd, settings.os);
  const hint = fswatchHint(settings.os);

  async function copy() {
    await navigator.clipboard.writeText(cmd);
  }

  return (
    <div className="modal-overlay" onClick={() => setOpenModal(null)}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-hdr">
          <div>
            <div className="modal-title">⚡ Start the Arbiter watcher</div>
            <div className="modal-sub">Run once in any Terminal tab — leave it running in the background</div>
          </div>
          <button className="modal-close" onClick={() => setOpenModal(null)}>✕</button>
        </div>
        <div className="modal-body">
          <div className={styles.step}>
            <span className={styles.stepNum}>1</span>
            <span>Open a new Terminal tab and run this command:</span>
          </div>
          <div className={styles.cmdWrap}>
            <code className={styles.cmd}>{cmd}</code>
            <button className={styles.copyBtn} onClick={copy}>Copy</button>
          </div>
          <div className={styles.step} style={{ marginTop: 14 }}>
            <span className={styles.stepNum}>2</span>
            <span>Leave it running. Every ▶ Launch click in Arbiter opens a new Terminal tab instantly.</span>
          </div>
          {hint && (
            <div className="callout" style={{ marginTop: 14 }}>
              💡 For instant response instead of 1-second polling: <code>{hint}</code>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
