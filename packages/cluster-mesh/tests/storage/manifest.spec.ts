// K4 gate: canonical export manifest on the neutral K4 runtime (L3a v4.1
// frozen §11.5, §17.1 K4). Test-first RED: imports the K4 manifest module
// before it exists.

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { ManifestRegistry, buildManifest, digestManifest } from '../../src/storage/manifest.js';
import { createStagedKernel } from '../../src/storage/staged-runtime.js';
import type { AtomicUnit } from '../../src/storage/atomic.js';
import type { WriterFence } from '../../src/storage/contracts.js';
import { expectCode } from './atomic-corpus.js';
import { grantFor } from './authority-corpus.js';

let tokenSeq = 0;
const stagedGrant = () =>
  grantFor({ token: `token-k4m-${(tokenSeq += 1)}`, operations: ['read', 'write', 'maintain'] });

const FENCE: WriterFence = { fenceId: 'fence-k4m', epoch: '1' };

const emptyUnit = (): AtomicUnit => ({
  guards: [],
  records: [],
  appends: [],
  updates: [],
  relationships: [],
  barriers: [],
  purgeIntents: [],
  indexWrites: [],
});

describe('K4 manifest: canonical round-trip', () => {
  it('K4-RED a built manifest retains and verifies by digest', () => {
    const manifest = buildManifest({
      scope: { tenantId: 'tenant-a', workspaceId: 'workspace-a' },
      selections: ['chain-m1', 'chain-m2'],
      heads: {
        'chain-m1': { head: 'hash-m1', allocation: '1' },
        'chain-m2': { head: 'hash-m2', allocation: '1' },
      },
      unitRoots: ['root-m1'],
      descriptorVersion: 'descriptor-1',
      encodingVersion: 'canonical-v1',
      terminal: { count: '2', complete: true },
    });
    const digest = digestManifest(manifest);
    assert.ok(digest.length > 0);
    const registry = new ManifestRegistry();
    assert.equal(registry.retain(manifest), digest);
    assert.deepEqual(registry.verify(digest), manifest);
  });

  it('K4-RED an unknown digest is refused', () => {
    const registry = new ManifestRegistry();
    expectCode(
      async () => registry.verify('digest-never-retained'),
      'invalid-command',
      'K4-RED manifest: an arbitrary digest with no retained boundary cannot open',
    );
  });

  it('K4-RED a tampered manifest is rejected against its digest', () => {
    const manifest = buildManifest({
      scope: { tenantId: 'tenant-a', workspaceId: 'workspace-a' },
      selections: ['chain-m1'],
      heads: { 'chain-m1': { head: 'hash-m1', allocation: '1' } },
      unitRoots: [],
      descriptorVersion: 'descriptor-1',
      encodingVersion: 'canonical-v1',
      terminal: { count: '1', complete: true },
    });
    const registry = new ManifestRegistry();
    const digest = registry.retain(manifest);
    const tampered = {
      ...manifest,
      selections: ['chain-m1', 'chain-evil'],
    };
    expectCode(
      async () => registry.verifyAgainst(tampered, digest),
      'invalid-command',
      'K4-RED manifest: a changed manifest no longer matches its digest',
    );
  });

  it('K4-RED a truncated terminal export is rejected', () => {
    expectCode(
      async () =>
        buildManifest({
          scope: { tenantId: 'tenant-a', workspaceId: 'workspace-a' },
          selections: ['chain-m1', 'chain-m2'],
          heads: {
            'chain-m1': { head: 'hash-m1', allocation: '1' },
            'chain-m2': { head: 'hash-m2', allocation: '1' },
          },
          unitRoots: [],
          descriptorVersion: 'descriptor-1',
          encodingVersion: 'canonical-v1',
          terminal: { count: '1', complete: true },
        }),
      'invalid-command',
      'K4-RED manifest: a terminal fragment binds its exact count',
    );
  });
});

describe('K4 manifest: binding to committed K4 storage', () => {
  it('K4-RED committed unit roots anchor a retained manifest', async () => {
    const kernel = createStagedKernel({ moduleId: 'comments' });
    const bound = kernel.bindNew(stagedGrant());
    const unit = await bound.beginStaged({
      operationKey: 'op-manifest-1',
      inputDigest: 'input-manifest',
      contractDigest: 'contract-k4m',
      sourceBoundary: 'boundary-k4m',
      fence: FENCE,
    });
    await bound.stageFragment({
      unit,
      ordinal: '0',
      predecessorHash: null,
      fragmentDigest: 'digest-manifest-0',
      effects: {
        ...emptyUnit(),
        appends: [
          {
            chainId: 'chain-manifest',
            record: { id: 'm1', bytes: '{}', hash: 'hash-manifest-1' },
            expectation: { kind: 'absent', allocation: '0' },
          },
        ],
      },
      fence: FENCE,
    });
    const seal = await bound.sealStaged({
      unit,
      root: {
        operationId: 'op-manifest-1',
        contractDigest: 'contract-k4m',
        sourceBoundary: 'boundary-k4m',
        finalFragmentHash: 'digest-manifest-0',
        fragmentCount: '1',
        dependencyRoot: 'dep-root-k4m',
        effectRoot: 'eff-root-k4m',
      },
    });
    const receipt = await bound.commitStaged({ seal, fence: FENCE });
    const head = await bound.readHead('chain-manifest');
    const manifest = buildManifest({
      scope: { tenantId: 'tenant-a', workspaceId: 'workspace-a' },
      selections: ['chain-manifest'],
      heads: { 'chain-manifest': { head: head ?? '', allocation: '1' } },
      unitRoots: [receipt.commitId],
      descriptorVersion: 'descriptor-1',
      encodingVersion: 'canonical-v1',
      terminal: { count: '1', complete: true },
    });
    const registry = new ManifestRegistry();
    const digest = registry.retain(manifest);
    assert.deepEqual(registry.verify(digest).unitRoots, [receipt.commitId]);
  });
});
