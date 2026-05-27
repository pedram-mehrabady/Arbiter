import { createHash } from 'node:crypto';
import { ServiceResult } from '../types/index';

export interface DebuggerDiff {
  diffHash: string;
  diffPct: number;
  linesAdded: number;
  linesRemoved: number;
}

export interface DebuggerGuardResult {
  allowed: boolean;
  diff: DebuggerDiff;
  gateRequired: boolean;
  // Set when allowed === false
  haltReason?: 'new_public_abstractions';
  newAbstractions?: string[];
}

// Four Arbiter-enforced constraints on debugger output (P1-5).
// When an auditor reviews the debugger escalation path they ask:
//   who wrote this code, what rules governed it, can you prove it?
// These constraints answer all three.

const MAJOR_REWRITE_THRESHOLD_PCT = 20;

// Public abstraction patterns (C# / TypeScript both covered)
const PUBLIC_ABSTRACTION_PATTERNS = [
  /^\s*public\s+(class|interface|record|enum|abstract class)\s+\w+/m,
  /^\s*export\s+(class|interface|type|enum|abstract class)\s+\w+/m,
];

export class DebuggerGuard {
  // ── Constraint 2+3+4: compare original vs debugger output ─────────────────

  evaluate(originalContent: string, debuggerContent: string): DebuggerGuardResult {
    // Constraint 2 — diff metrics for receipt
    const diff = this.computeDiff(originalContent, debuggerContent);

    // Constraint 4 — no new public abstractions
    const newAbstractions = this.findNewAbstractions(originalContent, debuggerContent);
    if (newAbstractions.length > 0) {
      return {
        allowed: false,
        diff,
        gateRequired: false,
        haltReason: 'new_public_abstractions',
        newAbstractions,
      };
    }

    // Constraint 3 — >20% rewrite triggers a 4th human gate
    const gateRequired = diff.diffPct > MAJOR_REWRITE_THRESHOLD_PCT;

    return { allowed: true, diff, gateRequired };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private computeDiff(original: string, debugger_: string): DebuggerDiff {
    const origLines = original.split('\n');
    const dbgLines = debugger_.split('\n');

    const origSet = new Set(origLines);
    const dbgSet = new Set(dbgLines);

    const linesAdded = dbgLines.filter(l => !origSet.has(l)).length;
    const linesRemoved = origLines.filter(l => !dbgSet.has(l)).length;

    // Diff pct relative to original length (floor at 1 to avoid divide-by-zero)
    const baseLen = Math.max(origLines.length, 1);
    const diffPct = Math.round(((linesAdded + linesRemoved) / baseLen) * 100);

    const diffHash = `sha256:${createHash('sha256')
      .update(`added:${linesAdded},removed:${linesRemoved},orig:${origLines.length}`)
      .digest('hex')}`;

    return { diffHash, diffPct, linesAdded, linesRemoved };
  }

  private findNewAbstractions(original: string, debugger_: string): string[] {
    const origAbstractions = this.extractAbstractions(original);
    const dbgAbstractions = this.extractAbstractions(debugger_);
    return [...dbgAbstractions].filter(a => !origAbstractions.has(a));
  }

  private extractAbstractions(content: string): Set<string> {
    const found = new Set<string>();
    for (const pattern of PUBLIC_ABSTRACTION_PATTERNS) {
      const matches = content.match(new RegExp(pattern.source, 'gm')) ?? [];
      for (const m of matches) {
        found.add(m.trim());
      }
    }
    return found;
  }

  // ── Constraint 1: validate debugger output passes same rules as original ──

  validateContent(content: string): ServiceResult<void> {
    // P-CRYPTO check — same patterns as PreflightCheck
    const cryptoPatterns: Array<{ name: string; pattern: RegExp }> = [
      { name: 'AesManaged', pattern: /new\s+AesManaged\b/ },
      { name: 'RijndaelManaged', pattern: /new\s+RijndaelManaged\b/ },
      { name: 'custom_encryptor_class', pattern: /class\s+\w*(Encryptor|Cipher|Crypto)\b(?!.*AesGcm|.*SubtleCrypto)/ },
      { name: 'manual_xor_crypto', pattern: /\bxor\b.*\bkey\b|\bkey\b.*\bxor\b/i },
      { name: 'custom_pbkdf', pattern: /class\s+\w*Pbkdf(?!.*Rfc2898)/i },
    ];

    const violations: string[] = [];
    for (const { name, pattern } of cryptoPatterns) {
      if (pattern.test(content)) violations.push(name);
    }

    if (violations.length > 0) {
      return {
        ok: false,
        error: `Debugger output fails P-CRYPTO rule: ${violations.join(', ')}`,
        code: 'DEBUGGER_CRYPTO_VIOLATION',
      };
    }
    return { ok: true, value: undefined };
  }

  formatGuardSummary(result: DebuggerGuardResult): string {
    const lines = [
      `Debugger guard result:`,
      `  allowed:        ${result.allowed}`,
      `  diff_pct:       ${result.diff.diffPct}%`,
      `  diff_hash:      ${result.diff.diffHash}`,
      `  lines_added:    ${result.diff.linesAdded}`,
      `  lines_removed:  ${result.diff.linesRemoved}`,
      `  gate_required:  ${result.gateRequired}`,
    ];
    if (!result.allowed && result.haltReason) {
      lines.push(`  halt_reason:    ${result.haltReason}`);
      if (result.newAbstractions?.length) {
        lines.push(`  new_abstractions:`);
        result.newAbstractions.forEach(a => lines.push(`    - ${a}`));
      }
    }
    return lines.join('\n');
  }
}
