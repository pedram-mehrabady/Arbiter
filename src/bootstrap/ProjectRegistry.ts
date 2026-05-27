import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ServiceResult } from '../types/index';

const REGISTRY_DIR = path.join(os.homedir(), '.arbiter');
const REGISTRY_FILE = path.join(REGISTRY_DIR, 'projects.json');

export interface ProjectEntry {
  id: string;
  name: string;
  root: string;
  last_accessed: string;
}

export interface ProjectRegistry {
  projects: ProjectEntry[];
  active: string | null;
}

export async function registerProject(
  id: string,
  name: string,
  root: string,
): Promise<ServiceResult<void>> {
  try {
    await fs.mkdir(REGISTRY_DIR, { recursive: true });

    let registry: ProjectRegistry = { projects: [], active: null };
    try {
      const raw = await fs.readFile(REGISTRY_FILE, 'utf-8');
      registry = JSON.parse(raw) as ProjectRegistry;
    } catch { /* first time */ }

    // Upsert
    const idx = registry.projects.findIndex(p => p.id === id || p.root === root);
    const entry: ProjectEntry = { id, name, root, last_accessed: new Date().toISOString() };
    if (idx >= 0) registry.projects[idx] = entry;
    else registry.projects.push(entry);

    registry.active = id;

    await fs.writeFile(REGISTRY_FILE, JSON.stringify(registry, null, 2), 'utf-8');
    return { ok: true, value: undefined };
  } catch (err) {
    return { ok: false, error: `Project registry write failed: ${String(err)}` };
  }
}

export async function listProjects(): Promise<ServiceResult<ProjectRegistry>> {
  try {
    const raw = await fs.readFile(REGISTRY_FILE, 'utf-8');
    return { ok: true, value: JSON.parse(raw) as ProjectRegistry };
  } catch {
    return { ok: true, value: { projects: [], active: null } };
  }
}
