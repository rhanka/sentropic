import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { app } from '../../../src/app';
import { db } from '../../../src/db/client';
import { documentConnectorAccounts, workspaces } from '../../../src/db/schema';
import { findCmUserById, updateCmUser } from '../../../src/services/identity/cm-users';
import { putCmWorkspaceMember } from '../../../src/services/identity/cm-tenancy';
import { drainCmRevocations } from '../../../src/services/identity/cm-revocation-worker';
import { authenticatedRequest, cleanupAuthData, createAuthenticatedUser, type TestUser } from '../../utils/auth-helper';
import { cmQuery, cmTable } from '../../utils/cm-identity-test-store';
import { captureConnectorRevocations, createCmConnectorFixture, findConnectorFixture } from '../../utils/cm-connector-fixture';

describe('CM V2 account deletion and external connector delivery', () => {
  let admin: TestUser, target: TestUser, actors: TestUser[], revokedTokens: string[];
  beforeEach(async () => {
    const budget = { deadlineMs: 10_000, maxAttempts: 1 };
    vi.stubEnv('CM_IDENTITY_DELETION_BUDGETS_JSON', JSON.stringify({
      reservation: budget, deletion: budget, diagnostic: budget, read: budget,
      qualificationReceiptRef: 'synthetic-test-only-not-a-rehearsal-receipt' }));
    revokedTokens = captureConnectorRevocations();
    admin = await createAuthenticatedUser('admin_app');
    target = await createAuthenticatedUser('editor');
    actors = [admin, target];
  });
  afterEach(async () => {
    vi.unstubAllGlobals(); vi.unstubAllEnvs();
    const ids = actors.map(actor => actor.id), workspaceIds = actors.map(actor => actor.workspaceId!);
    await db.delete(documentConnectorAccounts).where(inArray(documentConnectorAccounts.userId, ids));
    await db.delete(workspaces).where(inArray(workspaces.ownerUserId, ids));
    await cleanupAuthData();
    await cmQuery(`DELETE FROM ${cmTable('cm_workspaces')} WHERE workspace_id = ANY($1)`, [workspaceIds]);
  });
  const disable = () => updateCmUser(target.id, { accountStatus: 'disabled_by_admin',
    disabledAt: new Date(), disabledReason: 'connector deletion fixture' });
  const remove = () => authenticatedRequest(app, 'DELETE', `/api/v1/admin/users/${target.id}`, admin.sessionToken!);

  it('commits scoped encrypted custody before deletion and delivers the exact captured capabilities afterward', async () => {
    const member = await createAuthenticatedUser('editor'); actors.push(member);
    await putCmWorkspaceMember(target.workspaceId!, member.id, 'editor');
    const own = await createCmConnectorFixture(target);
    const shared = await createCmConnectorFixture({ ...member, workspaceId: target.workspaceId });
    const untouched = await createCmConnectorFixture(admin);
    await disable();
    const response = await remove();
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toMatchObject({ success: true, complete: false, status: 'delivery_pending',
      receipt: { transaction: 'committed', userId: target.id } });
    expect(await findConnectorFixture(own.accountId)).toEqual([]);
    expect(await findConnectorFixture(shared.accountId)).toEqual([]);
    expect(await findConnectorFixture(untouched.accountId)).toHaveLength(1);
    expect(await findCmUserById(target.id)).toBeNull();
    expect(await findCmUserById(member.id)).not.toBeNull();
    expect(revokedTokens).toEqual([]);
    const deliveries = await cmQuery<{ delivery_id: string; subject_id: string; target_ref: string; state: string }>(
      `SELECT * FROM ${cmTable('identity_revocation_outbox')} WHERE operation_id = $1 AND step = 'connector_grants'`,
      [body.operationId]);
    expect(deliveries).toEqual(expect.arrayContaining([
      expect.objectContaining({ subject_id: target.id, target_ref: own.accountId, state: 'pending' }),
      expect.objectContaining({ subject_id: member.id, target_ref: shared.accountId, state: 'pending' })]));
    expect(deliveries).toHaveLength(2);
    const custody = await cmQuery(`SELECT * FROM control.connector_revocation_custody WHERE delivery_id = ANY($1)`,
      [deliveries.map(row => row.delivery_id)]);
    expect(custody).toHaveLength(2);
    for (const grant of [own, shared]) {
      expect(JSON.stringify([body, deliveries, custody])).not.toContain(grant.refreshToken);
      expect(JSON.stringify([body, deliveries, custody])).not.toContain(grant.ciphertext);
    }
    for (const _id of body.receipt.deliveryIds) await drainCmRevocations();
    expect(revokedTokens.sort()).toEqual([own.refreshToken, shared.refreshToken].sort());
    expect(revokedTokens).not.toContain(untouched.refreshToken);
    expect(await cmQuery(`SELECT delivery_id FROM control.connector_revocation_custody WHERE delivery_id = ANY($1)`,
      [deliveries.map(row => row.delivery_id)])).toEqual([]);
    expect(await cmQuery(`SELECT DISTINCT state FROM ${cmTable('identity_revocation_outbox')}
      WHERE operation_id = $1 AND step = 'connector_grants'`, [body.operationId])).toEqual([{ state: 'delivered' }]);
  });

  it('preserves account, workspace and connector rows when capture cannot decrypt the capability', async () => {
    const grant = await createCmConnectorFixture(target);
    await db.update(documentConnectorAccounts).set({ tokenSecret: 'unreadable-fixture' })
      .where(eq(documentConnectorAccounts.id, grant.accountId));
    await disable();
    const before = await findConnectorFixture(grant.accountId), account = await findCmUserById(target.id);
    const response = await remove();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ complete: false });
    expect(await findConnectorFixture(grant.accountId)).toEqual(before);
    expect(await findCmUserById(target.id)).toEqual(account);
    expect(await db.select().from(workspaces).where(eq(workspaces.id, target.workspaceId!))).toHaveLength(1);
    expect(await cmQuery(`SELECT delivery_id FROM ${cmTable('identity_revocation_outbox')}
      WHERE operation_id = $1`, [body.operationId])).toEqual([]);
    expect(await cmQuery(`SELECT custody_ref FROM control.connector_revocation_custody WHERE connector_account_id = $1`,
      [grant.accountId])).toEqual([]);
    expect(revokedTokens).toEqual([]);
  });
});
