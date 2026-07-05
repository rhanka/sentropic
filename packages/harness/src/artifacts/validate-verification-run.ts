// Dependency-free runtime validator for the VerificationRun v0 seam.
//
// Hand-rolled (NO ajv / no JSON-Schema runtime): the `make test-harness` toolset is pinned to
// vitest/typescript/@types/node only, so the package stays dependency-free. This validator is
// the runtime counterpart of `schema/verification-run.schema.json` and of the
// `VerificationRun` types — keep all three in lock-step.
//
// Modes:
//   - `structural` (default): asserts the artifact shape (a check MAY omit `target`).
//   - `ingested`: additionally enforces the adapter fail-closed rule — every check MUST carry a
//     `target` with ≥1 of `scope`|`acceptance` (DEC-S1). A track-ingested check with no target
//     FAILS CLOSED; this surfaces it BEFORE emit instead of letting the adapter reject it.

import type { VerificationCategory, ViolationSeverity } from './verification-run.js';

export const VERIFICATION_CATEGORIES: readonly VerificationCategory[] = [
  'none',
  'static',
  'unit',
  'integration',
  'e2e',
  'ci',
  'uat',
  'security',
];

export const VIOLATION_SEVERITIES: readonly ViolationSeverity[] = ['advisory', 'blocking'];

const ACCEPTANCE_KINDS = ['unit', 'integration', 'e2e', 'manual'] as const;

export type ValidationMode = 'structural' | 'ingested';

export interface ValidateOptions {
  /** `ingested` ⇒ also enforce per-check `target` presence (adapter fail-closed). */
  mode?: ValidationMode;
}

export interface ValidationResult {
  valid: boolean;
  /** Dot/bracket paths + messages, e.g. `checks[0].target: required for ingested check`. */
  errors: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStr(v: unknown): v is string {
  return typeof v === 'string';
}

function validateViolation(v: unknown, path: string, errors: string[]): void {
  if (!isRecord(v)) {
    errors.push(`${path}: expected object`);
    return;
  }
  if (!isStr(v.code)) errors.push(`${path}.code: expected string`);
  if (!isStr(v.message)) errors.push(`${path}.message: expected string`);
  if (!VIOLATION_SEVERITIES.includes(v.severity as ViolationSeverity)) {
    errors.push(`${path}.severity: expected one of ${VIOLATION_SEVERITIES.join('|')}`);
  }
  if (v.path !== undefined && !isStr(v.path)) errors.push(`${path}.path: expected string`);
}

function validateTarget(t: unknown, path: string, errors: string[]): void {
  if (!isRecord(t)) {
    errors.push(`${path}: expected object`);
    return;
  }
  if (t.scope === undefined && t.acceptance === undefined) {
    errors.push(`${path}: requires at least one of scope|acceptance`);
  }
  if (t.scope !== undefined) {
    if (!isRecord(t.scope) || !isStr(t.scope.wpRef)) {
      errors.push(`${path}.scope.wpRef: expected string`);
    }
  }
  if (t.acceptance !== undefined) {
    const a = t.acceptance;
    if (!isRecord(a)) {
      errors.push(`${path}.acceptance: expected object`);
    } else {
      if (!isStr(a.evidenceId)) errors.push(`${path}.acceptance.evidenceId: expected string`);
      if (!ACCEPTANCE_KINDS.includes(a.kind as (typeof ACCEPTANCE_KINDS)[number])) {
        errors.push(`${path}.acceptance.kind: expected one of ${ACCEPTANCE_KINDS.join('|')}`);
      }
      if (a.criterionIds !== undefined) {
        if (!Array.isArray(a.criterionIds) || !a.criterionIds.every(isStr)) {
          errors.push(`${path}.acceptance.criterionIds: expected string[]`);
        }
      }
    }
  }
}

function validateCheck(c: unknown, path: string, mode: ValidationMode, errors: string[]): void {
  if (!isRecord(c)) {
    errors.push(`${path}: expected object`);
    return;
  }
  if (!isStr(c.code)) errors.push(`${path}.code: expected string`);
  if (!VERIFICATION_CATEGORIES.includes(c.category as VerificationCategory)) {
    errors.push(`${path}.category: expected one of ${VERIFICATION_CATEGORIES.join('|')}`);
  }
  if (typeof c.pass !== 'boolean') errors.push(`${path}.pass: expected boolean`);
  if (!Array.isArray(c.violations)) {
    errors.push(`${path}.violations: expected array`);
  } else {
    c.violations.forEach((v, i) => validateViolation(v, `${path}.violations[${i}]`, errors));
  }
  if (c.target !== undefined) {
    validateTarget(c.target, `${path}.target`, errors);
  } else if (mode === 'ingested') {
    // Adapter fail-closed (DEC-S1): a track-ingested check with no target is rejected.
    errors.push(`${path}.target: required for a track-ingested check (adapter fails closed)`);
  }
}

/**
 * Validate an unknown value against the frozen VerificationRun v0 contract. Pure, dependency-free,
 * deterministic. Returns every error rather than throwing on the first.
 */
export function validateVerificationRunV0(run: unknown, opts: ValidateOptions = {}): ValidationResult {
  const mode: ValidationMode = opts.mode ?? 'structural';
  const errors: string[] = [];

  if (!isRecord(run)) {
    return { valid: false, errors: ['$: expected object'] };
  }

  if (run.schemaVersion !== 1) errors.push('$.schemaVersion: expected 1 (unknown version fails closed)');
  for (const key of ['runId', 'commit', 'branch', 'env', 'runner', 'command', 'artifactLocator'] as const) {
    if (!isStr(run[key])) errors.push(`$.${key}: expected string`);
  }
  if (!VERIFICATION_CATEGORIES.includes(run.category as VerificationCategory)) {
    errors.push(`$.category: expected one of ${VERIFICATION_CATEGORIES.join('|')}`);
  }
  if (run.result !== 'pass' && run.result !== 'fail') {
    errors.push('$.result: expected pass|fail');
  }
  if (!isStr(run.startedAt)) errors.push('$.startedAt: expected ISO-8601 string');
  if (!isStr(run.finishedAt)) errors.push('$.finishedAt: expected ISO-8601 string');

  if (!Array.isArray(run.checks)) {
    errors.push('$.checks: expected array');
  } else {
    run.checks.forEach((c, i) => validateCheck(c, `$.checks[${i}]`, mode, errors));
  }
  if (!Array.isArray(run.violations)) {
    errors.push('$.violations: expected array');
  } else {
    run.violations.forEach((v, i) => validateViolation(v, `$.violations[${i}]`, errors));
  }
  if (!Array.isArray(run.artifacts) || !run.artifacts.every(isStr)) {
    errors.push('$.artifacts: expected string[]');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Derive the scope verdict from violations+severity (DEC-S3, the frozen cross-contract predicate):
 * any `blocking` ⇒ `violation`; else any `advisory` ⇒ `conditional`; else `clean`. NEVER derived
 * from `result`. The harness does NOT route on this (that is the track-side adapter); it is exposed
 * so the predicate can be asserted against the frozen contract rather than trusted.
 */
export function deriveVerdict(
  violations: ReadonlyArray<{ severity: ViolationSeverity }>,
): 'clean' | 'violation' | 'conditional' {
  if (violations.some((v) => v.severity === 'blocking')) return 'violation';
  if (violations.some((v) => v.severity === 'advisory')) return 'conditional';
  return 'clean';
}
