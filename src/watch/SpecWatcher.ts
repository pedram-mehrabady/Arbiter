import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import { ServiceResult } from '../types/index';

export type SpecFileHandler = (specFile: string, taskId: string) => Promise<ServiceResult<void>>;

export interface SpecWatcherOptions {
  specDir: string;
  workspaceRoot: string;
  pollIntervalMs?: number;
}

export class SpecWatcher {
  private readonly specDir: string;
  private readonly workspaceRoot: string;
  private readonly pollIntervalMs: number;
  private readonly seen = new Set<string>();
  private running = false;

  constructor(opts: SpecWatcherOptions) {
    this.specDir       = path.resolve(opts.specDir);
    this.workspaceRoot = opts.workspaceRoot;
    this.pollIntervalMs = opts.pollIntervalMs ?? 3_000;
  }

  async start(handler: SpecFileHandler): Promise<void> {
    // Pre-populate seen set with files that already exist (ignore existing)
    try {
      const dirents = await fs.readdir(this.specDir, { withFileTypes: true, encoding: 'utf-8' });
      for (const d of dirents) {
        if (d.isFile() && (d.name as string).endsWith('.md')) {
          this.seen.add(d.name as string);
        }
      }
    } catch {
      // specDir may not exist yet — that's fine, we'll create it
    }

    await fs.mkdir(this.specDir, { recursive: true });

    this.running = true;
    console.log(`Watching for spec files in ${this.specDir} (poll every ${this.pollIntervalMs}ms)`);
    console.log('Drop a <task-id>.md file into the directory to auto-initiate and conduct a task.');
    console.log('Press Ctrl+C to stop.\n');

    while (this.running) {
      await this.poll(handler);
      await sleep(this.pollIntervalMs);
    }
  }

  stop(): void {
    this.running = false;
  }

  private async poll(handler: SpecFileHandler): Promise<void> {
    let dirents: Dirent<string>[];
    try {
      dirents = await fs.readdir(this.specDir, { withFileTypes: true, encoding: 'utf-8' }) as Dirent<string>[];
    } catch {
      return;
    }

    for (const d of dirents) {
      const name = d.name as string;
      if (!d.isFile() || !name.endsWith('.md')) continue;
      if (this.seen.has(name)) continue;

      this.seen.add(name);
      const taskId = name.replace(/\.md$/, '');
      const specFile = path.join(this.specDir, name);

      console.log(`\nDetected spec file: ${name} → task "${taskId}"`);

      const result = await handler(specFile, taskId);
      if (result.ok) {
        // Move the spec file to a "processed" sub-directory so it won't re-trigger
        const processedDir = path.join(this.specDir, 'processed');
        await fs.mkdir(processedDir, { recursive: true });
        await fs.rename(specFile, path.join(processedDir, name)).catch(() => undefined);
        console.log(`  ✓ Task "${taskId}" completed. Spec moved to processed/.`);
      } else {
        console.error(`  ✗ Task "${taskId}" failed: ${result.error}`);
        // Move failed specs to error dir so they don't loop
        const errorDir = path.join(this.specDir, 'error');
        await fs.mkdir(errorDir, { recursive: true });
        await fs.rename(specFile, path.join(errorDir, name)).catch(() => undefined);
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
