import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class ContractFreezeEnforcer {
  getLockedPaths(tier: 1 | 2 | 3): string[] {
    if (tier === 2) return ['contracts/'];
    return [];
  }

  async checkMutations(worktreePath: string, lockedPaths: string[]): Promise<string[]> {
    if (lockedPaths.length === 0) return [];

    try {
      const { stdout } = await execFileAsync(
        'git',
        ['-C', worktreePath, 'diff', '--name-only', 'HEAD'],
        { timeout: 10_000 },
      );

      const changedFiles = stdout.split('\n').filter(Boolean);
      const violations: string[] = [];

      for (const changed of changedFiles) {
        for (const locked of lockedPaths) {
          if (changed.startsWith(locked) || changed.includes(`/${locked.replace(/\/$/, '')}/`)) {
            violations.push(
              `CONTRACT_MUTATION_ON_TIER2: ${changed} is locked for Tier 2 tasks. Re-classify as Tier 3 if contract changes are required.`,
            );
          }
        }
      }

      return violations;
    } catch {
      return [];
    }
  }
}
