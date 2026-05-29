import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { generateConfig } from '../../src/bootstrap/ConfigGenerator';
import type { InterviewAnswers } from '../../src/bootstrap/Interview';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-gitignore-test-'));
}

const ANSWERS: InterviewAnswers = {
  projectName: 'demo',
  provider: 'claude_max_cli',
  providerModel: 'claude-opus-4-7',
  stackFrontend: 'none',
  stackBackend: 'none',
  stackDatabase: 'none',
  testFramework: 'none',
  designSystem: 'none',
  conventions: '',
  audience: 'public',
  gates: { design: true, plan: true, review: true },
};

describe('generateConfig — .gitignore for personal identity', () => {
  it('gitignores arbiter/developer-identity.json (and state.db) on a fresh init', async () => {
    const dir = tempDir();
    const res = await generateConfig(dir, ANSWERS);
    expect(res.ok).toBe(true);

    const gitignore = fs.readFileSync(path.join(dir, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('arbiter/developer-identity.json');
    expect(gitignore).toContain('arbiter/state.db');
  });

  it('tops up an older .gitignore block that lacks the identity entry', async () => {
    const dir = tempDir();
    // Simulate a project initialised before the identity entry existed.
    fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\narbiter/state.json\n');
    const res = await generateConfig(dir, ANSWERS);
    expect(res.ok).toBe(true);

    const gitignore = fs.readFileSync(path.join(dir, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('arbiter/developer-identity.json');
    // Existing entries preserved, not duplicated.
    expect(gitignore.match(/arbiter\/state\.json/g)?.length).toBe(1);
  });
});
