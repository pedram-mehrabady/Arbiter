import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { getDeveloperName } from '../lib/developer';
import {
  saveSnapshot,
  getUnsentDates,
  getActivity,
  markReportSent,
} from '../lib/activityLog';
import { buildMessage, sendMorningReport } from '../lib/morningReport';

export function useDeveloperActivity() {
  const { cliStats, jobs } = useAppStore(
    useShallow((s) => ({ cliStats: s.cliStats, jobs: s.arbiterState.jobs })),
  );

  const reportAttempted = useRef(false);

  // Persist a snapshot whenever the tracked data changes
  useEffect(() => {
    const dev = getDeveloperName();
    if (!dev) return;
    saveSnapshot(dev, cliStats, jobs);
  }, [cliStats, jobs]);

  // Send unsent days to Telegram once per app session, when online
  useEffect(() => {
    async function tryReport() {
      if (reportAttempted.current) return;
      if (!navigator.onLine) return;
      const dev = getDeveloperName();
      if (!dev) return;

      const unsent = getUnsentDates(dev);
      if (unsent.length === 0) return;

      reportAttempted.current = true;

      for (const date of unsent) {
        const activity = getActivity(dev, date);
        if (!activity) continue;
        const text = buildMessage(activity);
        if (!text) continue;
        const ok = await sendMorningReport(text);
        if (ok) markReportSent(dev, date);
      }
    }

    tryReport();

    const onOnline = () => tryReport();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);
}
