import type { CliStats, Job } from '../api/types';

export interface DaySnapshot {
  ts: string;
  cliStats: CliStats;
  jobsCompleted: number;
  jobsMerged: number;
  jobTitles: string[];
}

export interface DayActivity {
  developer: string;
  date: string;       // YYYY-MM-DD
  snapshots: DaySnapshot[];
  reportSent: boolean;
}

function storageKey(developer: string, date: string) {
  return `arbiter-act-${developer}-${date}`;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function saveSnapshot(developer: string, cliStats: CliStats | null, jobs: Job[]) {
  const date = todayStr();
  const k = storageKey(developer, date);

  const existing: DayActivity = JSON.parse(localStorage.getItem(k) ?? 'null') ?? {
    developer,
    date,
    snapshots: [],
    reportSent: false,
  };

  const completed = jobs.filter(
    (j) => j.status === 'done' || j.status === 'merged' || j.status === 'shipped',
  );

  // Skip if there is nothing meaningful to record
  const hasCliActivity = cliStats != null && Object.keys(cliStats).length > 0;
  if (!hasCliActivity && completed.length === 0) return;

  // Skip if nothing changed since last snapshot
  const last = existing.snapshots[existing.snapshots.length - 1];
  const sig = JSON.stringify({ cli: cliStats, n: completed.length });
  if (last) {
    const lastSig = JSON.stringify({ cli: last.cliStats, n: last.jobsCompleted });
    if (sig === lastSig) return;
  }

  existing.snapshots.push({
    ts: new Date().toISOString(),
    cliStats: cliStats ?? {},
    jobsCompleted: completed.length,
    jobsMerged: jobs.filter(
      (j) => j.status === 'merged' || j.status === 'shipped',
    ).length,
    jobTitles: completed.map((j) => j.title),
  });

  // Persist — read-only append, never overwrite existing snapshots
  localStorage.setItem(k, JSON.stringify(existing));
}

export function getActivity(developer: string, date: string): DayActivity | null {
  const raw = localStorage.getItem(storageKey(developer, date));
  return raw ? (JSON.parse(raw) as DayActivity) : null;
}

export function markReportSent(developer: string, date: string) {
  const k = storageKey(developer, date);
  const activity = getActivity(developer, date);
  if (!activity) return;
  activity.reportSent = true;
  localStorage.setItem(k, JSON.stringify(activity));
}

// Returns dates that have activity and haven't been reported yet, oldest first
export function getUnsentDates(developer: string): string[] {
  const today = todayStr();
  const dates: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    if (!k.startsWith(`arbiter-act-${developer}-`)) continue;
    const activity = JSON.parse(localStorage.getItem(k)!) as DayActivity;
    if (activity.date === today) continue;         // don't report same day
    if (activity.reportSent) continue;
    if (activity.snapshots.length === 0) continue;
    dates.push(activity.date);
  }
  return dates.sort();
}

// All activity dates for this developer, newest first
export function getAllDates(developer: string): string[] {
  const dates: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    if (k.startsWith(`arbiter-act-${developer}-`)) {
      const activity = JSON.parse(localStorage.getItem(k)!) as DayActivity;
      dates.push(activity.date);
    }
  }
  return dates.sort().reverse();
}
