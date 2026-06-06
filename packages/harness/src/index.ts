// @sentropic/harness — neutral, host-agnostic code-work / PR-workflow tooling.
//
// Public barrel. Populated lot by lot:
//   - artifacts/ : neutral VerificationRun (and later WorkEvent) emitted by checks.
//   - profile/   : HarnessProfile SPI + the `sentropic` profile (policy-as-data).
//   - branch-md/ : BRANCH.md parser.
//   - scope/     : ScopeBoundary path classification.
//   - checks/    : C1 branch-check, C2 scope-check (advisory; D5 Layer A).
//
// Tooling-only: no product-runtime imports (no Drizzle/Hono/Svelte/Mistral), no
// `@sentropic/*` deps, and NO track import — harness only EMITS neutral artifacts.

export const HARNESS_PACKAGE = '@sentropic/harness' as const;

export type {
  VerificationRun,
  VerificationCheck,
  VerificationCategory,
  Violation,
  ViolationSeverity,
  CheckResult,
} from './artifacts/verification-run.js';

export type { HarnessProfile } from './profile/profile.js';
export { sentropicProfile } from './profile/sentropic.js';
export { stubProfile } from './profile/stub.js';
