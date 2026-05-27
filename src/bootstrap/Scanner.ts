import fs from 'node:fs/promises';
import path from 'node:path';

export interface ProjectProfile {
  name: string;
  stackFrontend: string;    // react | vue | angular | svelte | next | none
  stackBackend: string;     // node | python | go | dotnet | ruby | java | none
  stackDatabase: string;    // postgres | mysql | sqlite | mongodb | none
  testFramework: string;    // vitest | jest | pytest | xunit | rspec | none
  packageManager: string;   // npm | yarn | pnpm | pip | cargo | none
  hasTypeScript: boolean;
  architecture: string;     // monorepo | single-app
  existingDocs: string[];
}

export async function scanProject(workspaceRoot: string): Promise<ProjectProfile> {
  const profile: ProjectProfile = {
    name: path.basename(workspaceRoot),
    stackFrontend: 'none',
    stackBackend: 'none',
    stackDatabase: 'none',
    testFramework: 'none',
    packageManager: 'none',
    hasTypeScript: false,
    architecture: 'single-app',
    existingDocs: [],
  };

  await detectNode(workspaceRoot, profile);
  await detectDotnet(workspaceRoot, profile);
  await detectPython(workspaceRoot, profile);
  await detectGo(workspaceRoot, profile);
  await detectDocs(workspaceRoot, profile);
  await detectArchitecture(workspaceRoot, profile);

  return profile;
}

async function detectNode(root: string, profile: ProjectProfile): Promise<void> {
  const pkgPath = path.join(root, 'package.json');
  try {
    const raw = await fs.readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw) as Record<string, unknown>;

    if (typeof pkg['name'] === 'string' && pkg['name']) {
      profile.name = pkg['name'];
    }

    const deps = {
      ...(pkg['dependencies'] as Record<string, string> | undefined ?? {}),
      ...(pkg['devDependencies'] as Record<string, string> | undefined ?? {}),
    };

    // Frontend framework detection
    if (deps['next']) profile.stackFrontend = 'next';
    else if (deps['react']) profile.stackFrontend = 'react';
    else if (deps['vue']) profile.stackFrontend = 'vue';
    else if (deps['@angular/core']) profile.stackFrontend = 'angular';
    else if (deps['svelte']) profile.stackFrontend = 'svelte';

    // Backend framework detection (Node)
    if (deps['express'] || deps['fastify'] || deps['koa'] || deps['hono']) {
      if (profile.stackBackend === 'none') profile.stackBackend = 'node';
    }
    if (deps['@nestjs/core']) profile.stackBackend = 'node';

    // Test framework
    if (deps['vitest']) profile.testFramework = 'vitest';
    else if (deps['jest'] || deps['@jest/core']) profile.testFramework = 'jest';

    // Package manager
    profile.packageManager = 'npm';
    try { await fs.access(path.join(root, 'pnpm-lock.yaml')); profile.packageManager = 'pnpm'; } catch { /* */ }
    try { await fs.access(path.join(root, 'yarn.lock')); profile.packageManager = 'yarn'; } catch { /* */ }

    // TypeScript
    profile.hasTypeScript = Boolean(deps['typescript'] ?? deps['ts-node'] ?? deps['tsx']);

    // Database hints from deps
    if (deps['pg'] || deps['@prisma/client']) profile.stackDatabase = 'postgres';
    else if (deps['mysql2'] || deps['mysql']) profile.stackDatabase = 'mysql';
    else if (deps['mongodb'] || deps['mongoose']) profile.stackDatabase = 'mongodb';
    else if (deps['better-sqlite3'] || deps['sqlite3']) profile.stackDatabase = 'sqlite';

    if (profile.stackFrontend !== 'none' || profile.stackBackend !== 'none') {
      if (profile.stackBackend === 'none') profile.stackBackend = 'node';
    }
  } catch { /* no package.json */ }
}

async function detectDotnet(root: string, profile: ProjectProfile): Promise<void> {
  try {
    const entries = await fs.readdir(root, { recursive: true, withFileTypes: true });
    const hasCsproj = (entries as Array<{ name: string; isFile: () => boolean }>)
      .some(e => e.isFile() && e.name.endsWith('.csproj'));
    if (hasCsproj) {
      profile.stackBackend = 'dotnet';
      profile.testFramework = 'xunit';
    }
  } catch { /* */ }
}

async function detectPython(root: string, profile: ProjectProfile): Promise<void> {
  const markers = ['requirements.txt', 'pyproject.toml', 'setup.py', 'Pipfile'];
  for (const m of markers) {
    try {
      await fs.access(path.join(root, m));
      profile.stackBackend = 'python';
      profile.packageManager = 'pip';
      profile.testFramework = 'pytest';
      return;
    } catch { /* */ }
  }
}

async function detectGo(root: string, profile: ProjectProfile): Promise<void> {
  try {
    await fs.access(path.join(root, 'go.mod'));
    profile.stackBackend = 'go';
    profile.packageManager = 'go';
    profile.testFramework = 'go-test';
  } catch { /* */ }
}

async function detectDocs(root: string, profile: ProjectProfile): Promise<void> {
  const docPatterns = ['README.md', 'CONTRIBUTING.md', 'docs/', 'doc/'];
  for (const p of docPatterns) {
    try {
      await fs.access(path.join(root, p));
      profile.existingDocs.push(p);
    } catch { /* */ }
  }
}

async function detectArchitecture(root: string, profile: ProjectProfile): Promise<void> {
  // Heuristic: packages/ or apps/ directory at root → monorepo
  const monorepoMarkers = ['packages', 'apps', 'services', 'libs'];
  for (const m of monorepoMarkers) {
    try {
      const stat = await fs.stat(path.join(root, m));
      if (stat.isDirectory()) { profile.architecture = 'monorepo'; return; }
    } catch { /* */ }
  }
}

export function formatProfile(profile: ProjectProfile): string {
  const lines: string[] = ['Detected:'];
  if (profile.stackFrontend !== 'none') lines.push(`  Frontend:  ${profile.stackFrontend}`);
  if (profile.stackBackend !== 'none')  lines.push(`  Backend:   ${profile.stackBackend}`);
  if (profile.stackDatabase !== 'none') lines.push(`  Database:  ${profile.stackDatabase}`);
  lines.push(`  Tests:     ${profile.testFramework}`);
  lines.push(`  TypeScript: ${profile.hasTypeScript ? 'yes' : 'no'}`);
  lines.push(`  Arch:      ${profile.architecture}`);
  return lines.join('\n');
}
