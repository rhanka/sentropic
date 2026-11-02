import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../../../src/db/client';
import { workspaces } from '../../../src/db/schema';
import { findCmWorkspaceMember, putCmWorkspaceMember } from '../../../src/services/identity/cm-tenancy';
import { changeCmWorkspaceMember, listCmWorkspaceMemberViews } from '../../../src/services/identity/cm-workspace-members';
import { CmIdentityForbiddenError } from '../../../src/services/identity/cm-deletion-authorization';
import { bindCmAppDatabase, runCmIdentityWrite } from '../../../src/services/identity/cm-transaction';
import { cleanupAuthData, createTestUser, type TestUser } from '../../utils/auth-helper';
import { cmQuery, cmTable } from '../../utils/cm-identity-test-store';

describe('CM workspace membership authorization and atomicity', () => {
  let admin: TestUser;
  let target: TestUser;
  let workspaceId: string;
  beforeEach(async () => {
    admin = await createTestUser({ role: 'editor' });
    target = await createTestUser({ role: 'guest' });
    workspaceId = admin.workspaceId!;
    await db.update(workspaces).set({ type: 'code' }).where(eq(workspaces.id, workspaceId));
    await putCmWorkspaceMember(workspaceId, admin.id, 'admin');
  });
  afterEach(async () => {
    const ids = [admin?.workspaceId, target?.workspaceId].filter((id): id is string => Boolean(id));
    await cleanupAuthData();
    if (ids.length) {
      await db.delete(workspaces).where(inArray(workspaces.id, ids));
      await cmQuery(`DELETE FROM ${cmTable('cm_workspaces')} WHERE workspace_id = ANY($1)`, [ids]);
    }
  });

  it('adds, changes and removes only the named workspace membership', async () => {
    await changeCmWorkspaceMember({ actorId: admin.id, workspaceId,
      action: { kind: 'add', email: target.email, role: 'viewer' } });
    expect(await findCmWorkspaceMember(workspaceId, target.id)).toMatchObject({ role: 'viewer' });
    const members = await listCmWorkspaceMemberViews(admin.id, workspaceId);
    expect(members.find(row => row.userId === target.id)).toMatchObject({ email: target.email, role: 'viewer' });
    await changeCmWorkspaceMember({ actorId: admin.id, workspaceId,
      action: { kind: 'set_role', userId: target.id, role: 'commenter' } });
    expect(await findCmWorkspaceMember(workspaceId, target.id)).toMatchObject({ role: 'commenter' });
    await changeCmWorkspaceMember({ actorId: admin.id, workspaceId,
      action: { kind: 'remove', userId: target.id } });
    expect(await findCmWorkspaceMember(workspaceId, target.id)).toBeNull();
    expect(await findCmWorkspaceMember(target.workspaceId!, target.id)).not.toBeNull();
  });

  it('refuses cross-workspace administration and a demoted admin on the next call', async () => {
    const command = { actorId: target.id, workspaceId,
      action: { kind: 'add' as const, email: target.email, role: 'admin' as const } };
    await expect(changeCmWorkspaceMember(command)).rejects.toBeInstanceOf(CmIdentityForbiddenError);
    await putCmWorkspaceMember(workspaceId, admin.id, 'viewer');
    await expect(changeCmWorkspaceMember({ ...command, actorId: admin.id }))
      .rejects.toBeInstanceOf(CmIdentityForbiddenError);
    expect(await findCmWorkspaceMember(workspaceId, target.id)).toBeNull();
  });

  it('rolls back membership and business changes together after an injected failure', async () => {
    const [before] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    await expect(runCmIdentityWrite(async tx => {
      await changeCmWorkspaceMember({ actorId: admin.id, workspaceId,
        action: { kind: 'add', email: target.email, role: 'editor' } });
      await bindCmAppDatabase(tx).update(workspaces).set({ name: 'Must roll back' }).where(eq(workspaces.id, workspaceId));
      throw new Error('injected_workspace_failure');
    })).rejects.toThrow('injected_workspace_failure');
    expect(await findCmWorkspaceMember(workspaceId, target.id)).toBeNull();
    const [after] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(after).toEqual(before);
  });

  it('retains personal workspace non-delegation', async () => {
    await db.update(workspaces).set({ type: 'neutral' }).where(eq(workspaces.id, workspaceId));
    await expect(changeCmWorkspaceMember({ actorId: admin.id, workspaceId,
      action: { kind: 'add', email: target.email, role: 'viewer' } }))
      .rejects.toThrow('Neutral workspaces do not support memberships');
    expect(await findCmWorkspaceMember(workspaceId, target.id)).toBeNull();
  });
});
