import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scanProject, formatProfile } from '../../src/bootstrap/Scanner';

const makeRoot = () => fs.mkdtemp(path.join(os.tmpdir(), 'arbiter-scan-'));

describe('scanProject', () => {
  let root: string;

  beforeEach(async () => { root = await makeRoot(); });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it('returns safe defaults for an empty directory', async () => {
    const p = await scanProject(root);
    expect(p.stackFrontend).toBe('none');
    expect(p.stackBackend).toBe('none');
    expect(p.stackDatabase).toBe('none');
    expect(p.testFramework).toBe('none');
    expect(p.packageManager).toBe('none');
    expect(p.hasTypeScript).toBe(false);
    expect(p.architecture).toBe('single-app');
    expect(p.name).toBe(path.basename(root));
  });

  it('detects react from package.json', async () => {
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
      name: 'my-app',
      dependencies: { react: '^18.0.0' },
    }));
    const p = await scanProject(root);
    expect(p.stackFrontend).toBe('react');
    expect(p.name).toBe('my-app');
  });

  it('detects next.js (takes priority over react)', async () => {
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
      dependencies: { next: '^14.0.0', react: '^18.0.0' },
    }));
    const p = await scanProject(root);
    expect(p.stackFrontend).toBe('next');
  });

  it('detects vitest test framework', async () => {
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
      devDependencies: { vitest: '^2.0.0' },
    }));
    const p = await scanProject(root);
    expect(p.testFramework).toBe('vitest');
  });

  it('detects jest test framework', async () => {
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
      devDependencies: { jest: '^29.0.0' },
    }));
    const p = await scanProject(root);
    expect(p.testFramework).toBe('jest');
  });

  it('detects TypeScript from devDependencies', async () => {
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
      devDependencies: { typescript: '^5.0.0' },
    }));
    const p = await scanProject(root);
    expect(p.hasTypeScript).toBe(true);
  });

  it('detects postgres from pg dependency', async () => {
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
      dependencies: { pg: '^8.0.0' },
    }));
    const p = await scanProject(root);
    expect(p.stackDatabase).toBe('postgres');
  });

  it('detects python from requirements.txt', async () => {
    await fs.writeFile(path.join(root, 'requirements.txt'), 'flask\nrequests\n');
    const p = await scanProject(root);
    expect(p.stackBackend).toBe('python');
    expect(p.testFramework).toBe('pytest');
    expect(p.packageManager).toBe('pip');
  });

  it('detects go from go.mod', async () => {
    await fs.writeFile(path.join(root, 'go.mod'), 'module example.com/myapp\n\ngo 1.21\n');
    const p = await scanProject(root);
    expect(p.stackBackend).toBe('go');
    expect(p.packageManager).toBe('go');
    expect(p.testFramework).toBe('go-test');
  });

  it('detects monorepo from packages/ directory', async () => {
    await fs.mkdir(path.join(root, 'packages'));
    const p = await scanProject(root);
    expect(p.architecture).toBe('monorepo');
  });

  it('detects existing docs', async () => {
    await fs.writeFile(path.join(root, 'README.md'), '# Readme');
    const p = await scanProject(root);
    expect(p.existingDocs).toContain('README.md');
  });
});

describe('formatProfile', () => {
  it('omits "none" stacks from output', () => {
    const profile = {
      name: 'test', stackFrontend: 'none', stackBackend: 'none', stackDatabase: 'none',
      testFramework: 'vitest', packageManager: 'npm', hasTypeScript: true,
      architecture: 'single-app', existingDocs: [],
    };
    const out = formatProfile(profile);
    expect(out).not.toContain('Frontend');
    expect(out).not.toContain('Backend');
    expect(out).toContain('vitest');
    expect(out).toContain('yes');
  });

  it('includes non-none stacks', () => {
    const profile = {
      name: 'test', stackFrontend: 'react', stackBackend: 'node', stackDatabase: 'postgres',
      testFramework: 'jest', packageManager: 'npm', hasTypeScript: false,
      architecture: 'monorepo', existingDocs: [],
    };
    const out = formatProfile(profile);
    expect(out).toContain('react');
    expect(out).toContain('node');
    expect(out).toContain('postgres');
    expect(out).toContain('monorepo');
  });
});
