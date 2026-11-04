/**
 * Lot 1a — consent store scenarios on the memory double (design-merged §3.1,
 * lot 1 acceptance): grant/find/revoke lifecycle, convergence, versioning,
 * isolation, ordering, audit events without content.
 */
import { describe, expect, it } from 'vitest';
import { assertConsentScopeId, consentAllows, type ReaderConsentRecord } from '../src/server/consent.js';
import { createMemoryReaderConsentStore } from '../src/server/reader-store.js';
import { RC_ALICE, RC_BOB, RC_SCOPE, RC_SCOPE_ID, RC_SCOPE_VERSION } from './fixtures/reader-consent-world.js';

const ARTIFACT = '11111111-1111-4111-8111-111111111111';
const OTHER_ARTIFACT = '22222222-2222-4222-8222-222222222222';
const key = (overrides = {}) => ({ storageScopeId: RC_SCOPE, readerAccountId: RC_ALICE,
  artifactId: ARTIFACT, scopeId: RC_SCOPE_ID, scopeVersion: RC_SCOPE_VERSION, ...overrides });
const record = (overrides = {}): ReaderConsentRecord => ({ consentId: 'c-1',
  ...key(overrides), grantedAt: '2026-11-04T08:00:00.000Z', grantedVia: 'reader_screen' });

describe('reader consent store (memory double)', () => {
  it('grants to a live row and revokes to undefined with the exact revokedAt tombstone', async () => {
    const store = createMemoryReaderConsentStore();
    expect(await store.findLiveConsent(key())).toBeUndefined();
    await store.grantConsent(record());
    expect(await store.findLiveConsent(key())).toMatchObject({ consentId: 'c-1', revokedAt: undefined });
    const revoked = await store.revokeConsent(key(), 'self', '2026-11-04T09:00:00.000Z',
      { actor: RC_ALICE, surface: 'api' });
    expect(revoked).toEqual({ changed: true, revokedAt: '2026-11-04T09:00:00.000Z' });
    expect(await store.findLiveConsent(key())).toBeUndefined();
    const listed = await store.listConsentsForReader(RC_SCOPE, RC_ALICE);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ revokedAt: '2026-11-04T09:00:00.000Z', revokedBy: 'self' });
  });

  it('converges a duplicate live grant and reports an unchanged double revoke', async () => {
    const store = createMemoryReaderConsentStore();
    const first = await store.grantConsent(record());
    const second = await store.grantConsent({ ...record(), consentId: 'c-2' });
    expect(second.consentId).toBe(first.consentId);
    expect(await store.listConsentsForReader(RC_SCOPE, RC_ALICE)).toHaveLength(1);
    expect(await store.revokeConsent(key(), 'self', '2026-11-04T09:00:00.000Z',
      { actor: RC_ALICE, surface: 'mcp' })).toMatchObject({ changed: true });
    expect(await store.revokeConsent(key(), 'self', '2026-11-04T10:00:00.000Z',
      { actor: RC_ALICE, surface: 'mcp' })).toEqual({ changed: false });
  });

  it('treats a stale scopeVersion as ineffective and keeps history across re-grant', async () => {
    const store = createMemoryReaderConsentStore();
    await store.grantConsent(record());
    expect(consentAllows(await store.findLiveConsent(key()), 'v2')).toBe(false);
    expect(consentAllows(await store.findLiveConsent(key()), RC_SCOPE_VERSION)).toBe(true);
    await store.revokeConsent(key(), 'self', '2026-11-04T09:00:00.000Z', { actor: RC_ALICE, surface: 'api' });
    await store.grantConsent(record({ consentId: 'c-2', scopeVersion: 'v2' }));
    expect(consentAllows(await store.findLiveConsent(key({ scopeVersion: 'v2' })), 'v2')).toBe(true);
    expect(await store.listConsentsForReader(RC_SCOPE, RC_ALICE)).toHaveLength(2);
  });

  it('isolates readers, scopes, artifacts and storage scopes', async () => {
    const store = createMemoryReaderConsentStore();
    await store.grantConsent(record());
    expect(await store.findLiveConsent(key({ readerAccountId: RC_BOB }))).toBeUndefined();
    expect(await store.findLiveConsent(key({ artifactId: OTHER_ARTIFACT }))).toBeUndefined();
    expect(await store.findLiveConsent(key({ storageScopeId: 'scope-other' }))).toBeUndefined();
    expect(await store.findLiveConsent(key({ scopeId: 'baskets.write.prepare' }))).toBeUndefined();
    expect(await store.listConsentsForReader(RC_SCOPE, RC_BOB)).toEqual([]);
  });

  it('rejects reserved and malformed scope ids', () => {
    expect(() => assertConsentScopeId('sentropic:admin')).toThrow();
    expect(() => assertConsentScopeId('')).toThrow();
    expect(() => assertConsentScopeId('has space')).toThrow();
    expect(() => assertConsentScopeId('UPPER')).toThrow();
    assertConsentScopeId(RC_SCOPE_ID);
    assertConsentScopeId('baskets.write.prepare');
  });
});
