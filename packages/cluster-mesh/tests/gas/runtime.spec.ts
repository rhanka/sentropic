import { describe, expect, it } from 'vitest';
import { deriveWorkspaceReference } from '../../src/boundaries.js';
import { TenantBoundaryError } from '../../src/errors.js';
import { createChunkedKv, chunkByBytes } from '../../src/gas/props.js';
import { withScriptLock } from '../../src/gas/lock.js';
import { createSyncBoundaryDomain, deriveWorkspaceReferenceSync } from '../../src/gas/boundary.js';
import { GasProbeFailedError, KeyBudgetExceededError, LockTimeoutError } from '../../src/gas/errors.js';
import { createGasDigest } from '../../src/gas/digest.js';
import { init, probe } from '../../src/gas/probe.js';
import { mockLock, mockProperties, mockUtilities } from './harness.js';

const good = () => ({ Utilities: mockUtilities(), PropertiesService: { getScriptProperties: () => mockProperties() }, LockService: mockLock().service });

describe('probe() fails closed with typed errors', () => {
  it('passes on a conforming runtime', () => expect(probe(good(), { mode: 'store' })).toEqual({ ok: true, errors: [] }));
  it('digest missing / wrong / throwing', () => {
    expect(probe({}, { mode: 'registry' }).errors[0].code).toBe('probe_digest_unavailable');
    const bad = { DigestAlgorithm: { SHA_256: 1 }, computeDigest: () => [0] };
    expect(probe({ Utilities: bad }, { mode: 'registry' }).errors[0].code).toBe('probe_digest_mismatch');
    const boom = { DigestAlgorithm: { SHA_256: 1 }, computeDigest: () => { throw new Error('x'); } };
    expect(probe({ Utilities: boom }, { mode: 'registry' }).errors[0].code).toBe('probe_digest_unavailable');
  });
  it('store mode: props too small, props missing, lock denied', () => {
    const small = { ...good(), PropertiesService: { getScriptProperties: () => mockProperties({ maxValueBytes: 4096 }) } };
    expect(probe(small, { mode: 'store' }).errors.map((e) => e.code)).toEqual(['probe_props_chunk']);
    expect(probe({ Utilities: mockUtilities(), LockService: mockLock().service }, { mode: 'store' }).errors.map((e) => e.code)).toEqual(['probe_props_unavailable']);
    expect(probe({ ...good(), LockService: mockLock(false).service }, { mode: 'store' }).errors.map((e) => e.code)).toEqual(['probe_lock_unavailable']);
  });
  it('init throws GasProbeFailedError', () => expect(() => init({}, { mode: 'registry' })).toThrow(GasProbeFailedError));
});

describe('chunked properties and lock', () => {
  it('roundtrips multi-byte text over chunks under 9 KB and never splits a code point', () => {
    const props = mockProperties();
    const kv = createChunkedKv(props);
    const text = '😀é中'.repeat(5000);
    kv.put('a', text);
    expect(kv.get('a')).toBe(text);
    expect(props.getKeys().length).toBeGreaterThan(2);
    expect(chunkByBytes(text).every((c) => Buffer.byteLength(c) <= 8192)).toBe(true);
    kv.put('a', 'short');
    expect(kv.get('a')).toBe('short');
    expect(props.getKeys().sort()).toEqual(['a#0', 'a#n']);
  });
  it('key budget and torn write fail closed', () => {
    const props = mockProperties();
    const kv = createChunkedKv(props, 4);
    kv.put('a', 'x');
    kv.put('b', 'y');
    expect(() => kv.put('c', 'z')).toThrow(KeyBudgetExceededError);
    props.deleteProperty('a#0');
    expect(kv.get('a')).toBeNull();
  });
  it('lock serializes and releases; denied lock throws', () => {
    const l = mockLock();
    expect(withScriptLock(l.service, 100, () => 7)).toBe(7);
    expect(l.state.releases).toBe(1);
    expect(() => withScriptLock(l.service, 100, () => { throw new Error('boom'); })).toThrow('boom');
    expect(l.state.releases).toBe(2);
    expect(() => withScriptLock(mockLock(false).service, 100, () => 1)).toThrow(LockTimeoutError);
  });
});

describe('sync boundary domain', () => {
  const digest = createGasDigest(mockUtilities());
  it('derives the same ws reference as the frozen async form and resolves only via membership', async () => {
    expect(deriveWorkspaceReferenceSync(digest, 'workspace:airbus.é')).toBe(await deriveWorkspaceReference('workspace:airbus.é'));
    const d = createSyncBoundaryDomain({ homeNodeId: 'node:gas', digest, memberships: { resolveApproved: (l) => ({ tenantId: 't1', userId: l.userId, status: 'approved' }) } });
    expect(d.resolve({ workspaceId: 'w', userId: 'u' }).tid).toBe('t1');
    const none = createSyncBoundaryDomain({ homeNodeId: 'node:gas', digest, memberships: { resolveApproved: () => null } });
    expect(() => none.resolve({ workspaceId: 'w', userId: 'u' })).toThrow(TenantBoundaryError);
  });
});
