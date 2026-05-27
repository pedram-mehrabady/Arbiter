import { describe, it, expect } from 'vitest';
import { FailureClassifier } from '../../src/classifiers/FailureClassifier';

const base = { exitCode: 1, stderr: '', stdout: '', strikeCount: 0 };

describe('FailureClassifier', () => {
  const clf = new FailureClassifier();

  it('returns NOT_A_FAILURE for exit code 0', () => {
    const r = clf.classify({ ...base, exitCode: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NOT_A_FAILURE');
  });

  describe('scope_overload', () => {
    const cases = [
      'context too large',
      'token limit exceeded',
      'maximum context length',
      'complexity score exceeded',
      'task must be split',
      'scope overload',
    ];
    it.each(cases)('detects "%s" in stderr', msg => {
      const r = clf.classify({ ...base, stderr: msg });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.class).toBe('scope_overload');
      expect(r.value.shouldRetry).toBe(false);
      expect(r.value.shouldRejectToFailed).toBe(true);
      expect(r.value.shouldEscalateToDebugger).toBe(false);
    });

    it('detects scope_overload in stdout when stderr is clean', () => {
      const r = clf.classify({ ...base, stdout: 'Scope overload detected' });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.class).toBe('scope_overload');
    });
  });

  describe('infrastructure', () => {
    const cases = [
      'no such file or directory',
      'cannot find module',
      'ENOENT',
      'missing required context',
      'manifest not found',
      'invalid agent role',
      'template parse error',
      'context file /foo not found',
      'schema validation failed',
      'preflight fail',
    ];
    it.each(cases)('detects "%s"', msg => {
      const r = clf.classify({ ...base, stderr: msg });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.class).toBe('infrastructure');
      expect(r.value.shouldRetry).toBe(false);
      expect(r.value.shouldEscalateToDebugger).toBe(false);
      expect(r.value.shouldRejectToFailed).toBe(false);
    });
  });

  describe('stochastic', () => {
    it('classifies unknown failure as stochastic, retryable on first strike', () => {
      const r = clf.classify({ ...base, stderr: 'random LLM error', strikeCount: 0 });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.class).toBe('stochastic');
      expect(r.value.shouldRetry).toBe(true);
      expect(r.value.shouldEscalateToDebugger).toBe(false);
    });

    it('escalates to debugger at strike 2', () => {
      const r = clf.classify({ ...base, stderr: 'random error', strikeCount: 2 });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.shouldRetry).toBe(false);
      expect(r.value.shouldEscalateToDebugger).toBe(true);
    });
  });

  describe('helpers', () => {
    it('isInfrastructure returns true for ENOENT', () => {
      expect(clf.isInfrastructure({ ...base, stderr: 'ENOENT: not found' })).toBe(true);
    });

    it('isInfrastructure returns false for stochastic', () => {
      expect(clf.isInfrastructure({ ...base, stderr: 'timeout' })).toBe(false);
    });

    it('isScopeOverload returns true for token limit message', () => {
      expect(clf.isScopeOverload({ ...base, stderr: 'token limit exceeded' })).toBe(true);
    });
  });
});
