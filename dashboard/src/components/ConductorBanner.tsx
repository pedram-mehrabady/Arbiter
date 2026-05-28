import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../store/useAppStore';
import css from './ConductorBanner.module.css';

type ConductorState = 'checking' | 'not-running' | 'starting' | 'timeout' | 'running' | 'confirmed';

const START_TIMEOUT_MS = 20_000;

export function ConductorBanner() {
  const isConnected = useAppStore((s) => s.isConnected);
  const [state, setState] = useState<ConductorState>('checking');
  const intervalRef    = useRef<ReturnType<typeof setInterval>  | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout>  | null>(null);
  const startTimerRef  = useRef<ReturnType<typeof setTimeout>  | null>(null);

  const checkStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/process-status');
      if (!r.ok) return;
      const { running } = (await r.json()) as { running: boolean };
      setState((prev) => {
        if (running) {
          // Clear the 20s timeout — it came online in time
          if (startTimerRef.current) { clearTimeout(startTimerRef.current); startTimerRef.current = null; }
          if (prev === 'starting' || prev === 'not-running' || prev === 'timeout') return 'confirmed';
          if (prev === 'confirmed') return 'confirmed';
          return 'running';
        }
        if (prev === 'starting' || prev === 'timeout') return prev; // keep waiting / keep showing timeout
        return 'not-running';
      });
    } catch { /* server not ready yet */ }
  }, []);

  useEffect(() => {
    if (!isConnected) {
      setState('checking');
      return;
    }
    checkStatus();
    intervalRef.current = setInterval(checkStatus, 5000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isConnected, checkStatus]);

  // When confirmed running → green flash for 4 s then hide
  useEffect(() => {
    if (state !== 'confirmed') return;
    confirmTimerRef.current = setTimeout(() => setState('running'), 4000);
    return () => { if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current); };
  }, [state]);

  const handleStart = async () => {
    setState('starting');
    // If not online within 20 s, show the retry message
    if (startTimerRef.current) clearTimeout(startTimerRef.current);
    startTimerRef.current = setTimeout(() => {
      setState((prev) => prev === 'starting' ? 'timeout' : prev);
    }, START_TIMEOUT_MS);
    try {
      await fetch('/api/start-conductor', { method: 'POST' });
    } catch { /* will detect via polling */ }
  };

  if (!isConnected) return null;
  if (state === 'checking' || state === 'running') return null;

  if (state === 'confirmed') {
    return (
      <div className={`${css.banner} ${css.bannerOk}`}>
        <span className={css.dotOk} />
        <span className={css.msg}>Conductor is running — factory.sh is active</span>
      </div>
    );
  }

  if (state === 'starting') {
    return (
      <div className={`${css.banner} ${css.bannerWaiting}`}>
        <span className={css.spinner} />
        <span className={css.msg}>Starting conductor… waiting for factory.sh to come online</span>
      </div>
    );
  }

  if (state === 'timeout') {
    return (
      <div className={`${css.banner} ${css.bannerTimeout}`}>
        <span className={css.dotWarn} />
        <div className={css.left}>
          <span className={css.titleTimeout}>Conductor did not start within 20 seconds</span>
          <span className={css.sub}>
            The terminal window may not have opened, or factory.sh exited immediately.
            Check the terminal for errors, then try again.
          </span>
        </div>
        <button className={css.startBtn} onClick={handleStart}>
          ↺ Try again
        </button>
      </div>
    );
  }

  // not-running
  return (
    <div className={`${css.banner} ${css.bannerWarn}`}>
      <span className={css.dotWarn} />
      <div className={css.left}>
        <span className={css.title}>Conductor is not running</span>
        <span className={css.sub}>
          factory.sh must be running to process tasks. Click to open a terminal and start it.
        </span>
      </div>
      <button className={css.startBtn} onClick={handleStart}>
        ▶ Start factory.sh
      </button>
    </div>
  );
}
