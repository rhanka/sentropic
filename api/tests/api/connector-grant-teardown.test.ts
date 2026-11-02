import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';

import { app } from '../../src/app';
import { db } from '../../src/db/client';
import { eventOutbox } from '../../src/db/control-schema';
import {
  documentConnectorAccounts,
  users,
  workspaceMemberships,
  workspaces,
} from '../../src/db/schema';
import { CONNECTOR_GRANT_ORPHANED_EVENT } from '../../src/services/connector-grant-teardown';
import { storeGoogleDriveTokenMaterial } from '../../src/services/google-drive-connector-accounts';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
  type TestUser,
} from '../utils/auth-helper';

const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

/** Tokens posted to Google's revoke endpoint during one test. */
let revokedTokens: string[] = [];
/** Outbox rows created by a test, cleaned up afterwards. */
let createdAggregateIds: string[] = [];

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

const storeConnectedAccount = async (
  user: TestUser,
  accountSubject: string,
): Promise<{ accountId: string; refreshToken: string }> => {
  const refreshToken = `refresh-${accountSubject}`;
  await storeGoogleDriveTokenMaterial({
    userId: user.id,
    workspaceId: String(user.workspaceId),
    identity: {
      accountEmail: `${accountSubject}@example.com`,
      accountSubject,
    },
    token: {
      accessToken: `access-${accountSubject}`,
      refreshToken,
      idToken: `id-${accountSubject}`,
      tokenType: 'Bearer',
      expiresIn: 3600,
      scope: 'openid email profile https://www.googleapis.com/auth/drive.file',
      scopes: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.file'],
      obtainedAt: '2099-05-01T10:00:00.000Z',
      expiresAt: '2099-05-01T11:00:00.000Z',
    },
  });

  const [row] = await db
    .select({ id: documentConnectorAccounts.id })
    .from(documentConnectorAccounts)
    .where(
      and(
        eq(documentConnectorAccounts.userId, user.id),
        eq(documentConnectorAccounts.accountSubject, accountSubject),
      ),
    )
    .limit(1);

  expect(row?.id, 'the account must exist before the deletion under test').toBeTruthy();
  createdAggregateIds.push(row!.id);
  return { accountId: row!.id, refreshToken };
};

/** A row whose stored secret cannot be decrypted — the 2026-07-27 lost-key shape. */
const insertUnreadableAccount = async (user: TestUser, accountSubject: string): Promise<string> => {
  const id = crypto.randomUUID();
  await db.insert(documentConnectorAccounts).values({
    id,
    workspaceId: String(user.workspaceId),
    userId: user.id,
    provider: 'google_drive',
    status: 'connected',
    accountEmail: `${accountSubject}@example.com`,
    accountSubject,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
    // Not ciphertext this deployment can read. `decryptSecretOrNull` returns null, which is
    // exactly what a row encrypted under a since-rotated key looks like.
    tokenSecret: 'not-decryptable-under-the-current-key',
    connectedAt: new Date(),
  });
  createdAggregateIds.push(id);
  return id;
};

const tombstonesFor = async (accountId: string) =>
  db
    .select({
      aggregateType: eventOutbox.aggregateType,
      envelope: eventOutbox.envelope,
    })
    .from(eventOutbox)
    .where(eq(eventOutbox.aggregateId, accountId));

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
    for (const aggregateId of createdAggregateIds) {
      await db.delete(eventOutbox).where(eq(eventOutbox.aggregateId, aggregateId));
    }
    createdAggregateIds = [];
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
    await db
      .insert(workspaceMemberships)
      .values({ workspaceId, userId: member.id, role: 'editor' })
      .onConflictDoNothing();
    await db
      .insert(workspaceMemberships)
      .values({ workspaceId, userId: owner.id, role: 'admin' })
      .onConflictDoUpdate({
        target: [workspaceMemberships.workspaceId, workspaceMemberships.userId],
        set: { role: 'admin' },
      });

    const ownerAccount = await storeConnectedAccount(owner, 'ws-teardown-owner');
    const memberAccount = await storeConnectedAccount(
      { ...member, workspaceId },
      'ws-teardown-member',
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

    expect(await tombstonesFor(memberAccount.accountId)).toHaveLength(1);
  });




});
