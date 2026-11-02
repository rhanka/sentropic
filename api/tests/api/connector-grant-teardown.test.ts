import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

import { app } from '../../src/app';
import { db } from '../../src/db/client';
import {
  documentConnectorAccounts,
  workspaces,
} from '../../src/db/schema';
import { createCmConnectorFixture as storeConnectedAccount } from '../utils/cm-connector-fixture';
import { putCmWorkspaceMember } from '../../src/services/identity/cm-tenancy';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
} from '../utils/auth-helper';

const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

/** Tokens posted to Google's revoke endpoint during one test. */
let revokedTokens: string[] = [];

const realFetch = globalThis.fetch;

const installRevokeSpy = () => {
  revokedTokens = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : String((input as Request)?.url ?? input);

      if (url.startsWith(GOOGLE_REVOKE_ENDPOINT)) {
        const body = init?.body;
        const token =
          body instanceof URLSearchParams
            ? (body.get('token') ?? '')
            : new URLSearchParams(String(body ?? '')).get('token') || '';
        revokedTokens.push(token);
        return new Response(null, { status: 200 });
      }

      return realFetch(input as RequestInfo, init);
    }),
  );
};

const connectorRowExists = async (accountId: string): Promise<boolean> => {
  const [row] = await db
    .select({ id: documentConnectorAccounts.id })
    .from(documentConnectorAccounts)
    .where(eq(documentConnectorAccounts.id, accountId))
    .limit(1);
  return Boolean(row);
};

describe('Connector grant teardown — no deletion path destroys a grant unrevoked', () => {
  beforeEach(() => {
    installRevokeSpy();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await cleanupAuthData();
  });





  it('DELETE /api/v1/workspaces/:id revokes the grants of EVERY member, not just the caller', async () => {
    const owner = await createAuthenticatedUser('editor');
    const member = await createAuthenticatedUser('editor');
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

    expect(await connectorRowExists(ownerAccount.accountId)).toBe(false);
    expect(await connectorRowExists(memberAccount.accountId)).toBe(false);

    expect(revokedTokens).toContain(ownerAccount.refreshToken);
    expect(revokedTokens).toContain(memberAccount.refreshToken);

  });




});
