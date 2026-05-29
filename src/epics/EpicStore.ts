import fs from 'node:fs/promises';
import path from 'node:path';

// Epic → Story → Task hierarchy.
// Epic: the big brief (arbiter/epics/<id>/epic.md + epic.json).
// Story: a coherent chunk (≈ a doc section), grouping Tasks.
// Task: the existing executable unit (arbiter/tasks/<id>/) + a meta.json linking it up.

export interface Story { id: string; title: string; traces: string[]; taskIds: string[] }
export interface Epic { id: string; title: string; createdAt: string; stories: Story[] }
export interface TaskMeta { epicId?: string; storyId?: string; traces?: string[]; estimate?: number; dependsOn?: string[] }

/** Optional LLM hook for smart decomposition. Returns the model's raw text. */
export interface DecomposeOpts { invoke?: (prompt: string) => Promise<string> }

interface PlanTask { title: string; brief?: string; estimate?: number; dependsOn?: string[] }
interface PlanStory { title: string; traces?: string[]; tasks: PlanTask[] }

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
export async function decompose(root: string, epicId: string, opts: DecomposeOpts = {}): Promise<Epic> {
  const dir = path.join(epicsDir(root), epicId);
  const existing = await readEpic(root, epicId);
  if (!existing) throw new Error(`Epic ${epicId} not found`);
  const doc = await fs.readFile(path.join(dir, 'epic.md'), 'utf-8');

  // Prefer a smart LLM plan; fall back to deterministic heading-based decomposition.
  const plan = (opts.invoke ? await smartPlan(doc, opts.invoke) : null) ?? headingPlan(doc);

  // First pass: assign ids so dependsOn (by task title) can resolve to taskIds.
  const titleToId = new Map<string, string>();
  plan.forEach((story, si) => story.tasks.forEach((t, ti) => titleToId.set(t.title, `${epicId}-S${si + 1}-T${ti + 1}`)));

  const stories: Story[] = [];
  for (let si = 0; si < plan.length; si++) {
    const story = plan[si];
    const storyId = `${epicId}-S${si + 1}`;
    const taskIds: string[] = [];
    for (let ti = 0; ti < story.tasks.length; ti++) {
      const t = story.tasks[ti];
      const taskId = `${epicId}-S${si + 1}-T${ti + 1}`;
      const dependsOn = (t.dependsOn ?? []).map(d => titleToId.get(d)).filter((x): x is string => !!x);
      const meta: TaskMeta = { epicId, storyId, traces: story.traces ?? [story.title], estimate: t.estimate, dependsOn: dependsOn.length ? dependsOn : undefined };
      const taskDir = path.join(root, 'arbiter', 'tasks', taskId);
      await fs.mkdir(taskDir, { recursive: true });
      await fs.writeFile(path.join(taskDir, 'task.md'), `# ${t.title}\n\n${(t.brief ?? '').trim()}\n`, 'utf-8');
      await fs.writeFile(path.join(taskDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
      await fs.writeFile(path.join(taskDir, 'state.json'), JSON.stringify({ task_id: taskId, phase: 'brainstorm', sub_tasks: { ideation: { agent_role: 'ideation', status: 'in_progress' } } }, null, 2), 'utf-8');
      taskIds.push(taskId);
    }
    stories.push({ id: storyId, title: story.title, traces: story.traces ?? [story.title], taskIds });
  }

  const epic: Epic = { ...existing, stories };
  await fs.writeFile(path.join(dir, 'epic.json'), JSON.stringify(epic, null, 2), 'utf-8');
  return epic;
}

/** Heading-based plan: each section → a Story with one Task. */
function headingPlan(doc: string): PlanStory[] {
  return splitByHeadings(doc).map(sec => ({ title: sec.title, traces: [sec.title], tasks: [{ title: sec.title, brief: sec.body }] }));
}

/** LLM-based plan: ask the model for a Stories→Tasks tree (strict JSON). Returns null on any failure. */
async function smartPlan(doc: string, invoke: (prompt: string) => Promise<string>): Promise<PlanStory[] | null> {
  const prompt = [
    'You are decomposing a product brief into a build plan.',
    'Output STRICT JSON only — no prose, no markdown fences. Shape:',
    '{"stories":[{"title":string,"traces":[string],"tasks":[{"title":string,"brief":string,"estimate":number,"dependsOn":[string]}]}]}',
    'Rules: break the brief into coherent modules (stories); each story has small, independently-shippable tasks;',
    'traces = the parts of the brief the story covers; estimate = rough size 1-5; dependsOn = task titles this task needs first.',
    'Keep task titles unique across the whole plan.',
    '',
    'Brief:',
    doc.slice(0, 24000),
  ].join('\n');
  try {
    const raw = await invoke(prompt);
    const json = raw.replace(/```json\s*|\s*```/g, '').trim();
    const start = json.indexOf('{'); const end = json.lastIndexOf('}');
    if (start === -1 || end === -1) return null;
    const parsed = JSON.parse(json.slice(start, end + 1)) as { stories?: PlanStory[] };
    if (!Array.isArray(parsed.stories) || !parsed.stories.length) return null;
    // Sanitize: every story needs a title + at least one task with a title.
    const clean = parsed.stories
      .filter(s => s.title && Array.isArray(s.tasks))
      .map(s => ({ title: String(s.title), traces: s.traces, tasks: s.tasks.filter(t => t.title).map(t => ({ title: String(t.title), brief: t.brief, estimate: t.estimate, dependsOn: t.dependsOn })) }))
      .filter(s => s.tasks.length);
    return clean.length ? clean : null;
  } catch { return null; }
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
