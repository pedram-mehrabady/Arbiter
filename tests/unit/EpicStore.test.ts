import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createEpic, decompose, listEpics, readEpic } from '../../src/epics/EpicStore';

function workspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'epic-test-'));
}

const DOC = `# Portal
Overview.

## Auth
Login + signup.

## Contacts
CRUD contacts.`;

describe('EpicStore', () => {
  it('creates an epic and writes epic.md + epic.json', async () => {
    const root = workspace();
    const id = await createEpic(root, 'Portal', DOC);
    expect(id).toMatch(/^EPIC-PORTAL-/);
    expect(fs.existsSync(path.join(root, 'arbiter', 'epics', id, 'epic.md'))).toBe(true);
    const epic = await readEpic(root, id);
    expect(epic?.title).toBe('Portal');
    expect(epic?.stories).toEqual([]);
  });

  it('decomposes into stories (by heading) + one materialized task each', async () => {
    const root = workspace();
    const id = await createEpic(root, 'Portal', DOC);
    const epic = await decompose(root, id);

    expect(epic.stories.length).toBeGreaterThanOrEqual(2);
    const titles = epic.stories.map(s => s.title);
    expect(titles).toContain('Auth');
    expect(titles).toContain('Contacts');

    // Each story has a materialized task with a meta linking it back.
    const firstTask = epic.stories[0].taskIds[0];
    const meta = JSON.parse(fs.readFileSync(path.join(root, 'arbiter', 'tasks', firstTask, 'meta.json'), 'utf-8'));
    expect(meta.epicId).toBe(id);
    expect(meta.storyId).toBe(epic.stories[0].id);
    expect(fs.existsSync(path.join(root, 'arbiter', 'tasks', firstTask, 'task.md'))).toBe(true);
  });

  it('rolls up completion: 0% fresh, counts done pipeline tasks', async () => {
    const root = workspace();
    const id = await createEpic(root, 'Portal', DOC);
    const epic = await decompose(root, id);

    let rollup = (await listEpics(root)).find(e => e.id === id)!;
    expect(rollup.pct).toBe(0);
    expect(rollup.total).toBe(epic.stories.reduce((n, s) => n + s.taskIds.length, 0));

    // Mark one task's pipeline as fully completed.
    const t = epic.stories[0].taskIds[0];
    fs.writeFileSync(path.join(root, 'arbiter', 'tasks', t, 'state.json'),
      JSON.stringify({ task_id: t, sub_tasks: { design: { agent_role: 'design', status: 'completed' } } }));
    rollup = (await listEpics(root)).find(e => e.id === id)!;
    expect(rollup.done).toBe(1);
  });
});
