// Shared authority corpus (L3a v4 §4, §16.1): forged, wrong-module and
// cross-scope handles plus operation escalation, expiry and revocation.
// Backend-agnostic: injected structural fixtures, all operations awaited (§5.2).

import assert from 'node:assert/strict';
import type { ScopeGrant } from '../../src/storage/authority.js';
import type { Awaitable } from './atomic-corpus.js';

export interface AuthorityBound {
  appendChain(chainId: string, record: { readonly id: string; readonly bytes: string; readonly hash: string }, expectation: { readonly kind: 'absent'; readonly allocation: string } | { readonly kind: 'head'; readonly hash: string }): Awaitable<unknown>;
  readHead(chainId: string): Awaitable<string | null>;
}

export interface AuthorityBackend {
  bindNew(grant: ScopeGrant<unknown>): Awaitable<AuthorityBound>;
  bind(grant: ScopeGrant<unknown>): Awaitable<AuthorityBound>;
  revoke(token: string): Awaitable<unknown>;
}

export interface AuthorityFixture {
  readonly store: AuthorityBackend;
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

  const bound = await store.bindNew(grant);
  await bound.appendChain('auth-chain', { id: 'x', bytes: '{}', hash: 'h1' }, { kind: 'absent', allocation: '0' });

  await assert.rejects(
    async () => store.bind(grantFor({ token: '' })),
    /denied|token/,
    'K2a-RED authority: a forged grant with an empty token is denied',
  );

  await assert.rejects(
    async () => store.bind(grantFor({ token: 'token-forged-unknown' })),
    /unknown|denied/,
    'K2aC-RED authority: a non-empty token never issued is denied',
  );

  await assert.rejects(
    async () => store.bind({ ...grant, operations: ['read', 'write', 'publish'] as const }),
    /tampered|denied/,
    'K2aC-RED authority: falsified operations on an issued grant are denied',
  );

  await assert.rejects(
    async () => store.bind({ ...grant, scope: { tenantId: 'tenant-b', workspaceId: 'workspace-a' } }),
    /tampered|denied/,
    'K2aC-RED authority: a falsified scope on an issued grant is denied',
  );

  await assert.rejects(
    async () => store.bind(grantFor({ moduleId: 'engram-live' })),
    /wrong module/,
    'K2a-RED authority: a grant for another module is denied',
  );

  const otherScope = await store.bindNew(
    grantFor({ token: 'token-other-scope', scope: { tenantId: 'tenant-b', workspaceId: 'workspace-a' } }),
  );
  assert.equal(
    await otherScope.readHead('auth-chain'),
    null,
    'K2a-RED authority: a handle bound to another scope sees none of this scope data',
  );

  const reader = await store.bindNew(readGrant);
  await assert.rejects(
    async () => reader.appendChain('auth-chain-2', { id: 'y', bytes: '{}', hash: 'h2' }, { kind: 'absent', allocation: '0' }),
    /lacks write/,
    'K2a-RED authority: a read-only grant cannot write (no escalation)',
  );

  const leased = grantFor({
    token: 'token-lease-1',
    lifetime: { kind: 'lease', expiresAt: '2030-01-01T00:00:00.000Z' },
  });
  const leasedBound = await store.bindNew(leased);
  fixture.setNow('2031-06-01T00:00:00.000Z');
  await assert.rejects(
    async () => leasedBound.readHead('auth-chain'),
    /expired|denied/,
    'K2a-RED authority: an expired lease is denied even for reads',
  );
  fixture.setNow('2026-01-01T00:00:00.000Z');

  const doomed = grantFor({ token: 'token-revoked-1' });
  const doomedBound = await store.bindNew(doomed);
  await store.revoke('token-revoked-1');
  await assert.rejects(
    async () => doomedBound.readHead('auth-chain'),
    /revoked/,
    'K2a-RED authority: revocation before commit denies queued work',
  );

  const fresh = await store.bindNew(grantFor({ token: 'token-fresh-1' }));
  assert.equal(await fresh.readHead('auth-chain'), 'h1');
};
