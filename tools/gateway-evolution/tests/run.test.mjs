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
  checkManifest,
  main,
  parseConsumerInput,
  validateConsumerInput,
} from '../run.mjs';

const hex = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

const packageRow = (overrides = {}) => ({
  lockLocation: 'node_modules/@sentropic/llm-mesh',
  name: '@sentropic/llm-mesh',
  version: '0.27.0',
  resolved: 'https://registry.npmjs.org/@sentropic/llm-mesh/-/llm-mesh-0.27.0.tgz',
  integrity: 'sha512-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  source: 'registry:sha512-aa',
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
