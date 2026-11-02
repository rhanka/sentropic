import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../../src/db/client';
import { settings, workspaces } from '../../../src/db/schema';
import { deleteCmAccountAsAdmin } from '../../../src/services/identity/cm-account-deletion';
import { createCmUser, updateCmUser } from '../../../src/services/identity/cm-users';
import { createCmSession } from '../../../src/services/identity/cm-sessions';
import { sha256Hex } from '../../../src/services/identity/cm-proofs';
import { createCmTenant, enrolCmWorkspace, putCmWorkspaceMember, setCmMembershipState } from '../../../src/services/identity/cm-tenancy';
import { cmDeleteForEmails, cmDeleteForUsers, cmQuery, cmTable } from '../../utils/cm-identity-test-store';

describe('A4 account deletion with the real CM V2 coordinator', () => {
  let subject: string, actor: string, tenant: string, workspace: string, fault: string;
  beforeEach(async () => {
    if (process.env.NODE_ENV !== 'test') throw new Error('Isolated test environment required');
    subject = randomUUID(); actor = randomUUID(); tenant = randomUUID(); workspace = randomUUID();
    fault = `a4_fault_${randomUUID().replaceAll('-', '')}`;
    const budget = { deadlineMs: 10_000, maxAttempts: 1 };
    vi.stubEnv('CM_IDENTITY_DELETION_BUDGETS_JSON', JSON.stringify({
      reservation: budget, deletion: budget, diagnostic: budget, read: budget,
      qualificationReceiptRef: 'synthetic-test-only-not-a-rehearsal-receipt',
    }));
    await createCmUser({ userId: actor, email: `${actor}@example.com`, role: 'admin_app', emailVerified: true });
    await createCmUser({ userId: subject, email: `${subject}@example.com`, role: 'editor', emailVerified: true });
    await createCmTenant({ tenantId: tenant });
    await db.insert(workspaces).values({ id: workspace, ownerUserId: subject, name: 'Deletion fixture', type: 'neutral' });
    await enrolCmWorkspace({ workspaceId: workspace, tenantId: tenant });
    await setCmMembershipState(subject, tenant, { status: 'approved', decidedBy: actor });
    await putCmWorkspaceMember(workspace, subject, 'admin');
    await db.insert(settings).values({ key: 'deletion-fixture', userId: subject, value: 'preserve-on-rollback' });
    await createCmSession({ id: randomUUID(), userId: subject, sessionTokenHash: sha256Hex(randomUUID()),
      refreshTokenHash: sha256Hex(randomUUID()), now: new Date(), expiresAt: new Date(Date.now() + 60_000) });
    await updateCmUser(subject, { accountStatus: 'disabled_by_admin', disabledAt: new Date(), disabledReason: 'test' });
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    if (!fault) return;
    await cmQuery(`DROP TRIGGER IF EXISTS "${fault}" ON ${cmTable('identity_user_accounts')}`);
    await cmQuery(`DROP FUNCTION IF EXISTS public."${fault}"()`);
    await cmQuery(`DROP SEQUENCE IF EXISTS public."${fault}"`);
    await db.delete(settings).where(eq(settings.userId, subject));
    await cmDeleteForEmails([`${subject}@example.com`, `${actor}@example.com`]);
    await cmDeleteForUsers([subject, actor]);
    await db.delete(workspaces).where(eq(workspaces.id, workspace));
    await cmQuery(`DELETE FROM ${cmTable('cm_workspaces')} WHERE workspace_id = $1`, [workspace]);
    await cmQuery(`DELETE FROM ${cmTable('cm_tenants')} WHERE tenant_id = $1`, [tenant]);
  });

  const snapshot = async () => {
    const rows: Record<string, unknown> = {};
    for (const table of ['identity_user_accounts', 'identity_account_profiles', 'identity_login_sessions',
      'identity_login_token_bindings', 'cm_tenant_memberships', 'cm_workspace_members', 'cm_workspaces']) {
      const predicate = table === 'identity_login_token_bindings'
        ? `session_id IN (SELECT session_id FROM ${cmTable('identity_login_sessions')} WHERE user_id = $1)`
        : table === 'cm_workspaces' ? 'workspace_id = $1' : 'user_id = $1';
      rows[table] = await cmQuery(`SELECT * FROM ${cmTable(table)} WHERE ${predicate}`,
        [table === 'cm_workspaces' ? workspace : subject]);
    }
    rows.business = await db.select().from(workspaces).where(eq(workspaces.id, workspace));
    rows.settings = await db.select().from(settings).where(eq(settings.userId, subject));
    rows.outbox = await cmQuery(`SELECT * FROM ${cmTable('identity_revocation_outbox')} WHERE subject_id = $1`, [subject]);
    return rows;
  };

  it('records one rolled-back receipt and preserves all rows when the final account delete fails', async () => {
    const before = await snapshot(), operationId = randomUUID();
    // Sequence advancement is nontransactional: prove the final delete was reached, not an earlier guard.
    await cmQuery(`CREATE SEQUENCE public."${fault}"`);
    await cmQuery(`CREATE FUNCTION public."${fault}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN PERFORM nextval('public."${fault}"'); RAISE EXCEPTION 'a4_injected_account_delete_failure'; END $$`);
    await cmQuery(`CREATE TRIGGER "${fault}" BEFORE DELETE ON ${cmTable('identity_user_accounts')}
      FOR EACH ROW WHEN (OLD.user_id = '${subject}') EXECUTE FUNCTION public."${fault}"()`);

    const receipt = await deleteCmAccountAsAdmin({ actorId: actor, userId: subject }, operationId);
    expect((await cmQuery<{ is_called: boolean }>(`SELECT is_called FROM public."${fault}"`))[0].is_called).toBe(true);
    expect(receipt).toMatchObject({ operationId, userId: subject, transaction: 'rolled_back',
      resultCode: 'identity_cascade_rolled_back', complete: false, business: null, cleanup: null, deliveryIds: [] });
    expect(receipt.steps.find(step => step.step === 'account'))
      .toMatchObject({ outcome: 'queued', detailCode: 'required_local_step_failed' });
    expect(receipt.steps.some(step => step.outcome === 'applied')).toBe(false);
    expect(await snapshot()).toEqual(before);
    expect(await cmQuery(`SELECT state FROM ${cmTable('identity_deletion_operations')} WHERE operation_id = $1`, [operationId]))
      .toEqual([{ state: 'queued' }]);
    expect(await cmQuery(`SELECT operation_id FROM ${cmTable('identity_deletion_attempts')} WHERE operation_id = $1`, [operationId]))
      .toHaveLength(1);
    const orphans = await cmQuery(`SELECT s.session_id FROM ${cmTable('identity_login_sessions')} s
      LEFT JOIN ${cmTable('identity_user_accounts')} a ON a.user_id = s.user_id
      LEFT JOIN ${cmTable('identity_login_token_bindings')} b ON b.session_id = s.session_id
      WHERE s.user_id = $1 AND (a.user_id IS NULL OR b.session_id IS NULL)`, [subject]);
    expect(orphans).toEqual([]);
  });
});
