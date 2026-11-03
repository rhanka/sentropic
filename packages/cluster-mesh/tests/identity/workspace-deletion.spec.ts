// G4 / P5 atomic standalone workspace deletion (composition bundle 1.2.0):
// happy path with exact receipt, injected-failure rollback, authorization
// refusals, factory-time composition checks, absent-plane guard, races and
// the foreign-host rule — on both durable profiles.

import { describe, expect, it } from 'vitest';
import type {
  AtomicWorkspaceDeletionV1,
  ConnectorCapabilityV1,
  ConnectorRevocationCustodyPortV1,
  IdentityExternalRevocationDraftV1,
  IdentityTransactionV1,
  IdentityUnitOfWorkV1,
  WorkspaceBusinessDeletionPortV1,
  WorkspaceDeletionAuthorizationPortV1,
  WorkspaceDeletionPlanePortV1,
} from '../../src/index.js';
import {
  createAtomicWorkspaceDeletionV1,
  createConnectorRevocationCustodyPortV1,
  createNodeConnectorCustody,
  IDENTITY_COMPOSITION_DESCRIPTORS,
  IdentityCustodyErrorV1,
  IdentityNotFoundError,
} from '../../src/index.js';
import { identityDeliveryId } from '../../src/storage/identity/custody-import-deliveries.js';
import { rebindIdentityTransactionHost } from '../../src/storage/identity/custody-transaction-guards.js';
import { asOpHost, LATER, NOW, openPostgresEnv, openSqliteEnv, pgEnabled, sha256Hex } from './a20b-helpers.js';
import type { CustodyOpHost } from '../../src/index.js';

const WRITE = { mode: 'write' as const, purpose: 'request' as const, maxAttempts: 3 as const, deadlineMs: 5000 };
const READ = { mode: 'read' as const, purpose: 'request' as const, maxAttempts: 3 as const, deadlineMs: 5000 };
const DELETE_OPTS = { mode: 'write' as const, purpose: 'delete' as const, maxAttempts: 3 as const, deadlineMs: 8000 };

/** Schema-qualify a fixture table for the PostgreSQL profile. */
const q = (host: CustodyOpHost, name: string): string =>
  host.profile === 'postgres' ? `"${(host as { readonly schema: string }).schema}"."${name}"` : `"${name}"`;

const execSql = async (
  host: CustodyOpHost,
  text: string,
  values: readonly (string | number | null)[] = [],
): Promise<{ readonly rows: readonly Record<string, unknown>[]; readonly changes: number }> => {
  if (host.profile === 'postgres') {
    const session = host.raw as { execute(stmt: { text: string; values: readonly unknown[] }): Promise<{ rows: readonly Record<string, unknown>[]; rowCount: number | null }> };
    let index = 0;
    const result = await session.execute({ text: text.replace(/\?/g, () => `$${++index}`), values });
    return { rows: result.rows, changes: result.rowCount ?? 0 };
  }
  const connection = host.raw as {
    prepare(sql: string): { all(...v: unknown[]): readonly Record<string, unknown>[]; run(...v: unknown[]): { changes: number | bigint } };
  };
  if (/^\s*SELECT/i.test(text)) return { rows: connection.prepare(text).all(...values), changes: 0 };
  const result = connection.prepare(text).run(...values);
  return { rows: [], changes: Number(result.changes) };
};

const seedAccount = async (host: CustodyOpHost, userId: string): Promise<void> => {
  await host.journal.insertAccountCore({ userId, email: `${userId}@example.test`, accountStatus: 'active', globalRole: 'editor', createdAt: NOW, updatedAt: NOW });
  await host.journal.ensureLiveFence(userId, NOW);
};

const seedSession = (tx: IdentityTransactionV1<CustodyOpHost>, id: string, userId: string, workspaceId: string): Promise<void> =>
  tx.conversations.saveSession({ conversationSessionId: id, userId, workspaceId, status: 'active', openedAt: NOW, expiresAt: LATER });

const seedInvitation = (tx: IdentityTransactionV1<CustodyOpHost>, id: string, workspaceId: string | null, status: 'pending' | 'consumed' | 'revoked'): Promise<void> =>
  tx.custody.invitations.insert({
    invitationId: id, email: `${id}@example.test`, tenantId: 'org', workspaceId, clientId: null,
    tokenHash: sha256Hex(id), status, expiresAt: LATER, createdAt: NOW,
    consumedAt: status === 'consumed' ? NOW : null, consumedByUserId: status === 'consumed' ? 'marie' : null, revision: 1,
  });

const createFixtureTables = async (host: CustodyOpHost): Promise<void> => {
  await execSql(host, `CREATE TABLE IF NOT EXISTS ${q(host, 'ws_biz_rows')} (owner_id TEXT NOT NULL, workspace_id TEXT NOT NULL, PRIMARY KEY (owner_id, workspace_id))`);
  await execSql(host, `CREATE TABLE IF NOT EXISTS ${q(host, 'ws_connector_rows')} (connector_account_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, workspace_id TEXT NOT NULL, provider TEXT NOT NULL, capability TEXT)`);
};

interface FixtureState {
  failAt: null | 'delete' | 'assert' | 'apply';
  authorizationRefusal: boolean;
  reachedDelete: boolean;
  reachedAssert: boolean;
  reachedApply: boolean;
}

const freshState = (): FixtureState => ({ failAt: null, authorizationRefusal: false, reachedDelete: false, reachedAssert: false, reachedApply: false });

const createBusiness = (state: FixtureState, sql: boolean): WorkspaceBusinessDeletionPortV1<CustodyOpHost> => ({
  deleteWorkspaceRows: async (workspaceId, tx) => {
    state.reachedDelete = true;
    if (state.failAt === 'delete') throw new Error('injected-business-delete');
    if (!sql) return { deletedByTable: { ws_biz_rows: 0 }, detachedByTable: {} };
    const host = tx.hostTransaction;
    const changes = (await execSql(host, `DELETE FROM ${q(host, 'ws_biz_rows')} WHERE workspace_id = ?`, [workspaceId])).changes;
    return { deletedByTable: { ws_biz_rows: changes }, detachedByTable: {} };
  },
  assertNoWorkspaceOrphans: async (workspaceId, tx) => {
    state.reachedAssert = true;
    if (state.failAt === 'assert') throw new Error('injected-business-assert');
    if (!sql) return;
    const host = tx.hostTransaction;
    const { rows } = await execSql(host, `SELECT owner_id FROM ${q(host, 'ws_biz_rows')} WHERE workspace_id = ?`, [workspaceId]);
    if (rows.length > 0) throw new IdentityCustodyErrorV1('identity_orphan_detected');
  },
});

const createAuthorization = (state: FixtureState): WorkspaceDeletionAuthorizationPortV1<CustodyOpHost> => ({
  assertAllowed: async () => {
    if (state.authorizationRefusal) throw new Error('injected-authorization');
  },
});

interface ConnectorFixtureRow {
  readonly connectorAccountId: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly provider: string;
  readonly capability: string | null;
}

interface PlaneFixture {
  readonly sql: boolean;
  readonly rows: readonly ConnectorFixtureRow[];
}

