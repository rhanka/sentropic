// Neutral verification artifact emitted by harness checks.
//
// `VerificationRun` is the host-agnostic JSON a check run produces. harness EMITS it
// and never writes into `@sentropic/track`; a track-side adapter ingests it. It is a
// superset of track's `TestRun{ commit, env, runner, result, at }` so the seam holds.
//
// `category` is the BR25 **D3** verification taxonomy (APPROVED 2026-06-04), bound to this
// field. `security` is reserved NOW as a frozen v0 slot (DEC §2 / §6): adding an enum value
// after the freeze would be a major bump, so the slot is locked even though the security
// verify-hook is not wired yet. In v0 `security` stays schema-artifact-only / OFF-WIRE (OQ-7).

export type VerificationCategory =
  | 'none'
  | 'static'
  | 'unit'
  | 'integration'
  | 'e2e'
  | 'ci'
  | 'uat'
  | 'security';

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

/**
 * Structured evidence target for a single check (DEC-S1, the freeze keystone).
 *
 * Carried PER-CHECK (not per-run) because one `harness verify` aggregates N checks that can
 * span multiple WPs / acceptance criteria. A track-side adapter routes from the target, never
 * from `category`/`branch`/`commit`/path globs (DEC-S4). ≥1 of `scope`|`acceptance` is required
 * for any TRACK-INGESTED check; a check with no target FAILS CLOSED at the adapter (never
 * auto-itemized, never glob-routed). The harness does NOT enforce that here — `target` is
 * optional on the type so non-ingested / producer-local checks remain representable.
 */
export interface VerificationTarget {
  /** present ⇒ adapter emits `scope.verification` (verdict derived from violations+severity). */
  scope?: {
    /** exact `scope.declare` itemId / stable scope key (no inference). */
    wpRef: string;
  };
  /** present ⇒ adapter emits `acceptance.run` (+ one `acceptance.link` per criterionId). */
  acceptance?: {
    /**
     * Caller-supplied DETERMINISTIC evidence key (DEC §7 M2=B): the harness supplies this key
     * on `acceptance.link` and `acceptance.run` references it — single-phase, replayable,
     * retry-safe. It is NOT a server-minted id.
     */
    evidenceId: string;
    kind: 'unit' | 'integration' | 'e2e' | 'manual';
    criterionIds?: string[];
  };
}

/** One check's contribution inside a VerificationRun. */
export interface VerificationCheck {
  code: string;
  category: VerificationCategory;
  pass: boolean;
  violations: Violation[];
  /**
   * Structured evidence target (DEC-S1). ≥1 of `scope`|`acceptance` is required for a
   * track-ingested check; absent ⇒ the track-side adapter FAILS CLOSED (never auto-itemized,
   * never glob-routed). Optional on the type so producer-local checks stay representable.
   */
  target?: VerificationTarget;
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
  /**
   * Immutable locator for the full VerificationRun JSON — the CANONICAL evidence (DEC-S2).
   * `scope.verification.violations: string[]` is only a display/index projection of this run.
   * Immutability is a PRODUCER guarantee (the track adapter RECORDS the locator, never verifies
   * it — OQ-3); not validated here. REQUIRED.
   */
  artifactLocator: string;
  /** Opaque references to OTHER produced artifacts (paths/urls). */
  artifacts: string[];
}
