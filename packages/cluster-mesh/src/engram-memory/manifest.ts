// engram-memory semantic manifest: pinned neutral contract bytes, profile
// digests, codecs, key encodings and index policies covered by the contract
// digest (binding sections 1.2, 2.2, 3.1, 3.2, 5.3, 6.3). Data-pure.
// Digest rule: SHA-256 over UTF-8 `graphify-memory/l3a-module-descriptor/v1`
// followed by one NUL byte, then `canonicalizeMemoryJcs(manifest)`; rendered
// as `sha256:` plus hexadecimal. The manifest excludes `contractDigest`
// itself. Profile rule: SHA-256 over UTF-8
// `graphify-memory/l3a-profile/v1`, NUL, profile name, NUL, version.

import { createHash } from 'node:crypto';
import { canonicalizeMemoryJcs } from './codec.js';
import type { ModuleDescriptor } from '../storage/descriptor.js';

export const MEMORY_MODULE_ID = 'engram-memory' as const;

export const MEMORY_CONTRACT_VERSION = 'memory-binding-v1' as const;

/** Pinned contract-manifest digest, co-signed C2/C6. Never recomputed silently. */
export const MEMORY_CONTRACT_DIGEST =
  'sha256:dff737ced37d801ef48bb4d7088fc4fbc92021d21fe2034ff33ea643b49bec28' as const;

export const MEMORY_REQUIRED_PROFILES = Object.freeze([
  'atomic-units-v1',
  'immutable-chains-v1',
  'immutable-boundaries-v1',
  'scope-outbox-v1',
  'fenced-writers-v1',
]);

export const MEMORY_OPTIONAL_PROFILES = Object.freeze(['leased-snapshots-v1']);

const PROFILE_DIGEST_DOMAIN = 'graphify-memory/l3a-profile/v1\0';

const profileDigest = (name: string, version: string): string => {
  const hash = createHash('sha256');
  hash.update(PROFILE_DIGEST_DOMAIN, 'utf8');
  hash.update(name, 'utf8');
  hash.update('\0', 'utf8');
  hash.update(version, 'utf8');
  return `sha256:${hash.digest('hex')}`;
};

export interface MemoryProfileClaim {
  readonly name: string;
  readonly version: string;
  readonly digest: string;
}

/** Pinned profile negotiation table: every profile pinned to version and semantic digest. */
export const MEMORY_PINNED_PROFILES: readonly MemoryProfileClaim[] = (() => {
  const rows: MemoryProfileClaim[] = [];
  for (const name of [...MEMORY_REQUIRED_PROFILES, ...MEMORY_OPTIONAL_PROFILES]) {
    rows.push(Object.freeze({ name, version: '1', digest: profileDigest(name, '1') }));
  }
  return Object.freeze(rows);
})();

export const MEMORY_QUERY_NAMES = Object.freeze([
  'memory-journal-page',
  'memory-record-by-id',
  'memory-accepted-snapshot',
  'memory-outbox-page',
  'scope-chain-index',
]);

export const MEMORY_BOUNDARIES = Object.freeze(['scope-root', 'exact-cursor']);

export const MEMORY_SCHEMA_VERSIONS = Object.freeze([
  'memory-journal-1',
  'memory-record-2',
  'memory-lifecycle-event-2',
  'memory-checkpoint-1',
]);

export const MEMORY_CHAIN_KINDS = Object.freeze({
  'memory-journal': Object.freeze({ kind: 'memory-journal-event', chain: 'memory-journal' }),
});

export const MEMORY_RECORD_KINDS = Object.freeze({
  'memory-record-blobs': 'memory-record-blob',
  'memory-projection-outbox': 'memory-outbox-batch',
});

export const MEMORY_AGGREGATE_KINDS = Object.freeze({
  'memory-pending-controls': 'memory-pending-control',
  'memory-sealed-envelopes': 'memory-sealed-envelope',
  'memory-fold-state': 'memory-fold-state',
  'memory-capture-idempotency': 'memory-capture-idempotency',
  'memory-admission-outcomes': 'memory-admission-outcome',
  'memory-store-meta': 'memory-store-meta',
});

export const MEMORY_CODEC_MANIFEST: readonly string[] = Object.freeze([
  'jcs-rfc8785+nfc',
  'graphify-memory/payload/v2',
  'graphify-memory/record/v2',
  'graphify-memory/memory-journal-event/v1',
  'graphify-memory/memory-journal-intent/v1',
  'graphify-memory/canonical-transaction/v1',
  'graphify-memory/recovery-checkpoint/v1',
  'graphify-memory/accepted-lexical/v1',
  'graphify-memory/projection-outbox/v1',
  'graphify-memory/projection-batch/v1',
  'graphify-memory/capture-idempotency/v1',
  'graphify-memory/operational-capability/v1',
]);

export const MEMORY_KEY_MANIFEST: readonly string[] = Object.freeze([
  'memory-journal',
  'memory-record-v1',
  'memory-pending-control-v1',
  'memory-sealed-envelope-v1',
  'memory-state-v1',
  'memory-outbox-v1',
  'memory-capture-idempotency-v1',
  'memory-admission-outcome-v1',
  'memory-store-meta-v1',
  'memory-lexical-v1',
]);

export const MEMORY_POLICY_MANIFEST: readonly string[] = Object.freeze([
  'first-proof-immutable:memory-capture-idempotency',
  'first-proof-immutable:memory-admission-outcomes',
  'journal-identity:memory-journal-event',
]);

export const MEMORY_KIND_MANIFEST = Object.freeze({
  chains: { ...MEMORY_CHAIN_KINDS },
  records: { ...MEMORY_RECORD_KINDS },
  aggregates: { ...MEMORY_AGGREGATE_KINDS },
});

export const MEMORY_KEY_FORMATS: readonly string[] = Object.freeze([
  '["memory-record-v1","<record_id>"]',
  '["memory-pending-control-v1","<candidate_id>"]',
  '["memory-sealed-envelope-v1","<candidate_id>"]',
  '["memory-state-v1","candidate|record","<entity_id>"]',
  '["memory-outbox-v1","<through_cursor_inclusive>","<batch_digest>"]',
  '["memory-capture-idempotency-v1","<candidate_id>"]',
  '["memory-admission-outcome-v1","<candidate_id>"]',
  '["memory-store-meta-v1","binding"]',
  '["memory-lexical-v1","<scope_ref>","<record_id>"]',
]);

export const MEMORY_ASSET_MANIFEST = Object.freeze({
  contract: Object.freeze({
    name: 'l3a-generic-module-storage-port',
    version: 'v4.1',
    digest: 'c7111c9e7293ee270a0b4dde277f1cfc40fa3c863c3915c6f9ccdd6935c46294',
  }),
  additive: Object.freeze([
    'acquireFence/checkFence/releaseFence canonical-instance acquisition (binding §9)',
    'CommitOptions.fence writer-fence identity (binding §§9.3–9.6)',
    'readCommitResult scoped original-result recovery (R-G4-7, binding §8.2)',
    'profileClaims with pinned versions and semantic digests (binding §6.3)',
    'memory-* named queries and scope-chain-index for memory-journal (binding §4.1)',
    'memory key encodings, codec manifest, and index policies in the contract digest (binding §§2.2.3, 3.1, 3.2, 5.3)',
  ]),
});

/**
 * The complete registered contract manifest covered by the contract digest
 * (binding section 2.2.3). Exported so every section gets its own
 * digest-mutation test.
 */
export const memoryContractManifest = (): Record<string, unknown> => ({
  contractVersion: MEMORY_CONTRACT_VERSION,
  schemaVersions: [...MEMORY_SCHEMA_VERSIONS],
  requiredProfiles: [...MEMORY_REQUIRED_PROFILES],
  optionalProfiles: [...MEMORY_OPTIONAL_PROFILES],
  chainKinds: Object.keys(MEMORY_CHAIN_KINDS),
  queryNames: [...MEMORY_QUERY_NAMES],
  boundaries: [...MEMORY_BOUNDARIES],
  pageLimits: { maxRecords: 2000, maxEncodedBytes: 1048576 },
  profileClaims: MEMORY_PINNED_PROFILES.map((claim) => ({ ...claim })),
  codecs: [...MEMORY_CODEC_MANIFEST],
  keys: [...MEMORY_KEY_MANIFEST],
  keyFormats: [...MEMORY_KEY_FORMATS],
  kinds: {
    chains: { ...MEMORY_KIND_MANIFEST.chains },
    records: { ...MEMORY_KIND_MANIFEST.records },
    aggregates: { ...MEMORY_KIND_MANIFEST.aggregates },
  },
  policies: [...MEMORY_POLICY_MANIFEST],
  assets: {
    contract: { ...MEMORY_ASSET_MANIFEST.contract },
    additive: [...MEMORY_ASSET_MANIFEST.additive],
  },
});

const DESCRIPTOR_DIGEST_DOMAIN = 'graphify-memory/l3a-module-descriptor/v1\0';

const descriptorDigest = (body: Record<string, unknown>): string => {
  const hash = createHash('sha256');
  hash.update(DESCRIPTOR_DIGEST_DOMAIN, 'utf8');
  hash.update(canonicalizeMemoryJcs(body), 'utf8');
  return `sha256:${hash.digest('hex')}`;
};

/** Contract digest over a manifest, for mutation tests (binding section 2.2.3). */
export const memoryDescriptorDigest = (manifest: Record<string, unknown>): string => descriptorDigest(manifest);

/**
 * Deterministic generator/check: recompute the pinned literal from the
 * manifest. Production never silently accepts changed bytes by recomputing
 * a new identity on import.
 */
export const checkMemoryContractDigest = (manifest: Record<string, unknown> = memoryContractManifest()): void => {
  const recomputed = descriptorDigest(manifest);
  if (recomputed !== MEMORY_CONTRACT_DIGEST) {
    throw new Error(`Memory contract digest mismatch: expected ${MEMORY_CONTRACT_DIGEST}, computed ${recomputed}`);
  }
};

/** The frozen memory descriptor (binding section 2.2). */
export const MEMORY_DESCRIPTOR: ModuleDescriptor = (() => {
  checkMemoryContractDigest();
  return Object.freeze({
    contractVersion: MEMORY_CONTRACT_VERSION,
    contractDigest: MEMORY_CONTRACT_DIGEST,
    schemaVersions: Object.freeze([...MEMORY_SCHEMA_VERSIONS]),
    requiredProfiles: Object.freeze([...MEMORY_REQUIRED_PROFILES]),
    optionalProfiles: Object.freeze([...MEMORY_OPTIONAL_PROFILES]),
    chainKinds: Object.freeze(Object.keys(MEMORY_CHAIN_KINDS)),
    queryNames: Object.freeze([...MEMORY_QUERY_NAMES]),
    boundaries: Object.freeze([...MEMORY_BOUNDARIES]),
    pageLimits: Object.freeze({ maxRecords: 2000, maxEncodedBytes: 1048576 }),
  });
})();
