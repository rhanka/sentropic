import { describe, expect, it } from 'vitest';
import {
  validateVerificationRunV0,
  deriveVerdict,
} from '../../src/artifacts/validate-verification-run.js';
import {
  cleanRun,
  blockingRun,
  advisoryOnlyRun,
  acceptanceOnlyRun,
  dualTargetRun,
  missingTargetRun,
  wellFormedRuns,
} from '../fixtures/verification-run/index.js';

describe('validateVerificationRunV0 — structural mode', () => {
  it('accepts every well-formed fixture (including missing-target structurally)', () => {
    for (const run of wellFormedRuns) {
      const r = validateVerificationRunV0(run);
      expect(r.errors).toEqual([]);
      expect(r.valid).toBe(true);
    }
  });

  it('rejects a non-object', () => {
    expect(validateVerificationRunV0(null).valid).toBe(false);
    expect(validateVerificationRunV0(42).valid).toBe(false);
    expect(validateVerificationRunV0([]).valid).toBe(false);
  });

  it('fails closed on an unknown schemaVersion', () => {
    const r = validateVerificationRunV0({ ...cleanRun, schemaVersion: 2 });
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('$.schemaVersion: expected 1 (unknown version fails closed)');
  });

  it('rejects a missing required artifactLocator', () => {
    const { artifactLocator: _drop, ...withoutLocator } = cleanRun;
    const r = validateVerificationRunV0(withoutLocator);
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('$.artifactLocator: expected string');
  });

  it('rejects an unknown category (enum) on the run', () => {
    const r = validateVerificationRunV0({ ...cleanRun, category: 'perf' });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.startsWith('$.category:'))).toBe(true);
  });

  it('accepts the reserved security category slot', () => {
    const r = validateVerificationRunV0({ ...cleanRun, category: 'security' });
    expect(r.valid).toBe(true);
  });

  it('rejects an unknown category on a check', () => {
    const bad = {
      ...cleanRun,
      checks: [{ code: 'X', category: 'perf', pass: true, violations: [] }],
    };
    const r = validateVerificationRunV0(bad);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.startsWith('$.checks[0].category:'))).toBe(true);
  });

  it('rejects an unknown violation severity', () => {
    const bad = {
      ...cleanRun,
      violations: [{ code: 'C2', message: 'm', severity: 'fatal' }],
    };
    const r = validateVerificationRunV0(bad);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.startsWith('$.violations[0].severity:'))).toBe(true);
  });

  it('rejects a target with neither scope nor acceptance', () => {
    const bad = {
      ...cleanRun,
      checks: [{ code: 'C2', category: 'static', pass: true, violations: [], target: {} }],
    };
    const r = validateVerificationRunV0(bad);
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('$.checks[0].target: requires at least one of scope|acceptance');
  });

  it('rejects an unknown acceptance kind', () => {
    const bad = {
      ...acceptanceOnlyRun,
      checks: [
        {
          code: 'T',
          category: 'unit',
          pass: true,
          violations: [],
          target: { acceptance: { evidenceId: 'e', kind: 'smoke' } },
        },
      ],
    };
    const r = validateVerificationRunV0(bad);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.startsWith('$.checks[0].target.acceptance.kind:'))).toBe(true);
  });
});

describe('validateVerificationRunV0 — ingested mode (adapter fail-closed)', () => {
  it('accepts a targeted check', () => {
    expect(validateVerificationRunV0(cleanRun, { mode: 'ingested' }).valid).toBe(true);
    expect(validateVerificationRunV0(dualTargetRun, { mode: 'ingested' }).valid).toBe(true);
  });

  it('rejects a check with NO target (fail-closed)', () => {
    const r = validateVerificationRunV0(missingTargetRun, { mode: 'ingested' });
    expect(r.valid).toBe(false);
    expect(r.errors).toContain(
      '$.checks[0].target: required for a track-ingested check (adapter fails closed)',
    );
  });
});

describe('deriveVerdict — frozen cross-contract predicate (DEC-S3)', () => {
  it('any blocking ⇒ violation', () => {
    expect(deriveVerdict(blockingRun.violations)).toBe('violation');
    expect(
      deriveVerdict([
        { severity: 'advisory' },
        { severity: 'blocking' },
      ]),
    ).toBe('violation');
  });

  it('advisory-only ⇒ conditional', () => {
    expect(deriveVerdict(advisoryOnlyRun.violations)).toBe('conditional');
  });

  it('none ⇒ clean', () => {
    expect(deriveVerdict(cleanRun.violations)).toBe('clean');
    expect(deriveVerdict([])).toBe('clean');
  });

  it('is derived from severity, never from result', () => {
    // result='pass' yet an advisory violation present ⇒ conditional, not clean.
    expect(advisoryOnlyRun.result).toBe('pass');
    expect(deriveVerdict(advisoryOnlyRun.violations)).toBe('conditional');
  });
});
