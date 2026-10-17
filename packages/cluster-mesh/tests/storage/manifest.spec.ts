// K4 gate: canonical export manifest on the neutral K4 runtime (L3a v4.1
// frozen §11.5, §17.1 K4). Test-first RED: imports the K4 manifest module
// before it exists.

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { ManifestRegistry, buildManifest, digestManifest } from '../../src/storage/manifest.js';
import { stagedDigestOf, stagedSealRoot } from './staged-corpus.js';
import { createStagedTestKernel as createStagedKernel } from './staged-client.js';
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
  it('should distinguish collection boundaries that collide under flattening', () => {
    const common = { scope: { tenantId: 'tenant-a', workspaceId: 'workspace-a' }, descriptorVersion: 'd', encodingVersion: 'e', terminal: { count: '0', complete: false } };
    const one = buildManifest({ ...common, selections: ['a'], heads: { a: { head: 'h1', allocation: '1' } }, unitRoots: ['b', 'h2', '1'] });
    const two = buildManifest({ ...common, selections: ['a', 'b'], heads: { a: { head: 'h1', allocation: '1' }, b: { head: 'h2', allocation: '1' } }, unitRoots: [] });
    assert.notEqual(digestManifest(one), digestManifest(two), 'C17: selection and unit-root collection boundaries cannot collide');
  });

  it('should own nested heads before and after retention', () => {
    const heads = { a: { head: 'original', allocation: '1' } };
    const manifest = buildManifest({ scope: { tenantId: 't', workspaceId: 'w' }, selections: ['a'], heads, unitRoots: [], descriptorVersion: 'd', encodingVersion: 'e', terminal: { count: '1', complete: true } });
    const registry = new ManifestRegistry();
    const digest = registry.retain(manifest);
    heads.a.head = 'caller mutation';
    assert.equal(manifest.heads.a.head, 'original', 'C17: building a manifest owns nested input heads');
    try { (registry.verify(digest).heads.a as { head: string }).head = 'returned mutation'; } catch { /* frozen value */ }
    assert.equal(registry.verify(digest).heads.a.head, 'original', 'C17: retained heads cannot change through returned aliases');
  });
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

  it('K4-RED an unknown digest is refused', async () => {
    const registry = new ManifestRegistry();
    await expectCode(
      async () => registry.verify('digest-never-retained'),
      'invalid-command',
      'K4-RED manifest: an arbitrary digest with no retained boundary cannot open',
    );
  });

  it('K4-RED a tampered manifest is rejected against its digest', async () => {
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
    await expectCode(
      async () => registry.verifyAgainst(tampered, digest),
      'invalid-command',
      'K4-RED manifest: a changed manifest no longer matches its digest',
    );
  });

  it('K4-RED a truncated terminal export is rejected', async () => {
    await expectCode(
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
    const effects: AtomicUnit = {
        ...emptyUnit(),
        appends: [
          {
            chainId: 'chain-manifest',
            record: { id: 'm1', bytes: '{}', hash: 'hash-manifest-1' },
            expectation: { kind: 'absent', allocation: '0' },
          },
        ],
      };
    const digest = stagedDigestOf(unit, '0', null, effects, 'contract-k4m', 'boundary-k4m');
    await bound.stageFragment({ unit, ordinal: '0', predecessorHash: null, fragmentDigest: digest, effects, fence: FENCE });
    const seal = await bound.sealStaged({
      unit,
      root: stagedSealRoot(unit, [effects], 'contract-k4m', 'boundary-k4m'),
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
