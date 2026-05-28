import type { OsType } from '../api/types';

/**
 * On Windows, shell scripts need `bash` prefix (Git Bash / WSL).
 * On Mac/Linux they run directly.
 */
export function shellCmd(cmd: string, os: OsType): string {
  if (os !== 'win') return cmd;
  if (cmd.startsWith('bash ') || cmd.startsWith('wsl ')) return cmd;
  return `bash ${cmd}`;
}

/**
 * Transform prose text that embeds `scripts/...` references so Windows users
 * see `bash scripts/...` instead of bare script paths.
 * Only matches occurrences that start with `scripts/` (word boundary).
 */
export function osifyProse(text: string, os: OsType): string {
  if (os !== 'win') return text;
  return text.replace(/\b(scripts\/\S+)/g, 'bash $1');
}

/** fswatch install hint — Mac only; Windows users don't have brew. */
export function fswatchHint(os: OsType): string | null {
  return os === 'win' ? null : 'brew install fswatch';
}
