/**
 * Connector-grant teardown — every deletion site, proven.
 *
 * THE INVARIANT UNDER TEST
 * A connector row that owns an external grant is never destroyed before that grant has been
 * revoked upstream, or a durable tombstone of the abandoned grant has been recorded.
 *
 * WHY IT NEEDS PROVING AT THE ROUTE LEVEL
 * `document_connector_accounts` cascades from BOTH `users` and `workspaces`. A cascade is executed
 * by Postgres and runs NO application code — the repository defines no trigger or function, so
 * there is not even a hook to attach to. Every route that deletes a user or a workspace therefore
 * destroys the encrypted refresh token in the same statement that destroys the row, and once it is
 * gone nothing remains to call revoke with: the grant stays live at Google forever. Testing the
 * service in isolation would prove nothing about the routes that actually do the deleting.
 *
 * WHY THE ASSERTIONS ARE SHAPED THIS WAY
 * The behavioural tests assert the EXACT refresh-token string that reached Google's revoke
 * endpoint. That string exists only inside the row's encrypted secret, so an implementation that
 * revoked after the deletion — or that never captured the row at all — cannot produce it. Merely
 * asserting "revoke was called" would also pass for an implementation that posted an empty token.
 * Each test additionally asserts the row really is gone, so none of them can pass on a no-op.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

  it('DELETE /api/v1/me revokes the grant upstream before the row cascades away', async () => {
    const user = await createAuthenticatedUser('editor');
    const { accountId, refreshToken } = await storeConnectedAccount(user, 'me-teardown');

    const response = await authenticatedRequest(app, 'DELETE', '/api/v1/me', user.sessionToken!);
    expect(response.status).toBe(200);

    // The row is really gone — this test cannot pass on a deletion that did not happen.
    expect(await connectorRowExists(accountId)).toBe(false);

    // The exact stored refresh token reached Google. Only a capture performed BEFORE the deletion
    // can produce this value.
    expect(revokedTokens).toContain(refreshToken);

    const tombstones = await tombstonesFor(accountId);
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0]!.aggregateType).toBe('connector_account');
    expect(tombstones[0]!.envelope).toMatchObject({
      type: CONNECTOR_GRANT_ORPHANED_EVENT,
      accountId,
      reason: 'row_deleted',
    });
  });

  it('DELETE /api/v1/admin/users/:id revokes the target user grant, not the admin caller grant', async () => {
    const admin = await createAuthenticatedUser('admin_app');
    const target = await createAuthenticatedUser('editor');

    const targetAccount = await storeConnectedAccount(target, 'admin-teardown-target');
    // The admin also holds a grant. Deleting the target must not touch it — a scope that leaked to
    // "every connected account" would revoke a live grant belonging to someone else entirely.
    const adminAccount = await storeConnectedAccount(admin, 'admin-teardown-caller');

    await db
      .update(users)
      .set({ accountStatus: 'disabled_by_admin', updatedAt: new Date() })
      .where(eq(users.id, target.id));

    const response = await authenticatedRequest(
      app,
      'DELETE',
      `/api/v1/admin/users/${target.id}`,
      admin.sessionToken!,
    );
    expect(response.status).toBe(200);

    expect(await connectorRowExists(targetAccount.accountId)).toBe(false);
    expect(revokedTokens).toContain(targetAccount.refreshToken);

    expect(await connectorRowExists(adminAccount.accountId)).toBe(true);
    expect(revokedTokens).not.toContain(adminAccount.refreshToken);

    const tombstones = await tombstonesFor(targetAccount.accountId);
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0]!.envelope).toMatchObject({ reason: 'row_deleted' });
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

  it('records a tombstone for a grant whose secret is unreadable, instead of silently dropping it', async () => {
    const user = await createAuthenticatedUser('editor');
    const accountId = await insertUnreadableAccount(user, 'me-unreadable');

    const response = await authenticatedRequest(app, 'DELETE', '/api/v1/me', user.sessionToken!);
    expect(response.status).toBe(200);

    expect(await connectorRowExists(accountId)).toBe(false);

    // Nothing revocable existed, so no upstream call is possible. The tombstone is the ONLY trace
    // that a live grant was abandoned — an implementation that treats "no readable token" as
    // "nothing to do" leaves no record at all, and this assertion is what catches it.
    expect(revokedTokens).toHaveLength(0);

    const tombstones = await tombstonesFor(accountId);
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0]!.envelope).toMatchObject({
      type: CONNECTOR_GRANT_ORPHANED_EVENT,
      accountId,
      reason: 'token_unreadable',
    });
  });

  it('never writes the credential itself into the tombstone', async () => {
    const user = await createAuthenticatedUser('editor');
    const { accountId, refreshToken } = await storeConnectedAccount(user, 'me-no-credential');

    const [row] = await db
      .select({ tokenSecret: documentConnectorAccounts.tokenSecret })
      .from(documentConnectorAccounts)
      .where(eq(documentConnectorAccounts.id, accountId))
      .limit(1);
    const ciphertext = row!.tokenSecret!;

    await authenticatedRequest(app, 'DELETE', '/api/v1/me', user.sessionToken!);

    const tombstones = await tombstonesFor(accountId);
    expect(tombstones).toHaveLength(1);
    const serialized = JSON.stringify(tombstones[0]!.envelope);
    expect(serialized).not.toContain(refreshToken);
    expect(serialized).not.toContain(ciphertext);
  });
});

describe('Connector grant teardown — the enumeration of deletion sites is complete', () => {
  const routesDir = fileURLToPath(new URL('../../src/routes', import.meta.url));

  const listTsFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return listTsFiles(full);
      return entry.name.endsWith('.ts') ? [full] : [];
    });

  /**
   * The routes known to delete a `users` or `workspaces` row, and therefore to cascade connector
   * rows away. This list is asserted to be EXHAUSTIVE below: it is derived from the source at every
   * run rather than trusted as a stored snapshot, because a stored census of a living state is a
   * schedule, not a property.
   */
  const KNOWN_CASCADING_DELETERS = [
    'api/admin.ts',
    'api/workspaces.ts',
    'namespaces/auth/account.ts',
  ];

  // Relative to `src/routes`, so the expectation reads identically wherever the repo lives — the
  // test container mounts it under /workspace, the host under the worktree path.
  const relative = (file: string) => file.slice(routesDir.length + 1);

  it('finds no route deleting a user or workspace outside the wired set', () => {
    const cascadingDeleters = listTsFiles(routesDir)
      .filter((file) => {
        const source = readFileSync(file, 'utf8');
        return /\.delete\(\s*users\s*\)/.test(source) || /\.delete\(\s*workspaces\s*\)/.test(source);
      })
      .map(relative)
      .sort();

    // A new deletion route fails here until it is wired to the teardown. That is the point: the
    // cascade is silent, so nothing else would ever surface the omission.
    expect(cascadingDeleters).toEqual([...KNOWN_CASCADING_DELETERS].sort());
  });

  it('wires capture, tombstone and revoke in every one of them', () => {
    for (const relPath of KNOWN_CASCADING_DELETERS) {
      const source = readFileSync(join(routesDir, relPath), 'utf8');

      // Check the import DECLARATION, not a mention: an earlier version of this check matched the
      // module name inside a doc comment and passed on two files that had no import at all.
      expect(source, `${relPath} must import the teardown module`).toMatch(
        /}\s*from\s*'(?:\.\.\/){2,3}services\/connector-grant-teardown';/,
      );
      expect(source, `${relPath} must capture grants before deleting`).toContain(
        'captureConnectorGrantsForTeardown(',
      );
      expect(source, `${relPath} must record tombstones inside the transaction`).toContain(
        'recordConnectorGrantTombstones(tx,',
      );
      expect(source, `${relPath} must revoke after the commit`).toContain(
        'revokeCapturedConnectorGrants(',
      );
    }
  });
});
