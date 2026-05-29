import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { resolveLocalBin } from '../../src/util/resolveBin';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-bin-test-'));
}

describe('resolveLocalBin', () => {
  it('returns null when the project has no local binary (never a global)', () => {
    expect(resolveLocalBin(tempDir(), 'tsc')).toBeNull();
  });

  it('returns the node_modules/.bin/<name> path when present', () => {
    const dir = tempDir();
    const binDir = path.join(dir, 'node_modules', '.bin');
    fs.mkdirSync(binDir, { recursive: true });
    const bin = path.join(binDir, 'tsc');
    fs.writeFileSync(bin, '#!/bin/sh\n');
    expect(resolveLocalBin(dir, 'tsc')).toBe(bin);
  });

  it('returns null for a different tool not installed', () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, 'node_modules', '.bin'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules', '.bin', 'tsc'), '');
    expect(resolveLocalBin(dir, 'eslint')).toBeNull();
  });
});
