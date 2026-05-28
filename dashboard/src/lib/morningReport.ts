import type { DayActivity } from './activityLog';
import type { CliStatEntry } from '../api/types';

function fmtDur(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  if (m > 0) return `${m}m`;
  return '<1m';
}

function fmtDate(dateStr: string): string {
  // Parse as local date to avoid timezone shift
  const [y, mo, d] = dateStr.split('-').map(Number);
  const date = new Date(y, mo - 1, d);
  return date.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

export function buildMessage(activity: DayActivity): string {
  if (activity.snapshots.length === 0) return '';

  // Use the last snapshot — it has the day's final totals
  const snap = activity.snapshots[activity.snapshots.length - 1];
  const { cliStats, jobTitles, jobsCompleted, jobsMerged } = snap;

  const cliEntries = Object.entries(cliStats) as [string, CliStatEntry][];
  const totalDuration = cliEntries.reduce((s, [, e]) => s + e.total_duration_s, 0);
  const totalSessions = cliEntries.reduce((s, [, e]) => s + e.total_sessions, 0);

  const hasActivity = totalSessions > 0 || jobTitles.length > 0;
  if (!hasActivity) return '';

  const cliLines = cliEntries.length > 0
    ? cliEntries
        .map(([agent, e]) => `• ${agent}: ${e.total_sessions} sessions · ${fmtDur(e.total_duration_s)}`)
        .join('\n')
    : '• No CLI sessions recorded';

  const jobLines = jobTitles.length > 0
    ? jobTitles.map((t) => `• ${t}`).join('\n')
    : '• No completed jobs';

  const intensity = totalDuration > 7 * 3600 ? '🔥' : totalDuration > 3 * 3600 ? '💪' : '📊';

  return `${intensity} *Daily Report — ${activity.developer}*
📅 ${fmtDate(activity.date)}

🤖 *CLI Sessions*
${cliLines}

📋 *Jobs Completed* (${jobsCompleted} done, ${jobsMerged} merged)
${jobLines}

📈 *Total: ${totalSessions} sessions · ${fmtDur(totalDuration)} agent time*`;
}

// Sends via the local Vite dev-server proxy (keeps token server-side)
export async function sendMorningReport(text: string): Promise<boolean> {
  try {
    const res = await fetch('/api/morning-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const json = (await res.json()) as { ok: boolean };
    return json.ok === true;
  } catch {
    return false;
  }
}
