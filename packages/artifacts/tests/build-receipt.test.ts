import { describe, expect, it } from 'vitest';
import { candidateInventoryDigest, verifyBuilderReceipt, verifyServedCandidate } from '../src/server/build-receipt.js';
import type { BuilderReceiptExpectation } from '../src/server/build-receipt.js';
import { ArtifactOperationError, classifyArtifactFailure } from '../src/server/failures.js';

// A-LIVE §8.4: binding + generation → job/run/attempt → commit/tree → descriptor, lock, integrity
// receipt, image, platform, public env, staging → candidate (all file hashes) → release.
const sha256 = 'a'.repeat(64);
const candidateFiles = [{ path: 'index.html', bytes: 5, sha256 }, { path: 'assets/app.js', bytes: 7, sha256 }];
const joined = ['storageScopeId', 'artifactId', 'bindingGeneration', 'jobId', 'runId', 'attempt', 'commitSha',
  'treeSha', 'descriptorDigest', 'lockfileDigest', 'integrityReceiptDigest', 'builderImageDigest', 'platform',
  'publicEnvHashes', 'stagingPolicy', 'stagingDigest', 'candidateDigest'] as const;

function evidenceFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    storageScopeId: 'scope-1', artifactId: '01234567-89ab-cdef-0123-456789abcdef', bindingGeneration: 3,
    jobId: 'job-9', runId: 'run-4', attempt: 2, commitSha: 'b'.repeat(40), treeSha: 'c'.repeat(40),
    descriptorDigest: sha256, lockfileDigest: sha256, integrityReceiptDigest: sha256,
    builderImageDigest: `sha256:${sha256}`, platform: 'linux/amd64', nodeVersion: '24.11.0', npmVersion: '11.6.2',
    publicEnvHashes: { VITE_EXAMPLE: sha256 }, stagingPolicy: 'supervisor/v1', stagingDigest: sha256,
    candidateDigest: candidateInventoryDigest(candidateFiles), candidateFiles,
    releaseId: '01234567-89ab-cdef-0123-456789abcdee', manifestDigest: sha256,
    ...overrides,
  };
}
function expectationFrom(evidence: Record<string, unknown>): BuilderReceiptExpectation {
  return Object.fromEntries(joined.map(key => [key, evidence[key]])) as unknown as BuilderReceiptExpectation;
}
function refusal(run: () => unknown, code: string, status: number, reason?: string) {
  let failure: unknown;
  try { run(); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(ArtifactOperationError);
  expect(failure).toMatchObject({ kind: code });
  expect(classifyArtifactFailure(failure, {
    invocationId: 'verification', operation: 'publish', phase: 'verify', commitState: 'not_committed',
  })).toMatchObject({ publicCode: code, httpStatus: status, commitState: 'not_committed', retriable: false,
    ...(reason === undefined ? {} : { details: { reason } }) });
}
const invalid = (evidence: Record<string, unknown>, expected = expectationFrom(evidenceFixture())) =>
  refusal(() => verifyBuilderReceipt(evidence, expected), 'verification_failed', 422);

describe('GB1 builder-attested receipt evidence', () => {
  it('should verify complete aligned evidence, including unpublished and additive fields', () => {
    const evidence = evidenceFixture();
    expect(verifyBuilderReceipt(evidence, expectationFrom(evidence))).toMatchObject({ jobId: 'job-9', attempt: 2 });
    const pending = evidenceFixture({ releaseId: null, manifestDigest: null, futureField: 'additive' });
    expect(verifyBuilderReceipt(pending, expectationFrom(pending))).toMatchObject({ releaseId: null });
  });

  it('should refuse any missing mandatory field', () => {
    for (const key of Object.keys(evidenceFixture())) {
      const stripped = evidenceFixture();
      delete stripped[key];
      invalid(stripped);
    }
  });

  it('should refuse malformed mandatory values without trusting them', () => {
    for (const override of [{ artifactId: 'not-a-uuid' }, { attempt: 0 }, { bindingGeneration: 1.5 },
      { commitSha: 'z'.repeat(40) }, { treeSha: 'x'.repeat(64) }, { descriptorDigest: 'sha256:short' },
      { builderImageDigest: sha256 }, { platform: 'linux' }, { nodeVersion: 'latest' },
      { publicEnvHashes: { VITE_A: 'nope' } }, { publicEnvHashes: { 'BAD-NAME': sha256 } }, { stagingPolicy: '' },
      { jobId: ' job-9' }, { releaseId: 'abc' }, { manifestDigest: 'deadbeef' }]) {
      const evidence = evidenceFixture(override);
      invalid(evidence, expectationFrom(evidence));
    }
  });

  it('should falsify the candidate digest against the complete file inventory', () => {
    invalid(evidenceFixture({ candidateDigest: sha256 }));
    invalid(evidenceFixture({ candidateDigest: candidateInventoryDigest([candidateFiles[0], { ...candidateFiles[1], bytes: 999 }]) }));
    for (const files of [[], [{ path: '../escape.js', bytes: 1, sha256 }], [{ path: 'a.js', bytes: -1, sha256 }],
      [{ path: 'a.js', bytes: 1, sha256 }, { path: 'a.js', bytes: 2, sha256 }], [{ path: 'a.js', bytes: 1, sha256: 'x' }],
      [{ path: 'a.js', bytes: 16 * 1024 * 1024 + 1, sha256 }]]) {
      invalid(evidenceFixture({ candidateFiles: files, candidateDigest: candidateInventoryDigest(files) }));
    }
  });

  it('should refuse foreign scope, job, run, attempt, source, inputs and candidate as git_build_job_mismatch', () => {
    const evidence = evidenceFixture();
    const expected = expectationFrom(evidence);
    const foreign: Record<(typeof joined)[number], [unknown, string]> = {
      storageScopeId: ['scope-other', 'scope'], artifactId: ['01234567-89ab-cdef-0123-456789abcd00', 'scope'],
      bindingGeneration: [4, 'scope'], jobId: ['job-other', 'job'], runId: ['run-other', 'job'], attempt: [3, 'job'],
      commitSha: ['d'.repeat(40), 'source'], treeSha: ['e'.repeat(40), 'source'], descriptorDigest: ['b'.repeat(64), 'inputs'],
      lockfileDigest: ['b'.repeat(64), 'inputs'], integrityReceiptDigest: ['b'.repeat(64), 'inputs'],
      builderImageDigest: [`sha256:${'b'.repeat(64)}`, 'inputs'], platform: ['linux/arm64', 'inputs'],
      publicEnvHashes: [{ VITE_EXAMPLE: 'b'.repeat(64) }, 'inputs'], stagingPolicy: ['supervisor/v2', 'inputs'],
      stagingDigest: ['b'.repeat(64), 'inputs'], candidateDigest: ['b'.repeat(64), 'candidate'],
    };
    for (const key of joined) {
      const [value, reason] = foreign[key];
      refusal(() => verifyBuilderReceipt(evidence, { ...expected, [key]: value }), 'git_build_job_mismatch', 409, reason);
    }
    refusal(() => verifyBuilderReceipt(evidence, { ...expected, publicEnvHashes: {} }), 'git_build_job_mismatch', 409, 'inputs');
  });

  it('should refuse served bytes differing from the sealed candidate', () => {
    const evidence = verifyBuilderReceipt(evidenceFixture(), expectationFrom(evidenceFixture()));
    expect(() => verifyServedCandidate(evidence, [...candidateFiles].reverse())).not.toThrow();
    for (const served of [[candidateFiles[0]], [candidateFiles[0], { ...candidateFiles[1], sha256: 'b'.repeat(64) }],
      [...candidateFiles, { path: 'extra.js', bytes: 1, sha256 }]]) {
      refusal(() => verifyServedCandidate(evidence, served), 'verification_failed', 422);
    }
  });

  it('should bind the candidate inventory digest to canonical bytes independent of order', () => {
    expect(candidateInventoryDigest(candidateFiles)).toBe(candidateInventoryDigest([...candidateFiles].reverse()));
    expect(candidateInventoryDigest(candidateFiles)).toMatch(/^[a-f0-9]{64}$/);
    expect(candidateInventoryDigest(candidateFiles)).not.toBe(candidateInventoryDigest([candidateFiles[0],
      { ...candidateFiles[1], bytes: 8 }]));
  });
});
