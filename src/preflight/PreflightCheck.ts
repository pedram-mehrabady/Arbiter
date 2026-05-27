import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ComplexityScore, ServiceResult } from '../types/index';
import { SecretsScanner } from './SecretsScanner';
import { ComplexityScorer } from './ComplexityScorer';

// P-CRYPTO: forbidden patterns in agent-submitted task files.
// Agents must use framework primitives — never custom crypto implementations.
const CRYPTO_VIOLATIONS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'AesManaged', pattern: /new\s+AesManaged\b/g },
  { name: 'RijndaelManaged', pattern: /new\s+RijndaelManaged\b/g },
  { name: 'custom_encryptor_class', pattern: /class\s+\w*(Encryptor|Cipher|Crypto)\b(?!.*AesGcm|.*SubtleCrypto)/g },
  { name: 'manual_xor_crypto', pattern: /\bxor\b.*\bkey\b|\bkey\b.*\bxor\b/gi },
  { name: 'custom_pbkdf', pattern: /class\s+\w*Pbkdf(?!.*Rfc2898)/gi },
];

// Verdict drives conductor routing after preflight:
//   spawn  — all checks passed, proceed to agent invocation
//   reject — infrastructure problem (missing files); fix context, retry without strike
//   split  — complexity cap exceeded; task must be decomposed before retry
//   halt   — hard violation (P-crypto, secrets); pipeline stops, human must intervene
export type PreflightVerdict = 'spawn' | 'reject' | 'split' | 'halt';

export interface PreflightResult {
  passed: boolean;
  verdict: PreflightVerdict;
  checks: Array<{ name: string; passed: boolean; detail?: string }>;
  contextHash: string;
}

export class PreflightCheck {
  private readonly secretsScanner = new SecretsScanner();
  private readonly complexityScorer = new ComplexityScorer();

  async run(
    taskId: string,
    subTaskId: string,
    contextFiles: string[],
    complexityScore?: ComplexityScore,
  ): Promise<ServiceResult<PreflightResult>> {
    const checks: PreflightResult['checks'] = [];

    // CHECK 1: Context files exist
    const missingFiles: string[] = [];
    for (const f of contextFiles) {
      try {
        await fs.access(f);
      } catch {
        missingFiles.push(f);
      }
    }
    checks.push({
      name: 'context_files_exist',
      passed: missingFiles.length === 0,
      detail: missingFiles.length > 0 ? `Missing: ${missingFiles.join(', ')}` : undefined,
    });

    // CHECK 2: Compute context hash
    const contextHash = await this.hashContextFiles(contextFiles);

    // CHECK 3: Complexity score (if provided)
    if (complexityScore) {
      const scoreResult = this.complexityScorer.validate(complexityScore);
      checks.push({
        name: 'complexity_score',
        passed: scoreResult.ok,
        detail: scoreResult.ok
          ? this.complexityScorer.describe(complexityScore)
          : scoreResult.error,
      });
    }

    // CHECK 4: P-Crypto rule — scan task files for forbidden patterns
    const cryptoResult = await this.checkCryptoViolations(contextFiles);
    if (!cryptoResult.ok) return cryptoResult;
    checks.push({
      name: 'p_crypto_rule',
      passed: cryptoResult.value.length === 0,
      detail:
        cryptoResult.value.length > 0
          ? `P-CRYPTO violation: ${cryptoResult.value.join('; ')}`
          : undefined,
    });

    // CHECK 5: Secrets scan
    const secretsResult = await this.secretsScanner.scanFiles(contextFiles);
    if (!secretsResult.ok) return secretsResult;
    checks.push({
      name: 'secrets_scan',
      passed: secretsResult.value.length === 0,
      detail:
        secretsResult.value.length > 0
          ? `Secrets detected:\n${this.secretsScanner.formatViolations(secretsResult.value)}`
          : undefined,
    });

    const passed = checks.every(c => c.passed);
    const verdict = passed ? 'spawn' : this.deriveVerdict(checks);
    return {
      ok: true,
      value: { passed, verdict, checks, contextHash },
    };
  }

  private deriveVerdict(checks: PreflightResult['checks']): PreflightVerdict {
    const failed = checks.filter(c => !c.passed).map(c => c.name);
    // Hard stops — irreversible violations that require human review
    if (failed.includes('p_crypto_rule') || failed.includes('secrets_scan')) return 'halt';
    // Complexity overload — task must be decomposed, not retried
    if (failed.includes('complexity_score')) return 'split';
    // Infrastructure failure — fix context, no strike consumed
    return 'reject';
  }

  private async hashContextFiles(files: string[]): Promise<string> {
    const hash = createHash('sha256');
    for (const f of [...files].sort()) {
      try {
        const content = await fs.readFile(f, 'utf-8');
        hash.update(`${f}:${content}`);
      } catch {
        hash.update(`${f}:MISSING`);
      }
    }
    return `sha256:${hash.digest('hex')}`;
  }

  private async checkCryptoViolations(files: string[]): Promise<ServiceResult<string[]>> {
    const violations: string[] = [];
    for (const filePath of files) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        for (const { name, pattern } of CRYPTO_VIOLATIONS) {
          pattern.lastIndex = 0;
          if (pattern.test(content)) {
            violations.push(`${name} in ${filePath}`);
          }
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          return { ok: false, error: `Crypto scan failed: ${String(err)}` };
        }
      }
    }
    return { ok: true, value: violations };
  }

  formatFailures(result: PreflightResult): string {
    return result.checks
      .filter(c => !c.passed)
      .map(c => `  [FAIL] ${c.name}${c.detail ? ': ' + c.detail : ''}`)
      .join('\n');
  }
}
