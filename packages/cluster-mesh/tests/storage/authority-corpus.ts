// Shared authority corpus (L3a v4 §4, §16.1): forged, wrong-module and
// cross-scope handles plus operation escalation, expiry and revocation.

import assert from 'node:assert/strict';
import type { ScopeGrant } from '../../src/storage/authority.js';
import { TestReferenceStore } from './reference-store.js';

export interface AuthorityFixture {
  readonly store: TestReferenceStore;
  readonly grant: ScopeGrant<unknown>;
  readonly readGrant: ScopeGrant<unknown>;
  readonly setNow: (iso: string) => void;
}

export const grantFor = (
  overrides: Partial<ScopeGrant<unknown>> = {},
): ScopeGrant<unknown> => ({
  token: 'token-test-1',
  moduleId: 'comments',
  scope: { tenantId: 'tenant-a', workspaceId: 'workspace-a' },
  principalId: 'user-1',
  operations: ['read', 'write'],
  issuer: 'test-host',
  authorityRevision: '1',
  policyRevision: '1',
  moduleAuthority: null,
  lifetime: { kind: 'invocation', invocationId: 'inv-1' },
  ...overrides,
});

export const runAuthorityCorpus = async (fixture: AuthorityFixture): Promise<void> => {
  const { store, grant, readGrant } = fixture;

  const bound = store.bind(grant);
  bound.appendChain('auth-chain', { id: 'x', bytes: '{}', hash: 'h1' }, { kind: 'absent', allocation: '0' });

  assert.throws(
    () => store.bind(grantFor({ token: '' })),
    /denied|token/,
    'K2a-RED authority: a forged grant with an empty token is denied',
  );

  assert.throws(
    () => store.bind(grantFor({ moduleId: 'engram-live' })),
    /wrong module/,
    'K2a-RED authority: a grant for another module is denied',
  );

  const otherScope = store.bind(
    grantFor({ token: 'token-other-scope', scope: { tenantId: 'tenant-b', workspaceId: 'workspace-a' } }),
  );
  assert.equal(
    otherScope.readHead('auth-chain'),
    null,
    'K2a-RED authority: a handle bound to another scope sees none of this scope data',
  );

  const reader = store.bind(readGrant);
  assert.throws(
    () => reader.appendChain('auth-chain-2', { id: 'y', bytes: '{}', hash: 'h2' }, { kind: 'absent', allocation: '0' }),
    /lacks write/,
    'K2a-RED authority: a read-only grant cannot write (no escalation)',
  );

  const leased = grantFor({
    token: 'token-lease-1',
    lifetime: { kind: 'lease', expiresAt: '2030-01-01T00:00:00.000Z' },
  });
  const leasedBound = store.bind(leased);
  fixture.setNow('2031-06-01T00:00:00.000Z');
  assert.throws(
    () => leasedBound.readHead('auth-chain'),
    /expired|denied/,
    'K2a-RED authority: an expired lease is denied even for reads',
  );
  fixture.setNow('2026-01-01T00:00:00.000Z');

  const doomed = grantFor({ token: 'token-revoked-1' });
  const doomedBound = store.bind(doomed);
  store.revoke('token-revoked-1');
  assert.throws(
    () => doomedBound.readHead('auth-chain'),
    /revoked/,
    'K2a-RED authority: revocation before commit denies queued work',
  );

  const fresh = store.bind(grantFor({ token: 'token-fresh-1' }));
  assert.equal(fresh.readHead('auth-chain'), 'h1');
};
