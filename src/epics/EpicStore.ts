import fs from 'node:fs/promises';
import path from 'node:path';

// Epic → Story → Task hierarchy.
// Epic: the big brief (arbiter/epics/<id>/epic.md + epic.json).
// Story: a coherent chunk (≈ a doc section), grouping Tasks.
// Task: the existing executable unit (arbiter/tasks/<id>/) + a meta.json linking it up.

export interface Story { id: string; title: string; traces: string[]; taskIds: string[] }
export interface Epic { id: string; title: string; createdAt: string; stories: Story[] }
export interface TaskMeta { epicId?: string; storyId?: string; traces?: string[] }

export interface StoryRollup { id: string; title: string; total: number; done: number; pct: number }
export interface EpicRollup { id: string; title: string; total: number; done: number; pct: number; stories: StoryRollup[] }

function slug(s: string, max = 16): string {
  return s.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, max) || 'EPIC';
}
function shortId(): string { return Date.now().toString(36).slice(-5).toUpperCase(); }

/** Split a markdown doc into sections by `#`/`##` headings. Falls back to one "Main" section. */
function splitByHeadings(doc: string): Array<{ title: string; body: string }> {
  const lines = doc.split('\n');
  const sections: Array<{ title: string; body: string[] }> = [];
  for (const line of lines) {
    const h = line.match(/^#{1,3}\s+(.+)$/);
    if (h) sections.push({ title: h[1].trim(), body: [] });
    else if (sections.length) sections[sections.length - 1].body.push(line);
  }
  // Drop the top-level title section if it has no body and there are deeper sections.
  const filled = sections.filter(s => s.body.join('').trim().length > 0);
  const use = filled.length ? filled : sections;
  if (!use.length) return [{ title: 'Main', body: doc.trim() }];
  return use.map(s => ({ title: s.title, body: s.body.join('\n').trim() }));
}

const epicsDir = (root: string) => path.join(root, 'arbiter', 'epics');

export async function createEpic(root: string, title: string, doc: string): Promise<string> {
  const id = `EPIC-${slug(title)}-${shortId()}`;
  const dir = path.join(epicsDir(root), id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'epic.md'), `# ${title}\n\n${doc.trim()}\n`, 'utf-8');
  const epic: Epic = { id, title, createdAt: new Date().toISOString(), stories: [] };
  await fs.writeFile(path.join(dir, 'epic.json'), JSON.stringify(epic, null, 2), 'utf-8');
  return id;
}

export async function readEpic(root: string, epicId: string): Promise<Epic | null> {
  try { return JSON.parse(await fs.readFile(path.join(epicsDir(root), epicId, 'epic.json'), 'utf-8')); }
  catch { return null; }
}

/**
 * Decompose an Epic's doc into Stories (by heading) and one Task each (heading-based,
 * deterministic — no LLM). Each Task is materialized into arbiter/tasks/<id>/ as a
 * brainstorm idea (ideation state) + a meta.json linking it to its Epic/Story, so it
 * shows on the board and can be promoted into the pipeline. Smart LLM decomposition is
 * a later refinement.
 */
export async function decompose(root: string, epicId: string): Promise<Epic> {
  const dir = path.join(epicsDir(root), epicId);
  const existing = await readEpic(root, epicId);
  if (!existing) throw new Error(`Epic ${epicId} not found`);
  const doc = await fs.readFile(path.join(dir, 'epic.md'), 'utf-8');

  const sections = splitByHeadings(doc);
  const stories: Story[] = [];
  let si = 0;
  for (const sec of sections) {
    si += 1;
    const storyId = `${epicId}-S${si}`;
    const taskId = `${epicId}-S${si}-T1`;
    const taskDir = path.join(root, 'arbiter', 'tasks', taskId);
    await fs.mkdir(taskDir, { recursive: true });
    await fs.writeFile(path.join(taskDir, 'task.md'), `# ${sec.title}\n\n${sec.body}\n`, 'utf-8');
    await fs.writeFile(path.join(taskDir, 'meta.json'), JSON.stringify({ epicId, storyId, traces: [sec.title] } satisfies TaskMeta, null, 2), 'utf-8');
    await fs.writeFile(path.join(taskDir, 'state.json'), JSON.stringify({ task_id: taskId, phase: 'brainstorm', sub_tasks: { ideation: { agent_role: 'ideation', status: 'in_progress' } } }, null, 2), 'utf-8');
    stories.push({ id: storyId, title: sec.title, traces: [sec.title], taskIds: [taskId] });
  }

  const epic: Epic = { ...existing, stories };
  await fs.writeFile(path.join(dir, 'epic.json'), JSON.stringify(epic, null, 2), 'utf-8');
  return epic;
}

/** Is a task fully complete? (state.json with all sub_tasks completed, and not brainstorm-only.) */
async function isTaskDone(root: string, taskId: string): Promise<boolean> {
  try {
    const st = JSON.parse(await fs.readFile(path.join(root, 'arbiter', 'tasks', taskId, 'state.json'), 'utf-8')) as { sub_tasks?: Record<string, { agent_role: string; status: string }> };
    const subs = Object.values(st.sub_tasks ?? {});
    const isPipeline = subs.some(s => s.agent_role !== 'ideation');
    return isPipeline && subs.length > 0 && subs.every(s => s.status === 'completed');
  } catch { return false; }
}

/** List all epics with task-completion rollup per story + epic. */
export async function listEpics(root: string): Promise<EpicRollup[]> {
  let ids: string[] = [];
  try { ids = (await fs.readdir(epicsDir(root), { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name); } catch { return []; }
  const out: EpicRollup[] = [];
  for (const id of ids) {
    const epic = await readEpic(root, id);
    if (!epic) continue;
    const stories: StoryRollup[] = [];
    let total = 0, done = 0;
    for (const s of epic.stories) {
      let sd = 0;
      for (const t of s.taskIds) if (await isTaskDone(root, t)) sd += 1;
      stories.push({ id: s.id, title: s.title, total: s.taskIds.length, done: sd, pct: pct(sd, s.taskIds.length) });
      total += s.taskIds.length; done += sd;
    }
    out.push({ id, title: epic.title, total, done, pct: pct(done, total), stories });
  }
  return out;
}

function pct(done: number, total: number): number { return total > 0 ? Math.round((done / total) * 100) : 0; }
