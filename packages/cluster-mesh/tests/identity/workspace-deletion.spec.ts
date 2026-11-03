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

const createPlane = (state: FixtureState, custody: ConnectorRevocationCustodyPortV1<CustodyOpHost>, fixture: PlaneFixture): WorkspaceDeletionPlanePortV1<CustodyOpHost> => ({
  placement: 'present',
  listConnectorOwners: async (command, tx) => {
    if (!fixture.sql) return [...new Set(fixture.rows.filter((row) => row.workspaceId === command.workspaceId).map((row) => row.userId))].sort();
    const host = tx.hostTransaction;
    return (await execSql(host, `SELECT DISTINCT user_id FROM ${q(host, 'ws_connector_rows')} WHERE workspace_id = ? ORDER BY user_id`, [command.workspaceId])).rows.map((row) => String(row['user_id']));
  },
  apply: async (command, tx) => {
    state.reachedApply = true;
    if (state.failAt === 'apply') throw new Error('injected-plane-apply');
    const rows: readonly ConnectorFixtureRow[] = fixture.sql
      ? (await execSql(tx.hostTransaction, `SELECT connector_account_id, user_id, workspace_id, provider, capability FROM ${q(tx.hostTransaction, 'ws_connector_rows')} WHERE workspace_id = ? ORDER BY connector_account_id`, [command.workspaceId])).rows
        .map((row) => ({ connectorAccountId: String(row['connector_account_id']), userId: String(row['user_id']), workspaceId: String(row['workspace_id']), provider: String(row['provider']), capability: row['capability'] === null ? null : String(row['capability']) }))
      : fixture.rows.filter((row) => row.workspaceId === command.workspaceId);
    const drafts: IdentityExternalRevocationDraftV1[] = [];
    for (const row of rows) {
      const deliveryId = identityDeliveryId(command.operationId, 'connector_grants', 'connector_grant', row.connectorAccountId);
      const capture = await custody.capture({ deliveryId, connectorAccountId: row.connectorAccountId, subjectId: row.userId, workspaceIdsToDelete: [command.workspaceId], at: NOW }, tx);
      drafts.push({ step: 'connector_grants', subjectId: row.userId, targetKind: 'connector_grant', targetRef: row.connectorAccountId, custodyRef: capture.kind === 'captured' ? capture.reference.custodyRef : null });
    }
    return drafts;
  },
  assertDeliveryInScope: async (command, draft, tx) => {
    if (!fixture.sql) return;
    const host = tx.hostTransaction;
    const { rows } = await execSql(host, `SELECT connector_account_id FROM ${q(host, 'ws_connector_rows')} WHERE connector_account_id = ? AND workspace_id = ?`, [draft.targetRef, command.workspaceId]);
    if (rows.length !== 1) throw new IdentityCustodyErrorV1('identity_cascade_participant_missing');
  },
  assertAbsent: async (command, tx) => {
    if (!fixture.sql) return;
    const host = tx.hostTransaction;
    const { rows } = await execSql(host, `SELECT COUNT(*) AS c FROM ${q(host, 'ws_connector_rows')} WHERE workspace_id = ?`, [command.workspaceId]);
    if (Number(rows[0]?.['c'] ?? 0) > 0) throw new IdentityCustodyErrorV1('identity_cascade_participant_missing');
  },
});

const createAbsentPlane = (sql: boolean): WorkspaceDeletionPlanePortV1<CustodyOpHost> => ({
  placement: 'absent',
  listConnectorOwners: async () => { throw new Error('absent plane discovery'); },
  apply: async () => { throw new Error('absent plane applied'); },
  assertDeliveryInScope: async () => { throw new Error('absent plane scope'); },
  assertAbsent: async (command, tx) => {
    if (!sql) return;
    const host = tx.hostTransaction;
    const { rows } = await execSql(host, `SELECT COUNT(*) AS c FROM ${q(host, 'ws_connector_rows')} WHERE workspace_id = ?`, [command.workspaceId]);
    if (Number(rows[0]?.['c'] ?? 0) > 0) throw new IdentityCustodyErrorV1('identity_cascade_participant_missing');
  },
});

const createRealCustody = (): ConnectorRevocationCustodyPortV1<CustodyOpHost> =>
  createConnectorRevocationCustodyPortV1({
    custody: createNodeConnectorCustody({ masterKey: new Uint8Array(32).fill(7) }),
    readSource: async (connectorAccountId, tx) => {
      const host = tx.hostTransaction;
      const { rows } = await execSql(host, `SELECT user_id, workspace_id, provider, capability FROM ${q(host, 'ws_connector_rows')} WHERE connector_account_id = ?`, [connectorAccountId]);
      if (rows.length === 0) return null;
      const row = rows[0];
      return {
        userId: String(row['user_id']),
        workspaceId: row['workspace_id'] === null ? null : String(row['workspace_id']),
        provider: String(row['provider']),
        capability: row['capability'] === null ? null : (JSON.parse(String(row['capability'])) as ConnectorCapabilityV1),
      };
    },
  });

/** Host-generic custody double for the foreign-host rule test. */
const createMemoryCustody = (): { readonly port: ConnectorRevocationCustodyPortV1<CustodyOpHost>; readonly captured: Map<string, string> } => {
  const captured = new Map<string, string>();
  return {
    captured,
    port: {
      capture: async (input) => {
        captured.set(input.deliveryId, input.subjectId);
        return { kind: 'captured', reference: { custodyRef: `mem-${input.deliveryId}`, deliveryId: input.deliveryId, connectorAccountId: input.connectorAccountId, provider: 'mem', createdAt: input.at } };
      },
      assertCaptured: async (record) => {
        if (captured.get(record.deliveryId) !== record.subjectId) throw new IdentityCustodyErrorV1('identity_revocation_custody_missing');
      },
      eraseAcknowledged: async (record) => { captured.delete(record.deliveryId); },
    },
  };
};

const buildOperation = (env: ProfileEnv, state: FixtureState, custody: ConnectorRevocationCustodyPortV1<CustodyOpHost>, sql: boolean): AtomicWorkspaceDeletionV1 =>
  createAtomicWorkspaceDeletionV1({
    unitOfWork: env.unitOfWork,
    business: createBusiness(state, sql),
    authorization: createAuthorization(state),
    connectorPlane: createPlane(state, custody, { sql, rows: [] }),
    connectorCustody: custody,
    clock: () => NOW,
    transactionOptions: { deletion: DELETE_OPTS },
  });

interface ProfileEnv {
  readonly unitOfWork: IdentityUnitOfWorkV1<CustodyOpHost>;
  readonly concurrent: boolean;
}

const PROFILES = (pgEnabled ? ['postgres', 'sqlite'] : ['sqlite']) as const;

const seedStandard = async (env: ProfileEnv, opts: { readonly c2Capability?: string | null } = {}): Promise<void> => {
  await env.unitOfWork.run(WRITE, async (tx) => {
    const host = tx.hostTransaction;
    await host.journal.insertTenantCore({ tenantId: 'org', slug: 'org', status: 'active', createdAt: NOW });
    for (const userId of ['marie', 'jean', 'boss', 'solo']) await seedAccount(host, userId);
    await host.journal.insertWorkspaceCore({ workspaceId: 'ws', tenantId: 'org', repoIdentity: null, aliases: [], enrolledAt: NOW });
    await host.journal.insertWorkspaceCore({ workspaceId: 'ws2', tenantId: 'org', repoIdentity: null, aliases: [], enrolledAt: NOW });
    await host.journal.insertWorkspaceMemberCore({ workspaceId: 'ws', userId: 'marie', role: 'admin' });
    await host.journal.insertWorkspaceMemberCore({ workspaceId: 'ws', userId: 'jean', role: 'viewer' });
    await host.journal.insertWorkspaceMemberCore({ workspaceId: 'ws', userId: 'boss', role: 'editor' });
    await host.journal.insertWorkspaceMemberCore({ workspaceId: 'ws2', userId: 'marie', role: 'viewer' });
    await createFixtureTables(host);
    await execSql(host, `INSERT INTO ${q(host, 'ws_biz_rows')} (owner_id, workspace_id) VALUES (?, ?), (?, ?), (?, ?)`, ['marie', 'ws', 'boss', 'ws', 'marie', 'ws2']);
    await execSql(host, `INSERT INTO ${q(host, 'ws_connector_rows')} (connector_account_id, user_id, workspace_id, provider, capability) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)`,
      ['c1', 'boss', 'ws', 'drive', JSON.stringify({ tokenKind: 'access', token: 'tok-c1' }),
        'c2', 'marie', 'ws', 'slack', opts.c2Capability === undefined ? JSON.stringify({ tokenKind: 'refresh', token: 'tok-c2' }) : opts.c2Capability,
        'c3', 'boss', 'ws2', 'drive', JSON.stringify({ tokenKind: 'access', token: 'tok-c3' })]);
    await seedSession(tx, 's1', 'marie', 'ws');
    await seedSession(tx, 's2', 'jean', 'ws');
    await seedSession(tx, 's3', 'marie', 'ws2');
    await seedInvitation(tx, 'inv-pending', 'ws', 'pending');
    await seedInvitation(tx, 'inv-consumed', 'ws', 'consumed');
    await seedInvitation(tx, 'inv-revoked', 'ws', 'revoked');
    await seedInvitation(tx, 'inv-other', 'ws2', 'pending');
  });
};

const expectNoMutation = async (env: ProfileEnv, operationId: string): Promise<void> => {
  await env.unitOfWork.run(READ, async (tx) => {
    const host = tx.hostTransaction;
    expect(await host.journal.findWorkspaceCore('ws')).not.toBeNull();
    expect((await execSql(host, `SELECT * FROM ${q(host, 'cm_workspace_members')} WHERE workspace_id = ?`, ['ws'])).rows).toHaveLength(3);
    expect((await execSql(host, `SELECT * FROM ${q(host, 'cm_identity_conversation_sessions')} WHERE workspace_id = ?`, ['ws'])).rows).toHaveLength(2);
    expect((await execSql(host, `SELECT * FROM ${q(host, 'ws_biz_rows')} WHERE workspace_id = ?`, ['ws'])).rows).toHaveLength(2);
    expect((await execSql(host, `SELECT * FROM ${q(host, 'ws_connector_rows')} WHERE workspace_id = ?`, ['ws'])).rows).toHaveLength(2);
    expect(await tx.revocationOutbox.listPending(operationId)).toHaveLength(0);
    expect((await execSql(host, `SELECT * FROM ${q(host, 'cm_identity_audit_events')} WHERE kind = ?`, ['workspace_deletion'])).rows).toHaveLength(0);
  });
};
