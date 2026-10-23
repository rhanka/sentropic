// G0 contract vectors: pinned digest, per-section mutation sensitivity,
// profile pins, JCS/NFC determinism and u64 boundaries. Every mutation of
// the registered manifest must change the digest; production never
// recomputes a new identity on import.

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  MEMORY_CONTRACT_DIGEST,
  MEMORY_PINNED_PROFILES,
  checkMemoryContractDigest,
  memoryContractManifest,
  memoryDescriptorDigest,
} from '../../src/engram-memory/manifest.js';
import {
  MemoryCanonicalJsonError,
  canonicalizeMemoryJcs,
  compareU64,
  isCanonicalU64,
  maxU64,
  memoryLexicalTombstone,
  memoryZeroHash,
  nextU64,
} from '../../src/engram-memory/codec.js';

const PINNED_CONTRACT_DIGEST = 'sha256:dff737ced37d801ef48bb4d7088fc4fbc92021d21fe2034ff33ea643b49bec28';

const PINNED_PROFILE_DIGESTS = [
  'sha256:507fd5a8f5d68a8c2b99c05bee5a23c0ded47d79532ca5edf34ea08c1919958a',
  'sha256:927777f8470be49c968a15cb9bbf2560efdd63bd329d763bfeeb1c166759a3bc',
  'sha256:47ee879a5552868ec7cee15f9984cb44f5a72b64aa2b02556232cd0c9037c80f',
  'sha256:d4f1e16890c9541fada3e71e4ba7ba2016da5b07e26383979e29e42b7916b1ed',
  'sha256:48cfb030a1a9c614de6170588116d1afe3d7c94acda79b4322b6b6d7d5156900',
  'sha256:66bbb70f8645b21707f5635e9544dd806d67f8b9d19ecb7be7413ac33d995b51',
];

describe('memory contract digest pinning', () => {
  it('should pin the co-signed contract digest literal', () => {
    expect(MEMORY_CONTRACT_DIGEST).toBe(PINNED_CONTRACT_DIGEST);
  });

  it('should recompute the pinned digest from the manifest', () => {
    expect(memoryDescriptorDigest(memoryContractManifest())).toBe(PINNED_CONTRACT_DIGEST);
    expect(() => checkMemoryContractDigest()).not.toThrow();
  });

  it('should change the digest on every manifest section mutation', () => {
    const sections: Array<[string, (manifest: Record<string, unknown>) => void]> = [
      ['contractVersion', (manifest) => { manifest['contractVersion'] = 'memory-binding-v2'; }],
      ['schemaVersions', (manifest) => { (manifest['schemaVersions'] as string[]).push('memory-journal-2'); }],
      ['requiredProfiles', (manifest) => { (manifest['requiredProfiles'] as string[]).pop(); }],
      ['optionalProfiles', (manifest) => { manifest['optionalProfiles'] = []; }],
      ['chainKinds', (manifest) => { (manifest['chainKinds'] as string[]).push('extra-chain'); }],
      ['queryNames', (manifest) => { (manifest['queryNames'] as string[]).pop(); }],
      ['boundaries', (manifest) => { manifest['boundaries'] = ['scope-root']; }],
      ['pageLimits', (manifest) => { manifest['pageLimits'] = { maxRecords: 2000, maxEncodedBytes: 1 }; }],
      ['profileClaims', (manifest) => { (manifest['profileClaims'] as unknown[]).pop(); }],
      ['codecs', (manifest) => { (manifest['codecs'] as string[]).push('extra-codec'); }],
      ['keys', (manifest) => { (manifest['keys'] as string[]).pop(); }],
      ['keyFormats', (manifest) => { (manifest['keyFormats'] as string[]).pop(); }],
      ['kinds', (manifest) => { (manifest['kinds'] as Record<string, unknown>)['records'] = {}; }],
      ['policies', (manifest) => { (manifest['policies'] as string[]).pop(); }],
      ['assets', (manifest) => { (manifest['assets'] as Record<string, unknown>)['additive'] = []; }],
    ];
    for (const [section, mutate] of sections) {
      const manifest = memoryContractManifest();
      mutate(manifest);
      expect(memoryDescriptorDigest(manifest), `mutation in ${section} must change the digest`).not.toBe(
        MEMORY_CONTRACT_DIGEST,
      );
    }
  });

  it('should refuse a tampered manifest through the deterministic check', () => {
    const manifest = memoryContractManifest();
    manifest['contractVersion'] = 'memory-binding-v2';
    expect(() => checkMemoryContractDigest(manifest)).toThrow();
  });

  it('should pin all six profile digests in order', () => {
    expect(MEMORY_PINNED_PROFILES.map((claim) => claim.digest)).toEqual(PINNED_PROFILE_DIGESTS);
    expect(MEMORY_PINNED_PROFILES.map((claim) => claim.version)).toEqual(['1', '1', '1', '1', '1', '1']);
  });
});

describe('memory canonical JSON vectors', () => {
  it('should sort keys and normalize NFD to NFC', () => {
    expect(canonicalizeMemoryJcs({ b: 1, a: 'é'.normalize('NFD') })).toBe('{"a":"é","b":1}');
  });

  it('should reject NFC normalization collisions', () => {
    const colliding: Record<string, number> = {};
    colliding['é'] = 1;
    colliding['é'.normalize('NFD')] = 2;
    expect(() => canonicalizeMemoryJcs(colliding)).toThrow(MemoryCanonicalJsonError);
  });

  it('should reject unpaired surrogates, -0, non-finite and unsafe integers', () => {
    expect(() => canonicalizeMemoryJcs('')).not.toThrow();
    expect(() => canonicalizeMemoryJcs(-0)).toThrow(MemoryCanonicalJsonError);
    expect(() => canonicalizeMemoryJcs(String.fromCharCode(0xd800) + 'x')).toThrow(MemoryCanonicalJsonError);
    expect(() => canonicalizeMemoryJcs(String.fromCharCode(0xdc00))).toThrow(MemoryCanonicalJsonError);
    expect(() => canonicalizeMemoryJcs(String.fromCharCode(0xd800))).toThrow(MemoryCanonicalJsonError);
    expect(() => canonicalizeMemoryJcs({ [String.fromCharCode(0xd800)]: 1 })).toThrow(MemoryCanonicalJsonError);
    expect(() => canonicalizeMemoryJcs(Number.POSITIVE_INFINITY)).toThrow(MemoryCanonicalJsonError);
    expect(() => canonicalizeMemoryJcs(9007199254740993)).toThrow(MemoryCanonicalJsonError);
    const tagged: unknown[] = [1];
    (tagged as Record<string, unknown>)['extra'] = true;
    expect(() => canonicalizeMemoryJcs(tagged)).toThrow(MemoryCanonicalJsonError);
  });

  it('should preserve the __proto__ key as an own property without collision', () => {
    const parsed: unknown = JSON.parse('{"__proto__":{"x":1}}');
    expect(canonicalizeMemoryJcs(parsed)).toBe('{"__proto__":{"x":1}}');
    expect(canonicalizeMemoryJcs(parsed)).not.toBe(canonicalizeMemoryJcs({}));
  });

  it('should reject sparse arrays instead of emitting invalid JSON', () => {
    expect(() => canonicalizeMemoryJcs(new Array(1))).toThrow(MemoryCanonicalJsonError);
    expect(() => canonicalizeMemoryJcs(new Array(2))).toThrow(MemoryCanonicalJsonError);
    expect(() => canonicalizeMemoryJcs([,])).toThrow(MemoryCanonicalJsonError);
  });

  it('should pin tombstone and zero-hash encodings', () => {
    expect(memoryLexicalTombstone()).toEqual({ format: 'utf8', data: 'null' });
    expect(memoryZeroHash()).toBe(`sha256:${'0'.repeat(64)}`);
  });
});

describe('memory canonical u64 vectors', () => {
  it('should accept decimal transport without Number round-trips', () => {
    expect(isCanonicalU64('0')).toBe(true);
    expect(isCanonicalU64('9007199254740991')).toBe(true);
    expect(isCanonicalU64('9007199254740992')).toBe(true);
    expect(isCanonicalU64('18446744073709551615')).toBe(true);
    expect(isCanonicalU64('18446744073709551616')).toBe(false);
    expect(isCanonicalU64('01')).toBe(false);
    expect(isCanonicalU64('')).toBe(false);
    expect(isCanonicalU64(9007199254740991)).toBe(false);
  });

  it('should order and succeed across 2^53 and 2^63 with exact exhaustion', () => {
    expect(compareU64('9007199254740991', '9007199254740992')).toBe(-1);
    expect(compareU64('9223372036854775807', '9223372036854775808')).toBe(-1);
    expect(nextU64('9007199254740991')).toBe('9007199254740992');
    expect(nextU64('18446744073709551614')).toBe('18446744073709551615');
    expect(nextU64('18446744073709551615')).toBeUndefined();
    expect(maxU64()).toBe('18446744073709551615');
  });
});

describe('memory semantic assets', () => {
  it('should bind the packaged manifest bytes to the pinned digest', async () => {
    const asset = JSON.parse(
      await readFile(new URL('../../assets/storage/engram-memory/contract-manifest.json', import.meta.url), 'utf8'),
    ) as { contractDigest: string; canonicalManifest: string };
    expect(asset.contractDigest).toBe(PINNED_CONTRACT_DIGEST);
    expect(asset.canonicalManifest).toBe(canonicalizeMemoryJcs(memoryContractManifest()));
  });

  it('should record the neutral profile claims in the equivalence receipt', async () => {
    const equivalence = JSON.parse(
      await readFile(new URL('../../assets/storage/engram-memory/equivalence.json', import.meta.url), 'utf8'),
    ) as { contractDigest: string; neutralClaims: unknown };
    expect(equivalence.contractDigest).toBe(PINNED_CONTRACT_DIGEST);
    expect(equivalence.neutralClaims).toEqual(MEMORY_PINNED_PROFILES.map((claim) => ({ ...claim })));
  });
});
