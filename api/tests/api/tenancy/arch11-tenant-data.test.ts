import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { readFile } from 'node:fs/promises';

import { db } from '../../../src/db/client';
import {
  oauthClients,
  oauthConsents,
  serviceClients,
  workspaces,
} from '../../../src/db/schema';
import { cleanupAuthData, createTestUser } from '../../utils/auth-helper';
import { createCmTenant, findCmTenant, enrolCmWorkspace, findCmWorkspace, listCmWorkspacesForTenant,
  listCmMembershipsForTenant, setCmMembershipState } from '../../../src/services/identity/cm-tenancy';
import { cmDeleteTenants, cmDeleteTenantMembershipsForTenant, cmQuery, cmTable } from '../../utils/cm-identity-test-store';
import { findCmServiceClientBinding } from '../../../src/services/identity/cm-service-clients';

// Preserve ARCH-11's tenant isolation and protocol evidence after A4 moves identity authority to CM.

const ORG_A = 'arch11-org-a';
const ORG_B = 'arch11-org-b';
const TEST_ORGS = [ORG_A, ORG_B];
const CLIENT_ID = 'arch11-consent-client';
const SERVICE_CLIENT_ID = 'arch11-service-client';
const seededWorkspaceIds: string[] = [];

async function seedOrg(id: string): Promise<void> {
  if (!await findCmTenant(id)) await createCmTenant({ tenantId: id });
}

async function seedWorkspace(id: string, tenantId: string, ownerUserId?: string): Promise<void> {
  await db
    .insert(workspaces)
    .values({ id, name: `ws-${id}`, ...(ownerUserId ? { ownerUserId } : {}) })
    .onConflictDoNothing();
  await enrolCmWorkspace({ workspaceId: id, tenantId });
  seededWorkspaceIds.push(id);
}

async function seedConsentClient(): Promise<void> {
  await db
    .insert(oauthClients)
    .values({
      id: `oauth-${CLIENT_ID}`,
      clientId: CLIENT_ID,
      name: CLIENT_ID,
      redirectUris: ['https://example.test/cb'],
      allowedScopes: ['openid', 'profile', 'email'],
      tokenEndpointAuthMethod: 'none',
    })
    .onConflictDoNothing();
}

describe('ARCH-11 tenant data after the CM identity cutover', () => {
  beforeEach(async () => {
    await seedOrg(ORG_A);
    await seedOrg(ORG_B);
    await seedConsentClient();
  });

  afterEach(async () => {
    await db.delete(oauthConsents).where(eq(oauthConsents.clientId, CLIENT_ID));
    await db.delete(oauthClients).where(eq(oauthClients.clientId, CLIENT_ID));
    await db.delete(serviceClients).where(eq(serviceClients.clientId, SERVICE_CLIENT_ID));
    if (seededWorkspaceIds.length > 0) {
      await db.delete(workspaces).where(inArray(workspaces.id, seededWorkspaceIds));
      await cmQuery(`DELETE FROM ${cmTable('cm_workspace_members')} WHERE workspace_id = ANY($1)`, [seededWorkspaceIds]);
      await cmQuery(`DELETE FROM ${cmTable('cm_workspaces')} WHERE workspace_id = ANY($1)`, [seededWorkspaceIds]);
      seededWorkspaceIds.length = 0;
    }
    for (const tenantId of TEST_ORGS) await cmDeleteTenantMembershipsForTenant(tenantId);
    await cmDeleteTenants(TEST_ORGS);
    await cleanupAuthData();
  });

  it('keeps workspace tenant authority exclusively in the CM directory', async () => {
    const meta = await db.execute(sql`
      SELECT is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'workspaces' AND column_name = 'tenant_id'
    `);
    expect(meta.rows).toEqual([]);
    const id = `ws-cm-${crypto.randomUUID()}`;
    await seedWorkspace(id, ORG_A);
    expect(await findCmWorkspace(id)).toMatchObject({ workspaceId: id, tenantId: ORG_A });
    expect(await findCmTenant(ORG_A)).toMatchObject({ status: 'active' });
  });

  it('does not infer a default identity binding from a business-only workspace row', async () => {
    const id = `ws-default-${crypto.randomUUID()}`;
    await db.insert(workspaces).values({ id, name: 'old-pod-workspace' });
    seededWorkspaceIds.push(id);
    expect(await findCmWorkspace(id)).toBeNull();
    expect((await listCmWorkspacesForTenant(ORG_A)).some(row => row.workspaceId === id)).toBe(false);
  });

  it('DEFAULT-safe: an old-semantic consent insert (no tenant_id) persists with tenant_id=sentropic', async () => {
    const user = await createTestUser({ displayName: 'Consent Default', withWorkspace: false });
    await db.insert(oauthConsents).values({ userId: user.id, clientId: CLIENT_ID, scopes: ['openid'] });
    const [row] = await db
      .select({ tenantId: oauthConsents.tenantId })
      .from(oauthConsents)
      .where(and(eq(oauthConsents.userId, user.id), eq(oauthConsents.clientId, CLIENT_ID)));
    expect(row?.tenantId).toBe('sentropic');
  });

  it('removes the service protocol tenant column and requires an explicit CM binding', async () => {
    const meta = await db.execute(sql`
      SELECT column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'service_clients' AND column_name = 'tenant_id'
    `);
    expect(meta.rows).toEqual([]);

    await db.insert(serviceClients).values({
      id: `svc-${crypto.randomUUID()}`,
      clientId: SERVICE_CLIENT_ID,
      clientSecretHash: 'hash',
      allowedScopes: ['mcp:read'],
    });
    expect(await findCmServiceClientBinding(SERVICE_CLIENT_ID)).toBeNull();
  });

  it('backfill: migration grandfathers every existing user into sentropic membership', async () => {
    const migrationSql = await readFile(
      new URL('../../../drizzle/0038_arch11_tenant_data.sql', import.meta.url),
      'utf8',
    );
    const membershipBackfill = migrationSql
      .split('--> statement-breakpoint')
      .find((statement) => statement.includes('INSERT INTO "tenant_memberships"'));

    expect(membershipBackfill).toContain(`SELECT 'sentropic', "users"."id", 'approved', 'member', now(), now()`);
    expect(membershipBackfill).toContain('FROM "users"');
    expect(membershipBackfill).toContain('ON CONFLICT ("tenant_id", "user_id") DO NOTHING');
  });

  it('consent key (G1c): the old (user,client) index is DROPPED, the (user,client,tenant) composite governs — multi-org consent coexists', async () => {
    const indexes = await db.execute(sql`
      SELECT indexname FROM pg_indexes WHERE tablename = 'oauth_consents'
    `);
    const names = (indexes.rows as Array<{ indexname: string }>).map((r) => r.indexname);
    // The composite index is the authoritative multi-org consent key.
    expect(names).toContain('oauth_consents_user_id_client_id_tenant_id_unique');
    // G1c drops the G1a-deferred old (user,client) index (0039) — all adapters now target the composite,
    // so the old index only obstructs per-tenant consent rows. Its removal is what OPENS multi-org consent.
    expect(names).not.toContain('oauth_consents_user_id_client_id_unique');

    const user = await createTestUser({ displayName: 'Cross-Org Consent', withWorkspace: false });
    await db.insert(oauthConsents).values({ userId: user.id, clientId: CLIENT_ID, tenantId: ORG_A, scopes: ['openid'] });
    // G1c: the SAME (user, client) NOW coexists across two orgs — the org-B row is accepted (the
    // old-index obstacle is gone; the composite key distinguishes by tenant).
    await db.insert(oauthConsents).values({ userId: user.id, clientId: CLIENT_ID, tenantId: ORG_B, scopes: ['profile'] });
    const rows = await db
      .select({ tenantId: oauthConsents.tenantId })
      .from(oauthConsents)
      .where(and(eq(oauthConsents.userId, user.id), eq(oauthConsents.clientId, CLIENT_ID)));
    expect(rows.map((r) => r.tenantId).sort()).toEqual([ORG_A, ORG_B].sort());
    // Re-inserting the exact (user, client, tenant) triple STILL conflicts — the tenant leg is IN the key.
    await expect(
      db.insert(oauthConsents).values({ userId: user.id, clientId: CLIENT_ID, tenantId: ORG_A, scopes: ['email'] }),
    ).rejects.toThrow();
  });

  it('grandfather columns reconciled: control.app_instances/app_workspace_bindings.tenant_id gain DEFAULT sentropic', async () => {
    const rows = await db.execute(sql`
      SELECT table_name, column_default
      FROM information_schema.columns
      WHERE table_schema = 'control'
        AND column_name = 'tenant_id'
        AND table_name IN ('app_instances', 'app_workspace_bindings')
    `);
    const byTable = new Map(
      (rows.rows as Array<{ table_name: string; column_default: string | null }>).map((r) => [
        r.table_name,
        r.column_default ?? '',
      ]),
    );
    expect(byTable.get('app_instances') ?? '').toContain('sentropic');
    expect(byTable.get('app_workspace_bindings') ?? '').toContain('sentropic');
  });

  it('NON-VACUOUS cross-org isolation: org-B never resolves org-A workspace/membership/consent on the new columns', async () => {
    const userA = await createTestUser({ displayName: 'User A', withWorkspace: false });
    const userB = await createTestUser({ displayName: 'User B', withWorkspace: false });
    const shared = await createTestUser({ displayName: 'Shared User', withWorkspace: false });

    const wsA = `ws-${ORG_A}-${crypto.randomUUID()}`;
    const wsB = `ws-${ORG_B}-${crypto.randomUUID()}`;
    await seedWorkspace(wsA, ORG_A, userA.id);
    await seedWorkspace(wsB, ORG_B, userB.id);

    await setCmMembershipState(userA.id, ORG_A, { status: 'approved', decidedBy: userA.id });
    await setCmMembershipState(userB.id, ORG_B, { status: 'approved', decidedBy: userB.id });

    // The shared user consented to the client in org-A ONLY.
    await db.insert(oauthConsents).values({ userId: shared.id, clientId: CLIENT_ID, tenantId: ORG_A, scopes: ['openid', 'profile'] });

    // (1) CM's tenant-scoped directory returns only org-B workspaces.
    const bWorkspaces = await listCmWorkspacesForTenant(ORG_B);
    expect(bWorkspaces.map((r) => r.workspaceId)).toEqual([wsB]);

    // (2) Membership isolation: userA belongs to org-A only, never leaks into an org-B-scoped query.
    const aOnlyInB = (await listCmMembershipsForTenant(ORG_B)).filter(row => row.userId === userA.id);
    expect(aOnlyInB).toHaveLength(0);

    // (3) Consent isolation (§1.5 core): the shared user's org-A grant does NOT satisfy the org-B key.
    const bGrant = await db
      .select({ scopes: oauthConsents.scopes })
      .from(oauthConsents)
      .where(
        and(
          eq(oauthConsents.userId, shared.id),
          eq(oauthConsents.clientId, CLIENT_ID),
          eq(oauthConsents.tenantId, ORG_B),
        ),
      );
    expect(bGrant).toHaveLength(0);

    // The org-A grant is intact under its own tenant key (no accidental deletion / cross-write).
    const aGrant = await db
      .select({ scopes: oauthConsents.scopes })
      .from(oauthConsents)
      .where(
        and(
          eq(oauthConsents.userId, shared.id),
          eq(oauthConsents.clientId, CLIENT_ID),
          eq(oauthConsents.tenantId, ORG_A),
        ),
      );
    expect(aGrant).toHaveLength(1);
    expect([...(aGrant[0]?.scopes ?? [])].sort()).toEqual(['openid', 'profile']);
  });
});
