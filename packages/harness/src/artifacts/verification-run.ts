// Neutral verification artifact emitted by harness checks.
//
// `VerificationRun` is the host-agnostic JSON a check run produces. harness EMITS it
// and never writes into `@sentropic/track`; a track-side adapter ingests it. It is a
// superset of track's `TestRun{ commit, env, runner, result, at }` so the seam holds.
//
// `category` is the BR25 **D3** verification taxonomy (APPROVED 2026-06-04), bound to this
// field. (`security` is added when the security verify-hook lands — out of this slice.)

export type VerificationCategory =
  | 'none'
  | 'static'
  | 'unit'
  | 'integration'
  | 'e2e'
  | 'ci'
  | 'uat';

export type ViolationSeverity = 'advisory' | 'blocking';

/** A single policy violation found by a check. */
export interface Violation {
  /** Check code, e.g. 'C1' (branch), 'C2' (scope). */
  code: string;
  /** Offending path, when the violation is path-scoped (C2). */
  path?: string;
  message: string;
  /** D5 Layer A checks emit `advisory`; `blocking` is reserved (e.g. C8). */
  severity: ViolationSeverity;
}

/** The return shape of an individual check function. */
export interface CheckResult {
  pass: boolean;
  violations: Violation[];
  /** Set when the check was deliberately bypassed (documented exception). */
  bypass?: { reason: string };
}

/** One check's contribution inside a VerificationRun. */
export interface VerificationCheck {
  code: string;
  category: VerificationCategory;
  pass: boolean;
  violations: Violation[];
}

export interface VerificationRun {
  schemaVersion: 1;
  runId: string;
  commit: string;
  branch: string;
  env: string;
  runner: string;
  category: VerificationCategory;
  command: string;
  result: 'pass' | 'fail';
  /** ISO-8601 timestamps. */
  startedAt: string;
  finishedAt: string;
  checks: VerificationCheck[];
  /** Flattened union of all check violations (convenience for ingesters). */
  violations: Violation[];
  /** Opaque references to produced artifacts (paths/urls). */
  artifacts: string[];
}
