// Golden VerificationRun v0 fixtures — the §4 adapter-policy cases of
// spec/SPEC_DECISION_SEAM_HARNESS_TRACK_V0.md:
//   clean / blocking / advisory-only / acceptance-only / dual-target / missing-target.
//
// Each fixture is typed `VerificationRun`, so compilation is a type-conformance proof. The
// `missing-target` fixture is a STRUCTURALLY VALID VerificationRun (target is optional on the
// type) whose track-ingested check carries NO target — it FAILS CLOSED at the adapter and is
// rejected by `validateVerificationRunV0` in `ingested` mode (see validate-verification-run.ts).

import type { VerificationRun } from '../../../src/artifacts/verification-run.js';

const base = {
  schemaVersion: 1 as const,
  runId: 'run-fixture',
  commit: 'deadbeefcafe',
  branch: 'feat/example',
  env: 'test-example',
  runner: 'harness',
  command: 'harness verify',
  startedAt: '2026-06-13T09:00:00.000Z',
  finishedAt: '2026-06-13T09:00:01.000Z',
  artifactLocator: 'verification-run:run-fixture',
  artifacts: [],
};

/** clean — a scope-targeted check, passing, no violations ⇒ adapter verdict `clean`. */
export const cleanRun: VerificationRun = {
  ...base,
  runId: 'run-clean',
  artifactLocator: 'verification-run:run-clean',
  category: 'static',
  result: 'pass',
  checks: [
    {
      code: 'C2',
      category: 'static',
      pass: true,
      violations: [],
      target: { scope: { wpRef: 'BR-99/WP1' } },
    },
  ],
  violations: [],
};

/** blocking — a scope-targeted check with a `blocking` violation ⇒ adapter verdict `violation`. */
export const blockingRun: VerificationRun = {
  ...base,
  runId: 'run-blocking',
  artifactLocator: 'verification-run:run-blocking',
  category: 'static',
  result: 'fail',
  checks: [
    {
      code: 'C2',
      category: 'static',
      pass: false,
      violations: [
        { code: 'C2', path: 'Makefile', message: 'path outside declared scope', severity: 'blocking' },
      ],
      target: { scope: { wpRef: 'BR-99/WP1' } },
    },
  ],
  violations: [
    { code: 'C2', path: 'Makefile', message: 'path outside declared scope', severity: 'blocking' },
  ],
};

/** advisory-only — a scope-targeted check with only `advisory` violations ⇒ verdict `conditional`. */
export const advisoryOnlyRun: VerificationRun = {
  ...base,
  runId: 'run-advisory',
  artifactLocator: 'verification-run:run-advisory',
  category: 'static',
  result: 'pass',
  checks: [
    {
      code: 'C1',
      category: 'static',
      pass: true,
      violations: [{ code: 'C1', message: 'branch differs from expected', severity: 'advisory' }],
      target: { scope: { wpRef: 'BR-99/WP1' } },
    },
  ],
  violations: [{ code: 'C1', message: 'branch differs from expected', severity: 'advisory' }],
};

/** acceptance-only — an acceptance-targeted check (no scope) ⇒ adapter emits acceptance.run + links. */
export const acceptanceOnlyRun: VerificationRun = {
  ...base,
  runId: 'run-acceptance',
  artifactLocator: 'verification-run:run-acceptance',
  category: 'unit',
  result: 'pass',
  checks: [
    {
      code: 'T-unit',
      category: 'unit',
      pass: true,
      violations: [],
      target: {
        acceptance: {
          evidenceId: 'ev:br99-wp1:unit',
          kind: 'unit',
          criterionIds: ['BR-99/WP1/AC1', 'BR-99/WP1/AC2'],
        },
      },
    },
  ],
  violations: [],
};

/** dual-target — one check carries BOTH scope and acceptance ⇒ adapter fans to both surfaces. */
export const dualTargetRun: VerificationRun = {
  ...base,
  runId: 'run-dual',
  artifactLocator: 'verification-run:run-dual',
  category: 'integration',
  result: 'pass',
  checks: [
    {
      code: 'T-integration',
      category: 'integration',
      pass: true,
      violations: [],
      target: {
        scope: { wpRef: 'BR-99/WP2' },
        acceptance: {
          evidenceId: 'ev:br99-wp2:integration',
          kind: 'integration',
          criterionIds: ['BR-99/WP2/AC1'],
        },
      },
    },
  ],
  violations: [],
};

/**
 * missing-target — a structurally valid run whose check has NO target. The adapter FAILS CLOSED
 * (never auto-itemized, never glob-routed). `validateVerificationRunV0(..., { mode: 'ingested' })`
 * rejects it; the bare structural validator accepts it (target is optional on the type).
 */
export const missingTargetRun: VerificationRun = {
  ...base,
  runId: 'run-missing-target',
  artifactLocator: 'verification-run:run-missing-target',
  category: 'static',
  result: 'pass',
  checks: [
    {
      code: 'C2',
      category: 'static',
      pass: true,
      violations: [],
    },
  ],
  violations: [],
};

/** Every well-formed fixture (the missing-target case is intentionally adapter-rejected). */
export const wellFormedRuns: VerificationRun[] = [
  cleanRun,
  blockingRun,
  advisoryOnlyRun,
  acceptanceOnlyRun,
  dualTargetRun,
  missingTargetRun,
];
