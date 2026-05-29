import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolve a CLI tool to the WORKTREE's locally-installed binary
 * (node_modules/.bin/<name>), or null when the project doesn't have it.
 *
 * Why this exists: running a bare `npx <tool>` with cwd set to a worktree that
 * has no local install lets npx fall back to an unrelated global binary (e.g. a
 * non-TypeScript `tsc`), which then errors with garbage. Gates must run the
 * project's own tool or skip the check — never a random global.
 */
export function resolveLocalBin(worktreePath: string, name: string): string | null {
  const candidates = [
    path.join(worktreePath, 'node_modules', '.bin', name),
    path.join(worktreePath, 'node_modules', '.bin', `${name}.cmd`), // Windows
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      // ignore
    }
  }
  return null;
}
