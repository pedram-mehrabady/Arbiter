import { useAppStore } from '../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import styles from './TopBar.module.css';

interface Props {
  onOpenProfile: () => void;
}

export function TopBar({ onOpenProfile }: Props) {
  const { isConnected, setOpenModal, settings } = useAppStore(useShallow((s) => ({
    isConnected:  s.isConnected,
    setOpenModal: s.setOpenModal,
    settings:     s.settings,
  })));

  return (
    <div className={styles.bar}>
      <div className={styles.left}>
        <span className={styles.title}>Arbiter Pipeline</span>
        {isConnected && settings.repoPath && (
          <span className={styles.sub}>{settings.repoPath.split('/').pop()}</span>
        )}
      </div>

      <div className={styles.center}>
        <button className={styles.watcherPill} onClick={() => useAppStore.getState().setOpenModal('watcher')}>
          <span className={styles.watcherDot} />
          How to start Arbiter — run once to enable ▶ Launch
          <span className={styles.watcherArrow}>›</span>
        </button>
      </div>

      <div className={styles.right}>
        <div className={`${styles.status}${isConnected ? ' ' + styles.connected : ''}`}>
          <span className={styles.statusDot} />
          {isConnected ? 'connected' : 'not connected'}
        </div>
        <button
          className={styles.connectBtn}
          onClick={isConnected ? () => setOpenModal('connect') : onOpenProfile}
        >
          {isConnected ? '⚙ Settings' : 'Connect repo →'}
        </button>
      </div>
    </div>
  );
}
