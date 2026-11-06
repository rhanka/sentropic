import type { AuthHonoFederationPort } from '@sentropic/auth-hono';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { db } from '../../../src/db/client';
import { federationFlowStates } from '../../../src/db/schema';
import { createFederationAdapter } from '../../../src/services/auth/federation-adapter';
import { withAppCmAuth } from '../../../src/services/identity/cm-auth-runtime';
import { createCmUser } from '../../../src/services/identity/cm-users';
import { createCmMagicLink, consumeCmMagicLink, sha256Hex } from '../../../src/services/identity/cm-proofs';
import { createMockCredential } from '../../utils/auth-helper';
import { cmDeleteForUsers, cmDeleteForEmails } from '../../utils/cm-identity-test-store';
import { expectCustodyCode } from '../../utils/cm-custody-assertions';

/**
 * CM-bound federation identity ports plus the app's one-time protocol flow-state store.
 * Keystones exercised against real Postgres:
 *  - K-UNIQUE: a duplicate (provider, provider_subject) insert is rejected as AuthHonoIdentityConflictError.
 *  - K-FLOW:   consumeFlowState is single-use — the second consume of the same id returns null.
 *  - K-STATE:  an EXPIRED flow-state consume returns null; the sealed continuation pointer is held
 *              server-side (returned by consume, deleted after) and is NOT the opaque cookie id.
 *  - isUserCredentialed: false for a bare shell, true once any sign-in factor exists.
 */

const bound = <T>(work: (port: AuthHonoFederationPort) => Promise<T>) =>
  withAppCmAuth(runner => runner.request(binding => work(binding.ports.federation)));
const adapter: AuthHonoFederationPort = {
  ...createFederationAdapter(),
  findIdentityBySubject: (...args) => bound(port => port.findIdentityBySubject(...args)),
  findIdentitiesForUser: (...args) => bound(port => port.findIdentitiesForUser(...args)),
  linkIdentity: (...args) => bound(port => port.linkIdentity(...args)),
  unlinkIdentity: (...args) => bound(port => port.unlinkIdentity(...args)),
  touchLogin: (...args) => bound(port => port.touchLogin(...args)),
  isUserCredentialed: (...args) => bound(port => port.isUserCredentialed(...args)),
};
const suffix = randomUUID().slice(0, 8);
const userA = `fed-user-a-${suffix}`;
const userB = `fed-user-b-${suffix}`;
const shellUser = `fed-shell-${suffix}`;
const allUserIds = [userA, userB, shellUser];

const future = (ms = 60 * 60 * 1000): Date => new Date(Date.now() + ms);
const past = (ms = 60 * 60 * 1000): Date => new Date(Date.now() - ms);

const seedUser = async (id: string): Promise<void> => {
  await createCmUser({
    accountStatus: 'pending_admin_approval',
    displayName: id,
    email: `${id}@example.com`,
    emailVerified: true,
    userId: id,
    role: 'editor',
  });
};

const cleanup = async (): Promise<void> => {
  await db.delete(federationFlowStates);
  await cmDeleteForEmails(allUserIds.map(id => `${id}@example.com`));
  await cmDeleteForUsers(allUserIds);
};

describe('CM federation identity binding and app protocol flow state', () => {
  beforeEach(async () => {
    await cleanup();
    await seedUser(userA);
    await seedUser(userB);
    await seedUser(shellUser);
  });

  afterEach(cleanup);

  it('refuses identity access through an unbound root adapter', async () => {
    await expect(createFederationAdapter().isUserCredentialed(userA))
      .rejects.toMatchObject({ code: 'identity_transaction_unbound' });
  });

  it('linkIdentity + findIdentityBySubject round-trip; findIdentitiesForUser lists a user links', async () => {
    const linked = await adapter.linkIdentity({
      emailAtLink: 'a@example.com',
      emailVerifiedByProvider: true,
      now: new Date(),
      provider: 'google',
      providerSubject: `sub-${suffix}`,
      userId: userA,
    });
    expect(linked.userId).toBe(userA);
    expect(linked.provider).toBe('google');

    const found = await adapter.findIdentityBySubject('google', `sub-${suffix}`);
    expect(found?.id).toBe(linked.id);

    const list = await adapter.findIdentitiesForUser(userA);
    expect(list).toHaveLength(1);
    expect(await adapter.findIdentityBySubject('google', 'no-such-subject')).toBeNull();
  });

  it('K-UNIQUE: a duplicate (provider, subject) insert is rejected as AuthHonoIdentityConflictError', async () => {
    const input = {
      emailAtLink: 'a@example.com',
      emailVerifiedByProvider: true,
      now: new Date(),
      provider: 'google',
      providerSubject: `dup-${suffix}`,
      userId: userA,
    };
    await adapter.linkIdentity(input);

    // Same (provider, subject), even for a DIFFERENT user, must be rejected (one identity ↔ one user).
    // Post-cutover the CM port reports the typed custody code; the broker maps it to 409.
    await expectCustodyCode(() => adapter.linkIdentity({ ...input, userId: userB }), 'social_subject_conflict');
  });

  it('unlinkIdentity removes the link and touchLogin stamps last_login_at', async () => {
    // touchLogin consumes the same-callback snapshot populated by linkIdentity, so both
    // run inside one binding callback exactly as the ceremony does; reads stay per-call.
    const { stamp } = await withAppCmAuth(runner => runner.request(async binding => {
      const linked = await binding.ports.federation.linkIdentity({
        emailAtLink: 'a@example.com',
        emailVerifiedByProvider: true,
        now: new Date(),
        provider: 'google',
        providerSubject: `unlink-${suffix}`,
        userId: userA,
      });
      const stamp = new Date();
      await binding.ports.federation.touchLogin(linked.id, stamp);
      return { stamp };
    }));
    const row = await adapter.findIdentityBySubject('google', `unlink-${suffix}`);
    expect(row?.lastLoginAt?.getTime()).toBe(stamp.getTime());

    expect(await adapter.unlinkIdentity(userA, 'google', `unlink-${suffix}`)).toBe(true);
    expect(await adapter.findIdentityBySubject('google', `unlink-${suffix}`)).toBeNull();
    expect(await adapter.unlinkIdentity(userA, 'google', `unlink-${suffix}`)).toBe(false);
  });

  it('isUserCredentialed: false for a bare shell, true once a webauthn credential exists', async () => {
    expect(await adapter.isUserCredentialed(shellUser)).toBe(false);

    await createMockCredential(shellUser);
    expect(await adapter.isUserCredentialed(shellUser)).toBe(true);
  });

  it('isUserCredentialed: true when the user has a used magic link (a completed sign-in factor)', async () => {
    expect(await adapter.isUserCredentialed(userB)).toBe(false);
    const tokenHash = sha256Hex(`ml-${suffix}`);
    await createCmMagicLink({
      now: new Date(),
      email: `${userB}@example.com`,
      expiresAt: future(),
      tokenHash,
      userId: userB,
    });
    expect(await consumeCmMagicLink(tokenHash, userB)).toBe(true);
    expect(await adapter.isUserCredentialed(userB)).toBe(true);
  });

  it('K-FLOW / K-STATE: flow-state is single-use, holds the continuation server-side, and honors TTL', async () => {
    const created = await adapter.createFlowState({
      codeVerifier: 'pkce-verifier',
      continuationToken: 'sealed.continuation.pointer',
      expiresAt: future(),
      nonce: 'oidc-nonce',
      now: new Date(),
      provider: 'google',
      upstreamState: 'csrf-state',
    });

    // The opaque cookie pointer (`id`) is DISTINCT from the sealed continuation and the CSRF state.
    expect(created.id).not.toBe(created.continuationToken);
    expect(created.id).not.toBe(created.upstreamState);
    expect(created.continuationToken).toBe('sealed.continuation.pointer');

    // First consume returns the full server-side state (incl. the sealed continuation).
    const first = await adapter.consumeFlowState(created.id, new Date());
    expect(first).not.toBeNull();
    expect(first?.upstreamState).toBe('csrf-state');
    expect(first?.nonce).toBe('oidc-nonce');
    expect(first?.codeVerifier).toBe('pkce-verifier');
    expect(first?.continuationToken).toBe('sealed.continuation.pointer');

    // Single-use: a replayed consume returns null (row was deleted).
    expect(await adapter.consumeFlowState(created.id, new Date())).toBeNull();

    // TTL: an already-expired flow-state is never consumable.
    const expired = await adapter.createFlowState({
      continuationToken: null,
      expiresAt: past(),
      nonce: null,
      now: past(),
      provider: 'google',
      upstreamState: 'stale-state',
      codeVerifier: null,
    });
    expect(await adapter.consumeFlowState(expired.id, new Date())).toBeNull();
  });
});
