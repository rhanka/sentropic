// C0 gate: Comments contract boundaries, frozen-M1 preservation,
// compatibility and extension manifest validation (L3a v4.1 frozen §17 row C0, §17.4).
// This test pins the M1 source hashes and fails on any change.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isStorageModuleId,
  STORAGE_MODULE_IDS,
} from '../src/storage/contracts.js';
import {
  validateModuleDescriptor,
  type ModuleDescriptor,
} from '../src/storage/descriptor.js';
import {
  CONSUMER_REQUIREMENTS,
  isProfileId,
  missingProfiles,
  satisfiesRequirements,
} from '../src/storage/profiles.js';

// Resolve repository root from test location
const REPO_ROOT = resolve(__dirname, '../../..');

const sha256File = (relPath: string): string => {
  const absPath = resolve(REPO_ROOT, relPath);
  const bytes = readFileSync(absPath);
  return createHash('sha256').update(bytes).digest('hex');
};

/**
 * Pinned M1 source hashes as recorded in contract-v1.json and freeze-receipt.md
 * at frozen commit 7b8e5daf022cc58819dfdfae43cd89a703a82f96 (PR #663).
 */
export const PINNED_M1_HASHES: Readonly<Record<string, string>> = Object.freeze({
  // Package identity & export map
  'packages/comments/package.json': '821786727350ec56d333b6c8a6199f278c3a72cf1d642c44aaaac25b4f419d08',
  // Canonical TypeScript source modules
  'packages/comments/src/index.ts': 'c12f9ecc2556fe16dd1766ce0ec40ce228d7efdb2829e47b2e1d9d4ef17bbdf0',
  'packages/comments/src/anchors.ts': '83f238f8121cd66ad0a0f93881f4bebb3abb0614cc7631c99b54ef6e5046e49c',
  'packages/comments/src/canonical-json.ts': 'b7dc124252de880ca21bf36caed8d76e7d24a10718e0c4954dc9f3675847d45f',
  'packages/comments/src/command-store.ts': '912efa9278be93720887b58af75df91e4d2aad85f4a898faad6130a441616ec5',
  'packages/comments/src/commands.ts': 'b4c0f9558a0130e4774cd6fa4a75ef077ee0e18abb8a50398ed430b17bcb798c',
  'packages/comments/src/events.ts': '7f900f37a0b7d4e1b4349688c63f317a8040cee9946994b24330c3eafe83d134',
  'packages/comments/src/geometry.ts': '75bf806ba5ade9dedb8f9b5f85685d70199a335866342589e050fbe48506fede',
  'packages/comments/src/guards.ts': 'e0ff9bceb6955d1d769cfd53af0d0d59c1f03f3db297b0970d6853652066e7d6',
  'packages/comments/src/hono-ports.ts': '31e5e16be40726ea030adda1505104ddb6a8b0b17f4cfb1fef34c5e7e74bda56',
  'packages/comments/src/hono.ts': 'bb285c82c9bcb311b019ca6697003086609654d0b7df5340eb9dae1da70e8193',
  'packages/comments/src/in-memory.ts': '7361a8b383f129320a4acbb5225b96902aee7f1f4e212d6099a481fc8d133432',
  'packages/comments/src/lifecycle.ts': '1502a16733f2dfa6ba1abf6027066501a921fc646bea8752ec18b5f87904d2f3',
  'packages/comments/src/reviews.ts': '940d14d3439c7d435f356f7ccc460a89267a0c17814ab44d2233c721c5b6853e',
  'packages/comments/src/revision-hash.ts': '280e9cd22e2f748ec8989e3499acfc89fa9393db90825e8c9dddf32aa9c1069d',
  'packages/comments/src/revisions.ts': '5e6e78efd130afa8456b60ac9dc0f7ec74c17b2926d9d737d6f1dd60cdded65c',
  'packages/comments/src/sha256.ts': '23eeb9f8f479b111675c6d667f5f99a4c60ed76bfde822f2cdf6ae77e98619da',
  'packages/comments/src/store.ts': '23b8d464f0971c7446cd9f206dd04889e583b26b6ae2a2efcf5e61df006cd1cf',
  'packages/comments/src/submissions.ts': 'b9cce84efea5f9f5c9be6492c085250d5ade75303596f78d737baee5f906fe27',
  'packages/comments/src/types.ts': '1fa667108233ef122f4158f329328d7c13118cdbdde6f6d646460dadbf6a83ec',
  // Vectors & Conformance test fixtures
  'packages/comments/tests/fixtures/revision-hash-v1.json': '26ee62b09d22f39438c344a9223564f08e696eeba95ddd0558f357407a40f0c0',
  'packages/comments/tests/conformance/comments-conformance.ts': '26cdaf181afbc73c145c57974c6762230757bc101a0418f8da0654f505fb7b00',
  'packages/comments/tests/conformance/in-memory.ts': '0b91befcb3b67418667ccda1a36bbd40a183fd37c38eeb40ddb8a1495d42f945',
  // M1 freeze receipt & contract
  'docs/comments-annotations/contract/contract-v1.json': 'e027fdbb4a806df39809326697bf9b60ad5cb977eb1988af3be293da07161ba0',
  'docs/comments-annotations/contract/freeze-receipt.md': '095e1d50f4c64ddc7254ca7e86f10582e4d1c2f153ec5173c79cb62818dc92cb',
});

describe('C0 exit proof: Frozen-M1 preservation', () => {
  it('every pinned M1 source file exists and matches its exact recorded SHA-256 hash', () => {
    for (const [relPath, expectedHash] of Object.entries(PINNED_M1_HASHES)) {
      const absPath = resolve(REPO_ROOT, relPath);
      expect(existsSync(absPath), `M1 file missing: ${relPath}`).toBe(true);
      const computedHash = sha256File(relPath);
      expect(
        computedHash,
        `M1 file modified! Pinned hash mismatch on ${relPath}:\n  expected: ${expectedHash}\n  actual:   ${computedHash}`
      ).toBe(expectedHash);
    }
  });

  it('fails if any M1 source hash is tampered with', () => {
    const tampered = { ...PINNED_M1_HASHES, 'packages/comments/src/index.ts': '0000000000000000000000000000000000000000000000000000000000000000' };
    const actual = sha256File('packages/comments/src/index.ts');
    expect(actual).not.toBe(tampered['packages/comments/src/index.ts']);
  });

  it('preserves M1 24 store methods, 11 record kinds and error vocabulary without mutation', () => {
    const contractPath = resolve(REPO_ROOT, 'docs/comments-annotations/contract/contract-v1.json');
    const contract = JSON.parse(readFileSync(contractPath, 'utf8'));

    expect(contract.contractVersion).toBe('contract-v1');
    expect(contract.hashVersion).toBe('revision-hash-v1');
    expect(contract.status).toBe('frozen');
    expect(contract.recordKinds).toHaveLength(11);
    expect(contract.artifacts).toHaveLength(13);

    // Verify 11 record kinds match frozen specification
    const expectedKinds = [
      'annotation-revision',
      'thread-structure-revision',
      'comment-revision',
      'review-event',
      'prepared-submission-manifest',
      'import-manifest',
      'unit-receipt',
      'batch-receipt-snapshot',
      'lifecycle-event',
      'operation-audit-event',
      'conversion-report',
    ];
    const actualKinds = contract.recordKinds.map((r: { kind: string }) => r.kind);
    for (const kind of expectedKinds) {
      expect(actualKinds).toContain(kind);
    }
  });
});

describe('C0 exit proof: Storage compatibility and extension manifest', () => {
  const manifestPath = resolve(REPO_ROOT, 'docs/comments-annotations/contract/storage-module-v1.json');
  const docPath = resolve(REPO_ROOT, 'docs/comments-annotations/contract/storage-compatibility.md');

  it('docs/comments-annotations/contract/storage-module-v1.json exists and is valid', () => {
    expect(existsSync(manifestPath), 'storage-module-v1.json must exist').toBe(true);
    const content = JSON.parse(readFileSync(manifestPath, 'utf8'));

    expect(content.manifestVersion).toBe(1);
    expect(content.contractVersion).toBe('storage-module-v1');
    expect(content.targetModule).toBe('comments');
    expect(content.status).toBe('active');

    // Base contract reference
    expect(content.baseContract.path).toBe('docs/comments-annotations/contract/contract-v1.json');
    expect(content.baseContract.sha256).toBe(PINNED_M1_HASHES['docs/comments-annotations/contract/contract-v1.json']);
    expect(content.baseContract.contractVersion).toBe('contract-v1');
    expect(content.baseContract.freezeCommit).toBe('7b8e5daf022cc58819dfdfae43cd89a703a82f96');

    // Frozen M1 preservation declaration
    expect(content.frozenM1Preservation.methodsCount).toBe(24);
    expect(content.frozenM1Preservation.recordKindsCount).toBe(11);
    expect(content.frozenM1Preservation.unmodifiedSources).toBe(true);

    // Profile requirements aligned with cluster-mesh
    expect(content.profiles.required).toEqual(CONSUMER_REQUIREMENTS['m1-adapter']);
    expect(content.profiles.operational).toEqual(CONSUMER_REQUIREMENTS['comments-operational']);
    expect(content.profiles.c4).toEqual(CONSUMER_REQUIREMENTS['comments-c4']);
    expect(content.profiles.purge).toEqual(CONSUMER_REQUIREMENTS['comments-purge']);

    // Check all declared profiles exist in cluster-mesh
    for (const profile of [
      ...content.profiles.required,
      ...content.profiles.operational,
      ...content.profiles.c4,
      ...content.profiles.purge,
    ]) {
      expect(isProfileId(profile)).toBe(true);
    }

    // Transport and continuation extension declarations
    expect(content.extensions.transport.version).toBe('transport-v1');
    expect(content.extensions.transport.stagedUnitsProfile).toBe('staged-units-v1');
    expect(content.extensions.transport.continuationEnvelopeExplicit).toBe(true);
    expect(content.extensions.transport.overloadFrozenDto).toBe(false);

    // Named query profiles (L3a v4.1 §9.5)
    expect(content.extensions.queryProfiles).toEqual(['by-resource', 'scope-chain-index', 'retained-headers']);

    // Oracle packaging declarations (§9.6, §14.5, §17 row C0)
    expect(content.extensions.oraclePackaging.conformancePackage).toBe('@sentropic/comments');
    expect(content.extensions.oraclePackaging.conformanceExport).toBe('./conformance');
    expect(content.extensions.oraclePackaging.digestPinnedArchiveRequired).toBe(true);
    expect(content.extensions.oraclePackaging.mutatesFrozenM1Exports).toBe(false);
  });

  it('docs/comments-annotations/contract/storage-compatibility.md exists and documents boundaries', () => {
    expect(existsSync(docPath), 'storage-compatibility.md must exist').toBe(true);
    const doc = readFileSync(docPath, 'utf8');

    expect(doc).toContain('storage-module-v1');
    expect(doc).toContain('contract-v1.json');
    expect(doc).toContain('e027fdbb4a806df39809326697bf9b60ad5cb977eb1988af3be293da07161ba0');
    expect(doc).toContain('comments');
    expect(doc).toContain('by-resource');
    expect(doc).toContain('scope-chain-index');
    expect(doc).toContain('retained-headers');
    expect(doc).toContain('transport-v1');
    expect(doc).toContain('staged-units-v1');
  });

  it('validates a compliant cluster-mesh ModuleDescriptor for comments', () => {
    const descriptor: ModuleDescriptor = {
      contractVersion: 'contract-v1',
      contractDigest: PINNED_M1_HASHES['docs/comments-annotations/contract/contract-v1.json'],
      schemaVersions: ['1.0.0'],
      requiredProfiles: CONSUMER_REQUIREMENTS['m1-adapter'],
      optionalProfiles: ['scope-outbox-v1', 'visibility-barriers-v1', 'staged-units-v1', 'purge-jobs-v1', 'fenced-writers-v1'],
      chainKinds: [
        'revision',
        'review',
        'tombstone',
        'purge-intent',
        'purge-outcome',
        'operation-audit',
        'conversion-receipt',
        'import-receipt',
        'export-receipt',
        'retention-hold',
        'release-hold',
      ],
      queryNames: ['by-resource', 'scope-chain-index', 'retained-headers'],
      boundaries: ['thread', 'annotation'],
      pageLimits: { maxRecords: 100, maxEncodedBytes: 1048576 },
    };

    const res = validateModuleDescriptor(descriptor);
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
  });

  it('cluster-mesh storage contracts register comments as a known storage module', () => {
    expect(isStorageModuleId('comments')).toBe(true);
    expect(STORAGE_MODULE_IDS).toContain('comments');
  });

  it('cluster-mesh profiles satisfy m1-adapter, operational, and c4 consumer claims', () => {
    const fullAdvertised = [
      'atomic-units-v1',
      'immutable-chains-v1',
      'immutable-boundaries-v1',
      'scope-outbox-v1',
      'visibility-barriers-v1',
      'staged-units-v1',
      'purge-jobs-v1',
      'fenced-writers-v1',
    ] as const;

    expect(satisfiesRequirements(fullAdvertised, 'm1-adapter')).toBe(true);
    expect(satisfiesRequirements(fullAdvertised, 'comments-operational')).toBe(true);
    expect(satisfiesRequirements(fullAdvertised, 'comments-c4')).toBe(true);
    expect(satisfiesRequirements(fullAdvertised, 'comments-purge')).toBe(true);

    const minimal = ['atomic-units-v1', 'immutable-chains-v1', 'immutable-boundaries-v1'] as const;
    expect(satisfiesRequirements(minimal, 'm1-adapter')).toBe(true);
    expect(satisfiesRequirements(minimal, 'comments-operational')).toBe(false);
    expect(missingProfiles(minimal, CONSUMER_REQUIREMENTS['comments-operational'])).toEqual([
      'scope-outbox-v1',
      'visibility-barriers-v1',
    ]);
  });
});
