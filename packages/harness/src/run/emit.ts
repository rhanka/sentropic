import type {
  CheckResult,
  VerificationRun,
  VerificationCheck,
  VerificationCategory,
  Violation,
} from '../artifacts/verification-run.js';

export interface NamedCheck {
  code: string;
  category: VerificationCategory;
  result: CheckResult;
}

export interface VerificationContext {
  runId: string;
  commit: string;
  branch: string;
  env: string;
  runner: string;
  category: VerificationCategory;
  command: string;
  startedAt: string;
  finishedAt: string;
  artifacts?: string[];
  /**
   * Immutable locator for the full run JSON (DEC-S2). Producer-supplied; when omitted a
   * deterministic `verification-run:{runId}` placeholder is used so the field stays REQUIRED
   * on the artifact. Immutability is a producer guarantee, not enforced here.
   */
  artifactLocator?: string;
}

/**
 * Assemble a NEUTRAL `VerificationRun` from check results. harness EMITS this artifact and
 * never writes into `@sentropic/track` — a track-side adapter ingests it (no track import here).
 */
export function toVerificationRun(checks: NamedCheck[], ctx: VerificationContext): VerificationRun {
  const verificationChecks: VerificationCheck[] = checks.map((c) => ({
    code: c.code,
    category: c.category,
    pass: c.result.pass,
    violations: c.result.violations,
  }));
  const violations: Violation[] = checks.flatMap((c) => c.result.violations);
  const pass = verificationChecks.every((c) => c.pass);
  return {
    schemaVersion: 1,
    runId: ctx.runId,
    commit: ctx.commit,
    branch: ctx.branch,
    env: ctx.env,
    runner: ctx.runner,
    category: ctx.category,
    command: ctx.command,
    result: pass ? 'pass' : 'fail',
    startedAt: ctx.startedAt,
    finishedAt: ctx.finishedAt,
    checks: verificationChecks,
    violations,
    artifactLocator: ctx.artifactLocator ?? `verification-run:${ctx.runId}`,
    artifacts: ctx.artifacts ?? [],
  };
}
