/**
 * Lot 1a — sentropic api binding for persistent reader consent
 * (design-merged §4.1, lot 1 acceptance): self list/revoke/revoke-all and
 * admin revoke over the memory double; the owner instrument stays share
 * revocation, never consent revocation; unreadable artifacts read not_found.
 */
import { describe, expect, it } from 'vitest';
import { createMemoryReaderConsentStore } from '@sentropic/artifacts/server/reader-store';
import { createReaderConsentService } from '../../src/services/artifacts/reader-consent.js';

const ARTIFACT = '11111111-1111-4111-8111-111111111111';
const readable = new Set([`${ARTIFACT}:alice`]);
const serviceWith = () => createReaderConsentService({
  store: createMemoryReaderConsentStore(),
  storageScopeId: 'scope-api',
  canReadArtifact: async (artifactId, reader) => readable.has(`${artifactId}:${reader}`),
  isAdmin: async (account) => account === 'admin',
  resolveTitle: async (artifactId) => (artifactId === ARTIFACT ? 'Baskets' : undefined),
  now: () => '2026-11-04T09:00:00.000Z',
});

describe('reader consent api binding', () => {
  it('grants with fresh rights, lists own consents with titles, then revokes one scope', async () => {
    const service = serviceWith();
    await service.grantWithFreshRights({ readerAccountId: 'alice', artifactId: ARTIFACT,
      scopeId: 'baskets.read', scopeVersion: 'v1' }, async () => true);
    expect(await service.listOwnConsents('alice')).toEqual([{ artifactId: ARTIFACT,
      title: 'Baskets', scopeId: 'baskets.read', scopeVersion: 'v1',
      grantedAt: '2026-11-04T09:00:00.000Z' }]);
    expect(await service.revokeOwnConsent({ readerAccountId: 'alice', artifactId: ARTIFACT,
      scopeId: 'baskets.read' })).toEqual({ changed: true, revokedAt: '2026-11-04T09:00:00.000Z' });
    expect(await service.listOwnConsents('alice')).toEqual([]);
  });

  it('refuses grant without fresh rights and revoke on an unreadable artifact', async () => {
    const service = serviceWith();
    await expect(service.grantWithFreshRights({ readerAccountId: 'alice', artifactId: ARTIFACT,
      scopeId: 'baskets.read', scopeVersion: 'v1' }, async () => false)).rejects.toThrow('access_denied');
    expect(await service.listOwnConsents('alice')).toEqual([]);
    await expect(service.revokeOwnConsent({ readerAccountId: 'bob',
      artifactId: ARTIFACT })).rejects.toThrow('not_found');
  });

  it('revokes all own scopes at once and lets an admin revoke, never the owner', async () => {
    const service = serviceWith();
    for (const scopeId of ['baskets.read', 'baskets.write.prepare']) {
      await service.grantWithFreshRights({ readerAccountId: 'alice', artifactId: ARTIFACT,
        scopeId, scopeVersion: 'v1' }, async () => true);
    }
    expect(await service.revokeAllOwnConsents({ readerAccountId: 'alice',
      artifactId: ARTIFACT })).toEqual({ changed: true, revoked: 2 });
    await service.grantWithFreshRights({ readerAccountId: 'alice', artifactId: ARTIFACT,
      scopeId: 'baskets.read', scopeVersion: 'v1' }, async () => true);
    expect(await service.adminRevokeConsent({ readerAccountId: 'alice', artifactId: ARTIFACT,
      scopeId: 'baskets.read' }, 'admin')).toEqual({ changed: true, revokedAt: '2026-11-04T09:00:00.000Z' });
    await expect(service.adminRevokeConsent({ readerAccountId: 'alice',
      artifactId: ARTIFACT }, 'owner')).rejects.toThrow('access_denied');
  });
});
