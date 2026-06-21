// @sentropic/harness — neutral, host-agnostic code-work / PR-workflow tooling.
//
// Tooling-only: no product-runtime imports (no Drizzle/Hono/Svelte/Mistral), no
// `@sentropic/*` deps, and NO track import — harness only EMITS neutral artifacts.

export const HARNESS_PACKAGE = '@sentropic/harness' as const;

// Neutral artifact emitted by checks (ingested by a track-side adapter).
export type {
  VerificationRun,
  VerificationCheck,
  VerificationTarget,
  VerificationCategory,
  Violation,
  ViolationSeverity,
  CheckResult,
} from './artifacts/verification-run.js';

// Dependency-free runtime validator + frozen verdict-derivation predicate for the v0 seam.
export {
  validateVerificationRunV0,
  deriveVerdict,
  VERIFICATION_CATEGORIES,
  VIOLATION_SEVERITIES,
} from './artifacts/validate-verification-run.js';
export type {
  ValidationMode,
  ValidateOptions,
  ValidationResult,
} from './artifacts/validate-verification-run.js';

// Neutral narrative artifact emitted by method/branch verbs (ingested by a track-side adapter).
export type {
  WorkEvent,
  WorkEventVerb,
  WorkEventStatus,
  WorkEventValue,
} from './artifacts/work-event.js';
export { toWorkEvent } from './run/work-event.js';
export type { WorkEventInput, WorkEventContext } from './run/work-event.js';

// Policy SPI + profiles (policy-as-data; engine is generic).
export type { HarnessProfile } from './profile/profile.js';
export { sentropicProfile } from './profile/sentropic.js';
export { stubProfile } from './profile/stub.js';

// BRANCH.md parser.
export { parseBranchMd } from './branch-md/parse.js';
export type { ParsedBranchMd, ParsedLot, ParsedLotItem } from './branch-md/parse.js';

// Scope classification.
export { classifyPath, matchGlob, globToRegExp } from './scope/scope-boundary.js';
export type { ScopeBoundary, PathClass } from './scope/scope-boundary.js';

// Checks (C1 branch, C2 scope) + neutral run assembly.
export { checkBranch } from './checks/branch-check.js';
export type { BranchCheckInput } from './checks/branch-check.js';
export { checkScope } from './checks/scope-check.js';
export type { ScopeCheckInput } from './checks/scope-check.js';
export { toVerificationRun } from './run/emit.js';
export type { NamedCheck, VerificationContext } from './run/emit.js';

// Harness skill-pack inventory — the native superpowers-surface replacement.
export { HARNESS_SKILLS, HOST_SKILL_DIR, isHostId } from './skills/manifest.js';
export type { SkillEntry, HostId } from './skills/manifest.js';

// Pure, arg-based CLI driver (the `harness` bin is a thin wrapper over this).
export { runHarnessCli } from './cli/run.js';
