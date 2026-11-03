// A4 composition-gaps lot G1 (P4, design a4-cm-gaps-r2 §6.4): OAuth tenant
// read surface over the frozen OAuthTenantStore. Both durable profiles via
// the a20b harness (PostgreSQL leg requires CM_PG_URL, no skips) plus the
// in-memory doubles in the same file.

import { describe, expect, it } from 'vitest';
import type { IdentityTransactionV1, OAuthConsentRecord } from '../../src/index.js';
import { createInMemoryIdentityStores, oauthTenantStoreV1, oauthTenantStoreV1FromStores } from '../../src/index.js';
import type { CustodyOpHost } from '../../src/index.js';
import { IdentityCustodyErrorV1 } from '../../src/identity-contracts/custody-errors.js';
import { registerIdentityTransaction } from '../../src/storage/identity/custody-transaction-guards.js';
import { asOpHost, LATER, NOW, openPostgresEnv, openSqliteEnv, pgEnabled } from './a20b-helpers.js';

const WRITE = { mode: 'write' as const, purpose: 'request' as const, maxAttempts: 3 as const, deadlineMs: 5000 };
const READ = { mode: 'read' as const, purpose: 'request' as const, maxAttempts: 3 as const, deadlineMs: 5000 };
const TIE = '2026-11-01T13:00:00.000Z';

const consent = (consentId: string, userId: string, clientId: string, tenantId: string, grantedAt: string, revokedAt?: string): OAuthConsentRecord =>
  ({ consentId, tenantId, userId, clientId, grantedAt, revokedAt });

const expectCustodyCode = (fn: () => unknown, code: string): void => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(IdentityCustodyErrorV1);
    expect((error as IdentityCustodyErrorV1).code).toBe(code);
    return;
  }
  throw new Error(`expected IdentityCustodyErrorV1 ${code}`);
};

const PROFILES = (pgEnabled ? ['postgres', 'sqlite'] : ['sqlite']) as const;

describe.each(PROFILES.map((profile) => ({ profile })))('G1 oauth tenant reads on $profile', ({ profile }) => {
  const openUow = async () => {
    const pg = profile === 'postgres' ? await openPostgresEnv() : null;
    return asOpHost((pg ?? openSqliteEnv()).unitOfWork);
  };

  it('reads grants inside the attempt and nothing after rollback', async () => {
    const uow = await openUow();
    const c1 = consent('c1', 'u1', 'client-1', 't1', NOW);
    await uow.run(WRITE, async (tx) => {
      const oauth = oauthTenantStoreV1(tx);
      await tx.stores.oauth.grantConsent(c1);
      expect(await oauth.findConsent('c1')).toEqual(c1);
      expect(await oauth.findConsentForGrant({ userId: 'u1', clientId: 'client-1', tenantId: 't1' })).toEqual(c1);
      expect(await oauth.listConsentsForUser('u1')).toEqual([c1]);
      expect(await oauth.findConsent('missing')).toBeNull();
    });
    await expect(uow.run(WRITE, async (tx) => {
      await tx.stores.oauth.grantConsent(consent('c2', 'u1', 'client-1', 't1', LATER));
      throw new Error('rollback-probe');
    })).rejects.toThrow('rollback-probe');
    await uow.run(READ, async (tx) => {
      const oauth = oauthTenantStoreV1(tx);
      expect(await oauth.findConsent('c2')).toBeNull();
      expect(await oauth.findConsentForGrant({ userId: 'u1', clientId: 'client-1', tenantId: 't1' })).toEqual(c1);
      expect(await oauth.listConsentsForUser('u1')).toEqual([c1]);
    });
  });

  it('keeps revoked rows readable, hides them from the grant finder, newest live wins bytewise', async () => {
    const uow = await openUow();
    await uow.run(WRITE, async (tx) => {
      const oauth = oauthTenantStoreV1(tx);
      const key = { userId: 'u2', clientId: 'client-9', tenantId: 't1' };
      await tx.stores.oauth.grantConsent(consent('c1', key.userId, key.clientId, key.tenantId, NOW));
      await tx.stores.oauth.revokeConsent('c1', LATER);
      expect(await oauth.findConsent('c1')).toEqual(consent('c1', key.userId, key.clientId, key.tenantId, NOW, LATER));
      expect(await oauth.findConsentForGrant(key)).toBeNull();
      expect(await oauth.listConsentsForUser('u2')).toEqual([consent('c1', key.userId, key.clientId, key.tenantId, NOW, LATER)]);
      await tx.stores.oauth.grantConsent(consent('c2', key.userId, key.clientId, key.tenantId, LATER));
      expect((await oauth.findConsentForGrant(key))?.consentId).toBe('c2');
      // grantedAt tie breaks bytewise-descending: 'consent-a' (0x61) beats 'consent-Z' (0x5A).
      await tx.stores.oauth.grantConsent(consent('consent-Z', 'u3', 'client-9', 't1', TIE));
      await tx.stores.oauth.grantConsent(consent('consent-a', 'u3', 'client-9', 't1', TIE));
      expect((await oauth.findConsentForGrant({ userId: 'u3', clientId: 'client-9', tenantId: 't1' }))?.consentId).toBe('consent-a');
      expect((await oauth.listConsentsForUser('u3')).map((row) => row.consentId)).toEqual(['consent-Z', 'consent-a']);
    });
  });

  it('finds service client bindings by client and reflects rebind in-attempt', async () => {
    const uow = await openUow();
    await uow.run(WRITE, async (tx) => {
      const oauth = oauthTenantStoreV1(tx);
      await tx.stores.oauth.bindServiceClient({ clientId: 'client-1', tenantId: 't1', boundAt: NOW });
      await tx.stores.oauth.bindServiceClient({ clientId: 'client-2', tenantId: 't1', boundAt: NOW });
      await tx.stores.oauth.bindServiceClient({ clientId: 'client-3', tenantId: 't2', boundAt: NOW });
      expect(await oauth.findServiceClientBinding('client-1')).toEqual({ clientId: 'client-1', tenantId: 't1', boundAt: NOW });
      expect(await oauth.findServiceClientBinding('nope')).toBeNull();
      expect((await tx.stores.oauth.listTenantServiceClients('t2')).map((row) => row.clientId)).toEqual(['client-3']);
      await tx.stores.oauth.bindServiceClient({ clientId: 'client-1', tenantId: 't2', boundAt: LATER });
      expect(await oauth.findServiceClientBinding('client-1')).toEqual({ clientId: 'client-1', tenantId: 't2', boundAt: LATER });
    });
  });

  it('refuses expired, foreign and contract-less handles before any query', async () => {
    const uow = await openUow();
    let captured: IdentityTransactionV1<CustodyOpHost> | null = null;
    await uow.run(READ, async (tx) => {
      captured = tx;
      expect(typeof oauthTenantStoreV1(tx).findConsent).toBe('function');
    });
    expectCustodyCode(() => oauthTenantStoreV1(captured as IdentityTransactionV1<CustodyOpHost>), 'identity_transaction_unbound');
    expectCustodyCode(() => oauthTenantStoreV1({ stores: createInMemoryIdentityStores() } as unknown as IdentityTransactionV1<CustodyOpHost>), 'identity_transaction_unbound');
    const frozenOnly = {
      grantConsent: async () => undefined,
      revokeConsent: async () => false,
      bindServiceClient: async () => undefined,
      listTenantServiceClients: async () => [] as const,
    };
    const fakeStores = { ...createInMemoryIdentityStores(), oauth: frozenOnly };
    const fakeTx = registerIdentityTransaction({ stores: fakeStores } as unknown as IdentityTransactionV1<CustodyOpHost>, () => undefined, {} as CustodyOpHost);
    expectCustodyCode(() => oauthTenantStoreV1(fakeTx), 'identity_contract_unavailable');
    expectCustodyCode(() => oauthTenantStoreV1FromStores(fakeStores), 'identity_contract_unavailable');
  });
});

describe('G1 oauth tenant reads on in-memory doubles', () => {
  it('runs the same finder semantics over the doubles', async () => {
    const stores = createInMemoryIdentityStores();
    const oauth = oauthTenantStoreV1FromStores(stores);
    const key = { userId: 'u1', clientId: 'client-1', tenantId: 't1' };
    await stores.oauth.grantConsent(consent('c1', key.userId, key.clientId, key.tenantId, NOW));
    await stores.oauth.revokeConsent('c1', LATER);
    expect(await oauth.findConsent('c1')).toEqual(consent('c1', key.userId, key.clientId, key.tenantId, NOW, LATER));
    expect(await oauth.findConsentForGrant(key)).toBeNull();
    await stores.oauth.grantConsent(consent('consent-Z', 'u2', 'client-1', 't1', TIE));
    await stores.oauth.grantConsent(consent('consent-a', 'u2', 'client-1', 't1', TIE));
    expect((await oauth.findConsentForGrant({ userId: 'u2', clientId: 'client-1', tenantId: 't1' }))?.consentId).toBe('consent-a');
    await stores.oauth.bindServiceClient({ clientId: 'client-1', tenantId: 't1', boundAt: NOW });
    expect(await oauth.findServiceClientBinding('client-1')).toEqual({ clientId: 'client-1', tenantId: 't1', boundAt: NOW });
    expect(await oauth.findServiceClientBinding('absent')).toBeNull();
  });
});
