import { FailureClass, ServiceResult } from '../types/index';

export interface FailureSignal {
  exitCode: number;
  stderr: string;
  stdout: string;
  strikeCount: number;
}

export interface ClassificationResult {
  class: FailureClass;
  reason: string;
  shouldRetry: boolean;
  shouldEscalateToDebugger: boolean;
  shouldRejectToFailed: boolean;
}

const MAX_STOCHASTIC_STRIKES = 2;

// Infrastructure failures: wrong template, missing context, manifest errors.
// These are deterministic — retrying without fixing the root cause will always fail.
const INFRASTRUCTURE_PATTERNS: RegExp[] = [
  /no such file or directory/i,
  /cannot find module/i,
  /enoent/i,
  /missing required context/i,
  /manifest not found/i,
  /invalid agent role/i,
  /template parse error/i,
  /context file.*not found/i,
  /schema validation failed/i,
  /preflight.*fail/i,
];

// Scope overload: the task is too large for a single agent invocation.
const SCOPE_OVERLOAD_PATTERNS: RegExp[] = [
  /context.*too large/i,
  /token.*limit.*exceed/i,
  /maximum context length/i,
  /complexity.*score.*exceed/i,
  /task.*must be split/i,
  /scope.*overload/i,
];

export class FailureClassifier {
  classify(signal: FailureSignal): ServiceResult<ClassificationResult> {
    const combined = `${signal.stderr}\n${signal.stdout}`.toLowerCase();

    if (signal.exitCode === 0) {
      return {
        ok: false,
        error: 'classify called on successful invocation (exit 0)',
        code: 'NOT_A_FAILURE',
      };
    }

    // Scope overload: reject immediately, no strikes consumed
    for (const pattern of SCOPE_OVERLOAD_PATTERNS) {
      if (pattern.test(combined)) {
        return {
          ok: true,
          value: {
            class: 'scope_overload',
            reason: `Pattern match: ${pattern.source}`,
            shouldRetry: false,
            shouldEscalateToDebugger: false,
            shouldRejectToFailed: true,
          },
        };
      }
    }

    // Infrastructure: deterministic failure, 0 strikes consumed
    for (const pattern of INFRASTRUCTURE_PATTERNS) {
      if (pattern.test(combined)) {
        return {
          ok: true,
          value: {
            class: 'infrastructure',
            reason: `Pattern match: ${pattern.source}`,
            shouldRetry: false,
            shouldEscalateToDebugger: false,
            shouldRejectToFailed: false,
          },
        };
      }
    }

    // Stochastic: non-deterministic, can retry up to MAX_STOCHASTIC_STRIKES
    const shouldEscalate = signal.strikeCount >= MAX_STOCHASTIC_STRIKES;
    return {
      ok: true,
      value: {
        class: 'stochastic',
        reason: `Non-deterministic failure, exit=${signal.exitCode}, strike=${signal.strikeCount}`,
        shouldRetry: !shouldEscalate,
        shouldEscalateToDebugger: shouldEscalate,
        shouldRejectToFailed: false,
      },
    };
  }

  isInfrastructure(signal: FailureSignal): boolean {
    const result = this.classify(signal);
    return result.ok && result.value.class === 'infrastructure';
  }

  isScopeOverload(signal: FailureSignal): boolean {
    const result = this.classify(signal);
    return result.ok && result.value.class === 'scope_overload';
  }
}
