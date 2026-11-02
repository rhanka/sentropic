import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';

import { app } from '../../src/app';
import { db } from '../../src/db/client';
import {
  documentConnectorAccounts,
  workspaces,
} from '../../src/db/schema';
import { createCmConnectorFixture as storeConnectedAccount, captureConnectorRevocations, findConnectorFixture } from '../utils/cm-connector-fixture';
import { cmQuery, cmTable } from '../utils/cm-identity-test-store';
import { putCmWorkspaceMember } from '../../src/services/identity/cm-tenancy';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
  type TestUser,
} from '../utils/auth-helper';

let revokedTokens: string[] = [];
let actors: TestUser[] = [];

describe('Connector grant teardown — no deletion path destroys a grant unrevoked', () => {
  beforeEach(() => {
    actors = [];
    revokedTokens = captureConnectorRevocations();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await db.delete(documentConnectorAccounts).where(inArray(documentConnectorAccounts.userId, actors.map(actor => actor.id)));
    await db.delete(workspaces).where(inArray(workspaces.ownerUserId, actors.map(actor => actor.id)));
    await cleanupAuthData();
    await cmQuery(`DELETE FROM ${cmTable('cm_workspaces')} WHERE workspace_id = ANY($1)`, [actors.map(actor => actor.workspaceId)]);
  });

  it('DELETE /api/v1/workspaces/:id revokes the grants of EVERY member, not just the caller', async () => {
    const owner = await createAuthenticatedUser('editor');
    const member = await createAuthenticatedUser('editor');
    actors.push(owner, member);
    const workspaceId = String(owner.workspaceId);

    // The member holds a connector row in the OWNER's workspace. Connector rows cascade from
    // `workspaces`, so deleting the workspace destroys this row too — scoping the capture to the
    // acting user alone would strand this grant.
    await putCmWorkspaceMember(workspaceId, member.id, 'editor');
    await putCmWorkspaceMember(workspaceId, owner.id, 'admin');

    const ownerAccount = await storeConnectedAccount(owner);
    const memberAccount = await storeConnectedAccount(
      { ...member, workspaceId },
    );

    // The route refuses to delete a workspace that has not been hidden first.
    await db.update(workspaces).set({ hiddenAt: new Date() }).where(eq(workspaces.id, workspaceId));

    const response = await authenticatedRequest(
      app,
      'DELETE',
      `/api/v1/workspaces/${workspaceId}`,
      owner.sessionToken!,
    );
    expect(response.status).toBe(204);

    expect(await findConnectorFixture(ownerAccount.accountId)).toEqual([]);
    expect(await findConnectorFixture(memberAccount.accountId)).toEqual([]);

    expect(revokedTokens).toContain(ownerAccount.refreshToken);
    expect(revokedTokens).toContain(memberAccount.refreshToken);

  });

});
