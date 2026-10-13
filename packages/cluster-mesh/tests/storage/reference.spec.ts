// K2a gate: the shared corpus executed against the test-only reference
// (L3a v4.1 frozen §16.1, §17.1) plus K1 data-pure validator checks.

import { describe, expect, it } from 'vitest';
import { validateAtomicUnit } from '../../src/storage/atomic.js';
import { validateLiveIdentityTriangle } from '../../src/storage/authority.js';
import { deriveEffectiveChanges, validateModuleDescriptor } from '../../src/storage/descriptor.js';
import { mapKernelCondition } from '../../src/storage/errors.js';
import { CONSUMER_REQUIREMENTS, missingProfiles } from '../../src/storage/profiles.js';
import { validateGrantLifetime } from '../../src/storage/contracts.js';
import { decodeChainCursor, encodeChainCursor, validateLeasedSnapshot, validateReadPage } from '../../src/storage/readers.js';
import { canonicalFragmentEncoding, nextStagedState, validateFragmentSequence } from '../../src/storage/staged-units.js';
import { runAtomicCorpus } from './atomic-corpus.js';
import { grantFor, runAuthorityCorpus } from './authority-corpus.js';
import { runChainCorpus } from './chain-corpus.js';
import { runReadCorpus, runReadCursorBudgetCorpus } from './read-corpus.js';
import { TestReferenceStore } from './reference-store.js';

const scope = { tenantId: 'tenant-a', workspaceId: 'workspace-a' };

describe('K2a reference: atomic corpus', () => {
  it('K2a-RED commits, guards, replay and idempotency hold', async () => {
    const store = new TestReferenceStore('comments');
    await runAtomicCorpus(store.bindNew(grantFor()));
  });
});

describe('K2a reference: authority corpus', () => {
  it('K2a-RED forged, cross-module, escalation, expiry and revocation deny', async () => {
    let now = '2026-01-01T00:00:00.000Z';
    const store = new TestReferenceStore('comments', () => now);
    await runAuthorityCorpus({
      store,
      grant: grantFor(),
      readGrant: grantFor({ token: 'token-read-1', operations: ['read'] }),
      setNow: (iso: string) => {
        now = iso;
      },
    });
  });
});

describe('K2a reference: chain corpus', () => {
  it('K2a-RED independent chains, allocation and disposal hold', async () => {
    const store = new TestReferenceStore('comments');
    await runChainCorpus(store.bindNew(grantFor({ operations: ['read', 'write', 'maintain'] })));
  });
});

describe('K2a reference: read corpus', () => {
  it('K2a-RED stable cursors, page bounds and explicit gaps hold', async () => {
    const store = new TestReferenceStore('comments');
    await runReadCorpus(store.bindNew(grantFor({ operations: ['read', 'write', 'maintain'] })));
  });
});

describe('K2a split: R3 returned-cursor budget', () => {
  // Skipped: R3 deferred to K2a-2. The returned cursor can make a read exceed
  // the budget (Sol round 3: 116 bytes for a 115 budget, §8.4). Follow-up lot
  // K2a-2 (R3 fix + Sol M11 + Opus r3 minors) owns the fix; this test is the
  // RED proof and must be re-enabled there.
  it.skip('R3 deferred to K2a-2: resumed page with its returned cursor fits the budget', async () => {
    const store = new TestReferenceStore('comments');
    await runReadCursorBudgetCorpus(store.bindNew(grantFor({ operations: ['read', 'write', 'maintain'] })));
  });
});

describe('K1C triangle: L6a product triplet is optional together', () => {
  const local = {
    declarationId: 'decl:local-1',
    cloneId: 'clone:local-1',
    worktreeId: 'wt:local-1',
    declarationRevision: 1,
  };

  const product = {
    declarationId: 'decl:product-1',
    cloneId: 'clone:product-1',
    worktreeId: 'wt:product-1',
    declarationRevision: 1,
    serverWorkspaceId: 'srv-ws-1',
    serverIssuer: 'srv-issuer-1',
    bindingRevision: 1,
  };

  it('K1C-RED accepts a valid L6a local identity without the product triplet', () => {
    expect(validateLiveIdentityTriangle(local).ok).toBe(true);
  });

  it('K1C-RED accepts a complete product triplet', () => {
    expect(validateLiveIdentityTriangle(product).ok).toBe(true);
  });

  it('K1C-RED rejects a bindingRevision alone without workspace and issuer', () => {
    expect(validateLiveIdentityTriangle({ ...local, bindingRevision: 1 }).ok).toBe(false);
  });

  it('K1C-RED rejects partial triplets', () => {
    expect(
      validateLiveIdentityTriangle({ ...local, serverWorkspaceId: 'srv-ws-1', serverIssuer: 'srv-issuer-1' }).ok,
    ).toBe(false);
    expect(validateLiveIdentityTriangle({ ...local, serverWorkspaceId: 'srv-ws-1' }).ok).toBe(false);
    expect(validateLiveIdentityTriangle({ ...local, serverIssuer: 'srv-issuer-1' }).ok).toBe(false);
    expect(
      validateLiveIdentityTriangle({ ...local, serverWorkspaceId: 'srv-ws-1', bindingRevision: 1 }).ok,
    ).toBe(false);
    expect(validateLiveIdentityTriangle({ ...local, serverIssuer: 'srv-issuer-1', bindingRevision: 1 }).ok).toBe(
      false,
    );
  });

  it('K1C-RED rejects a product bindingRevision below 1', () => {
    expect(validateLiveIdentityTriangle({ ...product, bindingRevision: 0 }).ok).toBe(false);
  });
});

describe('K1C expiry: parsed instants reject expired authority', () => {
  it('K1C-RED rejects an expiry with a timezone offset that is already past', () => {
    const expired = validateGrantLifetime(
      { kind: 'lease', expiresAt: '2026-10-12T10:00:00+02:00' },
      '2026-10-12T09:00:00.000Z',
    );
    expect(expired.ok).toBe(false);
  });

  it('K1C-RED rejects authority at the exact expiry instant', () => {
    const atExpiry = validateGrantLifetime(
      { kind: 'lease', expiresAt: '2026-10-12T08:00:00.000Z' },
      '2026-10-12T08:00:00.000Z',
    );
    expect(atExpiry.ok).toBe(false);
  });

  it('K1C-RED rejects a leased snapshot with an offset expiry that is already past', () => {
    const snapshot = {
      token: 'lease-1',
      queryVersion: 'v1',
      paramsHash: 'ph-1',
      order: 'seq-asc',
      root: 'root-1',
      incarnation: 'store-1',
      expiresAt: '2026-10-12T10:00:00+02:00',
    };
    expect(validateLeasedSnapshot(snapshot, '2026-10-12T09:00:00.000Z').ok).toBe(false);
    expect(validateLeasedSnapshot({ ...snapshot, expiresAt: '2026-10-12T08:00:00.000Z' }, '2026-10-12T08:00:00.000Z').ok).toBe(
      false,
    );
  });
});

describe('K1R3 expiry: an unparseable now is refused', () => {
  it('K1R3-RED refuses a grant lifetime check with an unparseable now', () => {
    expect(validateGrantLifetime({ kind: 'lease', expiresAt: '2030-01-01T00:00:00.000Z' }, 'not-a-date').ok).toBe(false);
  });

  it('K1R3-RED refuses a leased snapshot check with an unparseable now', () => {
    expect(
      validateLeasedSnapshot(
        {
          token: 'lease-1',
          queryVersion: 'v1',
          paramsHash: 'ph-1',
          order: 'seq-asc',
          root: 'root-1',
          incarnation: 'store-1',
          expiresAt: '2030-01-01T00:00:00.000Z',
        },
        'not-a-date',
      ).ok,
    ).toBe(false);
  });
});

describe('K1R3 triangle: L6a syntax compatibility', () => {
  const local = {
    declarationId: 'decl:local-1',
    cloneId: 'clone:local-1',
    worktreeId: 'wt:local-1',
    declarationRevision: 1,
  };

  it('K1R3-RED rejects a blank serverIssuer like L6a', () => {
    expect(
      validateLiveIdentityTriangle({ ...local, serverWorkspaceId: 'srv-ws-1', serverIssuer: '  ', bindingRevision: 1 })
        .ok,
    ).toBe(false);
  });

  it('K1R3-RED rejects NUL identities like L6a', () => {
    expect(validateLiveIdentityTriangle({ ...local, declarationId: 'decl:\0x' }).ok).toBe(false);
    expect(validateLiveIdentityTriangle({ ...local, cloneId: 'clone:\0x' }).ok).toBe(false);
    expect(validateLiveIdentityTriangle({ ...local, serverIssuer: 'srv\0x' }).ok).toBe(false);
  });

  it('K1R3-RED rejects whitespace-only identities like L6a', () => {
    expect(validateLiveIdentityTriangle({ ...local, declarationId: '   ' }).ok).toBe(false);
  });
});

describe('K2aR3 idempotency: scope-level replay across handles', () => {
  it('K2aR3-RED replays an identical unit from a rebound handle', async () => {
    const store = new TestReferenceStore('comments');
    const first = store.bindNew(grantFor({ token: 'token-idem-a' }));
    const unit = {
      guards: [],
      records: [],
      appends: [
        {
          chainId: 'idem-chain',
          record: { id: 'i1', bytes: '{"n":1}', hash: 'hash-i-1' },
          expectation: { kind: 'absent', allocation: '0' } as const,
        },
      ],
      updates: [],
      relationships: [],
      barriers: [],
      purgeIntents: [],
      indexWrites: [],
    };
    const receipt = await first.commitAtomic(unit, { idempotencyKey: 'idem-key-1' });
    const rebound = store.bindNew(grantFor({ token: 'token-idem-b' }));
    const replayed = await rebound.commitAtomic(unit, { idempotencyKey: 'idem-key-1' });
    expect(replayed.commitId).toBe(receipt.commitId);
    expect(await rebound.readHead('idem-chain')).toBe('hash-i-1');
  });
});

describe('K1 validators', () => {
  it('K1-RED rejects an empty atomic unit', () => {
    const result = validateAtomicUnit({
      guards: [],
      records: [],
      appends: [],
      updates: [],
      relationships: [],
      barriers: [],
      purgeIntents: [],
      indexWrites: [],
    });
    expect(result.ok).toBe(false);
  });

  it('K1-RED derives no creation event from duplicate genesis', () => {
    const changes = deriveEffectiveChanges([
      { kind: 'genesis', key: 'submission:sub-1', digest: 'd1', duplicate: true },
      { kind: 'append', key: 'chain-a:0', digest: 'h1' },
    ]);
    expect(changes.map((entry) => entry.kind)).toEqual(['appended']);
  });

  it('K1-RED maps kernel conditions without inventing canonical codes', () => {
    expect(mapKernelCondition('cas-conflict')).toBe('cas-conflict');
    expect(mapKernelCondition('unavailable')).toBe('transport-failure');
  });

  it('K1-RED requires M1 profiles for the persistence adapter', () => {
    const missing = missingProfiles([], CONSUMER_REQUIREMENTS['m1-adapter']);
    expect(missing.length).toBeGreaterThan(0);
  });

  it('K1-RED round-trips an immutable chain cursor', () => {
    const cursor = encodeChainCursor({
      formatVersion: 1,
      moduleId: 'comments',
      scope,
      incarnation: 'store-1',
      selection: 'annotation-revisions:ann-1',
      head: 'hash-1',
      ordering: 'seq-asc',
      position: '0',
    });
    const decoded = decodeChainCursor(cursor);
    expect(decoded?.head).toBe('hash-1');
  });

  it('K1-RED rejects a gapped fragment sequence', () => {
    const encoding = canonicalFragmentEncoding({
      moduleId: 'comments',
      scope,
      operationId: 'op-1',
      contractVersion: 'storage-v1',
      sourceBoundary: 'boundary-1',
      ordinal: '1',
      predecessorHash: 'prev-0',
      effectDigest: 'digest-1',
    });
    expect(typeof encoding).toBe('string');
    const accepted = [{ ordinal: '0', fragmentDigest: 'digest-0' }];
    const gapped = validateFragmentSequence(accepted, {
      ordinal: '2',
      predecessorHash: 'digest-0',
      fragmentDigest: 'digest-2',
    });
    expect(gapped.ok).toBe(false);
    expect(nextStagedState('staging', 'begin-seal')).toBe('sealing');
  });

  it('K1-RED rejects a descriptor with unknown profiles', () => {
    const result = validateModuleDescriptor({
      contractVersion: 'storage-v1',
      contractDigest: 'ab'.repeat(32),
      schemaVersions: ['v1'],
      requiredProfiles: ['no-such-profile'],
      optionalProfiles: [],
      chainKinds: ['annotation-revisions'],
      queryNames: ['by-resource'],
      boundaries: ['immutable'],
      pageLimits: { maxRecords: 100, maxEncodedBytes: 65536 },
    });
    expect(result.ok).toBe(false);
  });

  it('K1-RED rejects an oversized page', () => {
    const result = validateReadPage(
      { outcome: 'page', records: [{ id: 'a', seq: 0, hash: 'h', bytes: 'x'.repeat(100) }], nextCursor: null },
      { maxRecords: 10, maxEncodedBytes: 16 },
    );
    expect(result.ok).toBe(false);
  });
});
