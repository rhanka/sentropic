import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { readFile } from 'node:fs/promises';

import { db } from '../../../src/db/client';
import {
  oauthClients,
  oauthConsents,
  serviceClients,
  tenantMemberships,
  tenants,
  workspaces,
} from '../../../src/db/schema';
import { cleanupAuthData, createTestUser } from '../../utils/auth-helper';

// ARCH-11 G1a — Tenant DATA reconciliation (spec §4.1). These tests assert the DEFAULT-safe,
// no-behavior-change DATA migration: the durable workspace→tenant edge, the tenantized consent key
// (§1.5), the service-client default, grandfather-column reconciliation, and — non-vacuously —
// row-level isolation across ≥2 real orgs on the NEW columns.

const ORG_A = 'arch11-org-a';
const ORG_B = 'arch11-org-b';
const TEST_ORGS = [ORG_A, ORG_B];
const CLIENT_ID = 'arch11-consent-client';
const SERVICE_CLIENT_ID = 'arch11-service-client';
const seededWorkspaceIds: string[] = [];

async function seedOrg(id: string): Promise<void> {
  await db.insert(tenants).values({ id, name: id, status: 'active' }).onConflictDoNothing();
}

async function seedWorkspace(id: string, tenantId: string, ownerUserId?: string): Promise<void> {
  await db
    .insert(workspaces)
    .values({ id, name: `ws-${id}`, tenantId, ...(ownerUserId ? { ownerUserId } : {}) })
    .onConflictDoNothing();
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

describe('ARCH-11 G1a — tenant DATA reconciliation (DEFAULT-safe, no behavior change)', () => {
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
      seededWorkspaceIds.length = 0;
    }
    await db.delete(tenantMemberships).where(inArray(tenantMemberships.tenantId, TEST_ORGS));
    await db.delete(tenants).where(inArray(tenants.id, TEST_ORGS));
    await cleanupAuthData();
  });

  it('migration applied: workspaces.tenant_id is NOT NULL, FK-enforced, defaulted to sentropic; bootstrap tenant exists', async () => {
    const meta = await db.execute(sql`
      SELECT is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'workspaces' AND column_name = 'tenant_id'
    `);
    const col = meta.rows[0] as { is_nullable: string; column_default: string | null };
    expect(col.is_nullable).toBe('NO');
    expect(col.column_default ?? '').toContain('sentropic');

    const [bootstrap] = await db.select().from(tenants).where(eq(tenants.id, 'sentropic'));
    expect(bootstrap?.id).toBe('sentropic');

    // FK is enforced: a workspace pointing at a non-existent org is rejected.
    await expect(
      db.insert(workspaces).values({ id: `ws-fk-${crypto.randomUUID()}`, name: 'fk', tenantId: 'no-such-org' }),
    ).rejects.toThrow();
  });

  it('DEFAULT-safe: an old-semantic workspace insert (no tenant_id) persists with tenant_id=sentropic', async () => {
    // Simulates a not-yet-rolled pod inserting a workspace without the new column.
    const id = `ws-default-${crypto.randomUUID()}`;
    await db.insert(workspaces).values({ id, name: 'old-pod-workspace' });
    seededWorkspaceIds.push(id);
    const [row] = await db.select({ tenantId: workspaces.tenantId }).from(workspaces).where(eq(workspaces.id, id));
    expect(row?.tenantId).toBe('sentropic');
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

  it('service_clients.tenant_id gains a DEFAULT (sentropic) so new single-org clients inherit a tenant', async () => {
    const meta = await db.execute(sql`
      SELECT column_default
      FROM information_schema.columns
      WHERE table_name = 'service_clients' AND column_name = 'tenant_id'
    `);
    expect(((meta.rows[0] as { column_default: string | null }).column_default ?? '')).toContain('sentropic');

    await db.insert(serviceClients).values({
      id: `svc-${crypto.randomUUID()}`,
      clientId: SERVICE_CLIENT_ID,
      clientSecretHash: 'hash',
      allowedScopes: ['mcp:read'],
    });
    const [row] = await db
      .select({ tenantId: serviceClients.tenantId })
      .from(serviceClients)
      .where(eq(serviceClients.clientId, SERVICE_CLIENT_ID));
    expect(row?.tenantId).toBe('sentropic');
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

    await db.insert(tenantMemberships).values({ tenantId: ORG_A, userId: userA.id, status: 'approved', role: 'member' });
    await db.insert(tenantMemberships).values({ tenantId: ORG_B, userId: userB.id, status: 'approved', role: 'member' });

    // The shared user consented to the client in org-A ONLY.
    await db.insert(oauthConsents).values({ userId: shared.id, clientId: CLIENT_ID, tenantId: ORG_A, scopes: ['openid', 'profile'] });

    // (1) Workspace isolation on the new tenant_id column: an org-B-scoped query returns ONLY wsB.
    const bWorkspaces = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(eq(workspaces.tenantId, ORG_B), inArray(workspaces.id, [wsA, wsB])));
    expect(bWorkspaces.map((r) => r.id)).toEqual([wsB]);

    // (2) Membership isolation: userA belongs to org-A only, never leaks into an org-B-scoped query.
    const aOnlyInB = await db
      .select({ userId: tenantMemberships.userId })
      .from(tenantMemberships)
      .where(and(eq(tenantMemberships.tenantId, ORG_B), eq(tenantMemberships.userId, userA.id)));
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
