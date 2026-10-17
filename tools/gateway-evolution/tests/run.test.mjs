/**
 * Pure harness tests part 1: closed v1 input validation (both program arms).
 * Runs under Node's test runner in the pinned slim container via
 * `gateway-harness-test MODE=pure`; it never spawns Make/Docker.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  GatewayInputError,
  assertPinnedProjection,
  buildBundleIndex,
  checkManifest,
  classifyPhase,
  compareExternalProjection,
  externalProjection,
  main,
  parseConsumerInput,
  validateConsumerInput,
  verifyBundleIndex,
  verifyConsumerReceipt,
  verifyMergeParents,
} from '../run.mjs';

const hex = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

const packageRow = (overrides = {}) => ({
  lockLocation: 'node_modules/@sentropic/llm-mesh',
  name: '@sentropic/llm-mesh',
  version: '0.27.0',
  resolved: 'https://registry.npmjs.org/@sentropic/llm-mesh/-/llm-mesh-0.27.0.tgz',
  integrity: 'sha512-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  tarballSha256: hex('tarball'),
  sourceIdentity: 'registry:sha512-aa',
  ...overrides,
});

const candidateInput = (overrides = {}) => ({
  schemaVersion: 1,
  program: 'gateway',
  phase: 'pr1-candidate',
  artifactKind: 'candidate',
  contractSha256: hex('gateway-contract-v1'),
  artifactManifest: {
    sha256: hex('manifest'),
    path: '.github/gateway-candidates/pr1-candidate/INDEX/manifest.json',
  },
  packages: [packageRow()],
  candidateBundle: {
    root: '.github/gateway-candidates/pr1-candidate/INDEX/',
    indexPath: '.github/gateway-candidates/pr1-candidate/INDEX/bundle-index.json',
    bundleSha256: 'b'.repeat(64),
  },
  releaseLockSha256: 'c'.repeat(64),
  mode: 'scoped',
  scopes: ['packages/h2a/test/gateway-consumer-ci.test.js'],
  profiles: ['gateway-messaging', 'gateway-runtime'],
  programCoverage: [
    {
      program: 'gateway',
      phase: 'pr1-candidate',
      contractSha256: hex('gateway-contract-v1'),
      profiles: ['gateway-messaging', 'gateway-runtime'],
    },
  ],
  ...overrides,
});

const withIndex = (input) => {
  const bundleSha256 = 'b'.repeat(64);
  return {
    ...input,
    artifactManifest: {
      sha256: input.artifactManifest.sha256,
      path: `.github/gateway-candidates/${input.phase}/${bundleSha256}/manifest.json`,
    },
    candidateBundle: {
      root: `.github/gateway-candidates/${input.phase}/${bundleSha256}/`,
      indexPath: `.github/gateway-candidates/${input.phase}/${bundleSha256}/bundle-index.json`,
      bundleSha256,
    },
  };
};

const failsWith = (fn, code) => {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof GatewayInputError, `expected GatewayInputError, got ${error}`);
    assert.equal(error.code, code);
    return;
  }
  assert.fail(`expected failure with code ${code}`);
};

describe('closed v1 input validation', () => {
  it('rejects escaped duplicate members and open nested objects', () => {
    failsWith(() => parseConsumerInput('{"schemaVersion":1,"program":"gateway","phase":"none","\\u0070hase":"none"}'), 'duplicate-member');
    const input = withIndex(candidateInput());
    failsWith(() => validateConsumerInput({ ...input, candidateBundle: { ...input.candidateBundle, extra: true } }), 'bad-bundle');
    failsWith(() => validateConsumerInput({ ...input, artifactManifest: { ...input.artifactManifest, extra: true } }), 'bad-manifest');
  });

  it('requires tarball/source identity and one sorted coverage row per program', () => {
    const input = withIndex(candidateInput());
    failsWith(() => validateConsumerInput({ ...input, packages: [packageRow({ tarballSha256: '' })] }), 'bad-digest');
    failsWith(() => validateConsumerInput({ ...input, programCoverage: [...input.programCoverage, ...input.programCoverage] }), 'bad-coverage');
    failsWith(() => validateConsumerInput({ ...input, profiles: ['gateway-runtime'], programCoverage: [{ ...input.programCoverage[0], profiles: ['gateway-runtime'] }] }), 'bad-profiles');
  });
  it('accepts none as exactly three fields', () => {
    assert.deepEqual(
      validateConsumerInput({ schemaVersion: 1, program: 'gateway', phase: 'none' }),
      { schemaVersion: 1, program: 'gateway', phase: 'none' },
    );
  });

  it('rejects active fields on none', () => {
    failsWith(
      () => validateConsumerInput({ schemaVersion: 1, program: 'gateway', phase: 'none', mode: 'scoped' }),
      'bad-phase',
    );
  });

  it('accepts a gateway candidate with a matching bundle root', () => {
    const accepted = validateConsumerInput(withIndex(candidateInput()));
    assert.equal(accepted.phase, 'pr1-candidate');
  });

  it('accepts a registry candidate on the same validator', () => {
    const accepted = validateConsumerInput(
      withIndex(
        candidateInput({
          program: 'registry',
          phase: 'r5-candidate',
          profiles: ['gateway-messaging', 'gateway-runtime', 'registry-runtime'],
          programCoverage: [
            {
              program: 'registry',
              phase: 'r5-candidate',
              contractSha256: hex('gateway-contract-v1'),
              profiles: ['gateway-messaging', 'gateway-runtime', 'registry-runtime'],
            },
          ],
        }),
      ),
    );
    assert.equal(accepted.program, 'registry');
  });

  it('accepts a published input whose embedded text hashes to its manifest digest', () => {
    const text = '{"tuple":"pr1-final"}';
    const accepted = validateConsumerInput({
      schemaVersion: 1,
      program: 'gateway',
      phase: 'pr1-published',
      artifactKind: 'published',
      contractSha256: hex('gateway-contract-v1'),
      artifactManifest: { sha256: hex(text) },
      artifactManifestText: text,
      packages: [packageRow()],
      releaseLockSha256: 'c'.repeat(64),
      mode: 'aggregate',
      profiles: ['gateway-messaging', 'gateway-runtime'],
      programCoverage: [
        {
          program: 'gateway',
          phase: 'pr1-published',
          contractSha256: hex('gateway-contract-v1'),
          profiles: ['gateway-messaging', 'gateway-runtime'],
        },
      ],
    });
    assert.equal(accepted.artifactKind, 'published');
  });

  it('rejects duplicate JSON members before schema checks', () => {
    failsWith(() => parseConsumerInput('{"schemaVersion":1,"schemaVersion":1,"program":"gateway","phase":"none"}'), 'duplicate-member');
  });

  it('rejects unknown top-level keys and mismatched program/phase pairs', () => {
    failsWith(() => validateConsumerInput(withIndex({ ...candidateInput(), extra: 1 })), 'unknown-key');
    failsWith(() => validateConsumerInput(withIndex(candidateInput({ phase: 'r5-candidate' }))), 'bad-phase');
  });

  it('rejects wrong artifactKind, short digests, and missing candidateBundle', () => {
    failsWith(() => validateConsumerInput(withIndex(candidateInput({ artifactKind: 'published' }))), 'bad-kind');
    failsWith(() => validateConsumerInput(withIndex(candidateInput({ contractSha256: 'abc' }))), 'bad-digest');
    const { candidateBundle: _dropped, ...noBundle } = withIndex(candidateInput());
    failsWith(() => validateConsumerInput(noBundle), 'bad-bundle');
  });

  it('fails truly external unpinned rows with external-row-unpinned before drift', () => {
    failsWith(
      () => validateConsumerInput(withIndex(candidateInput({ packages: [packageRow({ resolved: '' })] }))),
      'external-row-unpinned',
    );
    failsWith(
      () => validateConsumerInput(withIndex(candidateInput({ packages: [packageRow({ integrity: '' })] }))),
      'external-row-unpinned',
    );
  });

  it('rejects aggregate scopes and coverage that drops the active row', () => {
    failsWith(() => validateConsumerInput(withIndex(candidateInput({ mode: 'aggregate', scopes: ['x'] }))), 'bad-mode');
    failsWith(
      () => validateConsumerInput(withIndex(candidateInput({ programCoverage: [] }))),
      'bad-coverage',
    );
  });
});

describe('run-manifest validation', () => {
  const toolOnly = () => ({
    kind: 'tool-only',
    image: { reference: 'node:24-bookworm-slim', digest: 'd'.repeat(64) },
    pythonFree: true,
    createdBy: 'L0',
    notes: 'synthetic fixtures only',
  });

  it('accepts a tool-only manifest with matching image identity', () => {
    const accepted = checkManifest(toolOnly(), {
      kind: 'tool-only',
      expectImageReference: 'node:24-bookworm-slim',
      expectImageDigest: 'd'.repeat(64),
    });
    assert.equal(accepted.kind, 'tool-only');
  });

  it('rejects unknown manifest keys, wrong kinds, and image drift', () => {
    failsWith(() => checkManifest({ ...toolOnly(), extra: 1 }), 'bad-manifest');
    failsWith(() => checkManifest(toolOnly(), { kind: 'candidate' }), 'bad-manifest');
    failsWith(
      () => checkManifest(toolOnly(), { expectImageDigest: 'e'.repeat(64) }),
      'image-drift',
    );
    failsWith(
      () => checkManifest(toolOnly(), { expectImageReference: 'node:25-bookworm-slim' }),
      'image-drift',
    );
  });

  it('fails later-lot commands closed until their lot implements them', async () => {
    const fs = { readFile: async () => '{}' };
    for (const command of ['packed-gate', 'consumer-gate', 'release-check', 'candidate-bundle', 'client-fixtures', 'client-e2e']) {
      await assert.rejects(
        main([command], { fs, out: () => {} }),
        (error) => error instanceof GatewayInputError && error.code === 'not-implemented',
      );
    }
    await assert.rejects(main(['nope'], { fs, out: () => {} }), { code: 'usage' });
  });
});

describe('candidate bundle index', () => {
  const entries = () => [
    { path: 'manifest.json', size: 12, sha256: 'a'.repeat(64) },
    { path: 'sibling/receipts.json', size: 8, sha256: 'b'.repeat(64) },
  ];

  it('builds a deterministic index whose suffix hashes the exact bytes', () => {
    const first = buildBundleIndex([...entries()].reverse());
    const second = buildBundleIndex(entries());
    assert.equal(first.bundleSha256, second.bundleSha256);
    assert.deepEqual(
      first.files.map((file) => file.path),
      ['manifest.json', 'sibling/receipts.json'],
    );
  });

  it('rejects absolute paths, traversal, duplicates, and bad digests', () => {
    failsWith(() => buildBundleIndex([{ path: '/abs.json', size: 1, sha256: 'a'.repeat(64) }]), 'bad-path');
    failsWith(() => buildBundleIndex([{ path: '../up.json', size: 1, sha256: 'a'.repeat(64) }]), 'bad-path');
    failsWith(
      () => buildBundleIndex([entries()[0], { ...entries()[0], size: 9 }]),
      'bad-bundle',
    );
  });

  it('verifies exact bytes and refuses extra, altered, missing, linked, or LFS members', () => {
    const index = buildBundleIndex(entries());
    const listed = entries().map((entry) => ({ ...entry, kind: 'file' }));
    assert.deepEqual(verifyBundleIndex(index, [...listed, { path: 'bundle-index.json', kind: 'file' }]), { files: 2 });
    failsWith(
      () => verifyBundleIndex(index, [...listed, { path: 'rogue.tgz', size: 1, sha256: 'c'.repeat(64), kind: 'file' }]),
      'bundle-mismatch',
    );
    failsWith(
      () => verifyBundleIndex(index, [{ ...listed[0], size: 13 }, listed[1]]),
      'bundle-mismatch',
    );
    failsWith(() => verifyBundleIndex(index, [listed[0]]), 'bundle-mismatch');
    failsWith(
      () => verifyBundleIndex(index, [{ ...listed[0], kind: 'symlink' }, listed[1]]),
      'unsafe-member',
    );
    failsWith(
      () => verifyBundleIndex(index, [{ ...listed[0], kind: 'lfs' }, listed[1]]),
      'unsafe-member',
    );
  });
});

describe('phase classifier and merge parents (GW8-m1)', () => {
  it('leaves committed-lock jobs inactive on every candidate phase', () => {
    for (const phase of ['pr1-candidate', 'pr2-candidate', 'r5-candidate', 'r7b-candidate']) {
      const program = phase.startsWith('pr') || phase.startsWith('baseline') ? 'gateway' : 'registry';
      const decision = classifyPhase(program, phase);
      assert.equal(decision.buildCommittedLock, false);
      assert.equal(decision.reason, 'not-applicable (candidate-phase, committed lock)');
    }
  });

  it('restores ordinary jobs for published, baseline, and none', () => {
    assert.equal(classifyPhase('gateway', 'pr1-published').buildCommittedLock, true);
    assert.equal(classifyPhase('gateway', 'baseline-662').buildCommittedLock, true);
    assert.equal(classifyPhase('registry', 'none').buildCommittedLock, true);
  });

  it('accepts matching merge parents and refuses unrelated merges', async () => {
    const git = { parentOf: async (_sha, n) => (n === 1 ? 'base' : 'head') };
    assert.deepEqual(
      await verifyMergeParents({ mergeSha: 'merge', baseSha: 'base', headSha: 'head' }, git),
      { mergeSha: 'merge', baseSha: 'base', headSha: 'head' },
    );
    await assert.rejects(
      verifyMergeParents({ mergeSha: 'merge', baseSha: 'other', headSha: 'head' }, git),
      (error) => error instanceof GatewayInputError && error.code === 'unrelated-merge',
    );
  });

  it('treats unresolvable parents as unreadable base evidence', async () => {
    const failing = { parentOf: async () => { throw new Error('fetch failed'); } };
    await assert.rejects(
      verifyMergeParents({ mergeSha: 'merge', baseSha: 'base', headSha: 'head' }, failing),
      (error) => error instanceof GatewayInputError && error.code === 'unreadable-base-evidence',
    );
  });
});

describe('external closure and receipts (GW6-M1/GW7-M1)', () => {
  const workspaces = ['@sentropic/track', '@sentropic/h2a'];
  const lockRows = () => [
    { location: 'node_modules/@sentropic/llm-mesh', name: '@sentropic/llm-mesh', version: '0.27.0', resolved: 'https://r/m.tgz', integrity: 'sha512-mm' },
    { location: 'packages/focus/node_modules/@sentropic/track', name: '@sentropic/track', version: '0.86.0', resolved: '', integrity: '' },
    { location: 'node_modules/lodash', name: 'lodash', version: '4.17.21', resolved: 'https://r/l.tgz', integrity: 'sha512-ll' },
  ];

  it('excludes every workspace-name copy by identity, never by path or pins', () => {
    const projection = externalProjection(lockRows(), workspaces);
    assert.deepEqual(
      projection.map((row) => row.name),
      ['@sentropic/llm-mesh'],
    );
  });

  it('fails unpinned external rows with external-row-unpinned before drift', () => {
    const projection = externalProjection(
      [{ location: 'x', name: '@sentropic/llm-mesh', version: '1.0.0', resolved: 'https://r', integrity: '' }],
      [],
    );
    failsWith(() => assertPinnedProjection(projection), 'external-row-unpinned');
  });

  it('refuses missing, extra, or changed external rows (drift)', () => {
    const declared = assertPinnedProjection(externalProjection([lockRows()[0]], []));
    failsWith(() => compareExternalProjection([], declared), 'external-drift');
    failsWith(
      () => compareExternalProjection([...declared, { ...declared[0], location: 'other', resolved: 'https://r/o.tgz', integrity: 'sha512-oo' }], declared),
      'external-drift',
    );
    failsWith(
      () => compareExternalProjection([{ ...declared[0], version: '0.99.0' }], declared),
      'external-drift',
    );
    assert.deepEqual(compareExternalProjection(declared, declared), declared);
  });

  const receipt = (overrides = {}) => ({
    program: 'gateway',
    phase: 'pr1-candidate',
    conclusion: 'success',
    jobs: [{ name: 'tests', conclusion: 'success' }],
    runId: 42,
    attempt: 1,
    headSha: 'head',
    baseSha: 'base',
    mergeSha: 'merge',
    inputSha256: 'i'.repeat(64),
    manifestSha256: 'm'.repeat(64),
    releaseLockSha256: 'l'.repeat(64),
    declaredReleaseLockSha256: 'l'.repeat(64),
    ...overrides,
  });

  const expectedOwn = () => ({
    program: 'gateway',
    phase: 'pr1-candidate',
    runId: 42,
    attempt: 1,
    headSha: 'head',
    baseSha: 'base',
    mergeSha: 'merge',
    inputSha256: 'i'.repeat(64),
    manifestSha256: 'm'.repeat(64),
    releaseLockSha256: 'l'.repeat(64),
  });

  it('verifies a companion-own receipt and refuses stale or incomplete evidence', () => {
    assert.deepEqual(verifyConsumerReceipt(receipt(), expectedOwn()).verified, true);
    failsWith(() => verifyConsumerReceipt(null, expectedOwn()), 'ci-receipt-unavailable');
    failsWith(
      () => verifyConsumerReceipt(receipt({ headSha: 'old' }), expectedOwn()),
      'stale-head',
    );
    failsWith(
      () => verifyConsumerReceipt(receipt({ conclusion: 'failure' }), expectedOwn()),
      'incomplete-evidence',
    );
    failsWith(
      () => verifyConsumerReceipt(receipt({ releaseLockSha256: 'x'.repeat(64) }), expectedOwn()),
      'lock-mismatch',
    );
  });

  it('accepts a release bump with an unchanged external projection (inherited)', () => {
    const declared = assertPinnedProjection(externalProjection([lockRows()[0]], []));
    const ok = verifyConsumerReceipt(
      receipt({ releaseLockSha256: 'n'.repeat(64), declaredReleaseLockSha256: 'l'.repeat(64) }),
      { ...expectedOwn(), allowLockChange: true, actualProjection: declared, declaredProjection: declared },
    );
    assert.equal(ok.verified, true);
    failsWith(
      () => verifyConsumerReceipt(
        receipt({ releaseLockSha256: 'n'.repeat(64) }),
        { ...expectedOwn(), allowLockChange: true, actualProjection: [], declaredProjection: declared },
      ),
      'external-drift',
    );
  });
});
