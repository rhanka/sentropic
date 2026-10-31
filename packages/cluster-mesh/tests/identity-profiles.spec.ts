// A2.3 spec: the durable profiles of this lot's store slice. The same corpus
// runs against the in-memory double (reference oracle), the PostgreSQL
// profile (disposable schema over the kernel's InjectedPgDriver, gated on
// CM_PG_URL) and the SQLite profile (temp-file store through the kernel's
// isolated engine). Sealed digests must match the canonical digest on every
// profile, tampering must fail verification everywhere, and the fresh
// decision producer must replay over each profile's conversation store.

import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  InMemoryConversationAuthorityStore,
  InMemoryIdentityLedger,
  createConversationAuthority,
  createEscalationCollection,
  createFreshDecisionProducer,
  createInMemoryIdentityStores,
  createIdentityEnforcementPostgresStores,
  createIdentityEnforcementSqliteStores,
  escalationEntryDigest,
  identityEnforcementPgSchema,
  type ConversationAuthorityStore,
  type DecisionToolCatalog,
  type EscalationLedgerEntryDraft,
  type IdentityLedgerStore,
} from '../src/index.js';
import type { InjectedPgDriver } from '../src/storage/postgres/protocol.js';
import { openSqliteEngine } from '../src/storage/sqlite/engine.js';
import { pgEnabled, testPgDriver } from './storage/pg-driver.js';

const NOW = '2026-10-30T12:00:00.000Z';
const LATER = '2026-10-30T13:00:00.000Z';

const catalog: DecisionToolCatalog = {
  toolsForDecision: (decision) =>
    decision.workspaceRole === 'viewer' ? ['mesh.read'] : ['mesh.read', 'mesh.write'],
};

type RequestDraft = Parameters<ReturnType<typeof createEscalationCollection>['collectRequest']>[0];

const requestDraft = (overrides: Partial<RequestDraft> = {}): RequestDraft => ({
  escalationId: 'esc-profile',
  createdAt: NOW,
  actorAgent: null,
  ownerUserId: 'user-1',
  tenantId: 'tenant-1',
  workspaceId: 'ws-1',
  scopeKind: 'role',
  storeId: 'store-1',
  tool: 'withdraw',
  targetRef: 'target-1',
  operationDigest: 'op-digest-1',
  idempotencyKey: 'key-profile',
  policyRevision: 'policy-1',
  ...overrides,
});

const sealedDraft = (targetRef: string): EscalationLedgerEntryDraft => ({
  kind: 'request',
  escalationId: 'esc-profile',
  createdAt: NOW,
  actorAgent: null,
  ownerUserId: 'user-1',
  tenantId: 'tenant-1',
  workspaceId: 'ws-1',
  scopeKind: 'role',
  storeId: 'store-1',
  tool: 'withdraw',
  targetRef,
  operationDigest: 'op-digest-1',
  reservationRef: null,
  idempotencyKey: 'key-profile',
  policyRevision: 'policy-1',
  decision: null,
  state: 'collected',
  execution: null,
  cleanup: null,
});

interface Profile {
  readonly name: string;
  readonly conversations: ConversationAuthorityStore;
  readonly ledger: IdentityLedgerStore;
  /** Simulates an out-of-band edit of the first stored entry. */
  tamperFirstEntry(): Promise<void>;
  cleanup(): Promise<void>;
}

const inMemoryProfile = (): Profile => {
  const conversations = new InMemoryConversationAuthorityStore();
  const ledger = new InMemoryIdentityLedger();
  return {
    name: 'in-memory (oracle)',
    conversations,
    ledger,
    async tamperFirstEntry() {
      const entry = ledger.escalations[0];
      ledger.escalations[0] = { ...entry, targetRef: 'target-tampered' };
    },
    async cleanup() {
      /* no-op */
    },
  };
};

const postgresProfile = async (): Promise<Profile> => {
  const connection = testPgDriver();
  const driver: InjectedPgDriver = connection.driver;
  const schema = `identity_${randomBytes(4).toString('hex')}`;
  const tx = (readOnly: boolean, operation: Parameters<InjectedPgDriver['transaction']>[1]) =>
    driver.transaction({ isolation: 'serializable', readOnly, deadlineMs: 10000 }, operation);
  await tx(false, async (session) => {
    await session.execute({ text: `CREATE SCHEMA "${schema}"`, values: [] });
    for (const ddl of identityEnforcementPgSchema(schema)) {
      await session.execute({ text: ddl, values: [] });
    }
  });
  const stores = createIdentityEnforcementPostgresStores({ driver, schema });
  return {
    name: 'PostgreSQL (disposable schema)',
    conversations: stores.conversations,
    ledger: stores.ledger,
    async tamperFirstEntry() {
      await tx(false, (session) =>
        session.execute({
          text: `UPDATE "${schema}".cm_identity_escalation_entries
            SET entry_json = jsonb_set(entry_json, '{targetRef}', '"target-tampered"')
            WHERE ordinal = 1`,
          values: [],
        }),
      );
    },
    async cleanup() {
      await tx(false, (session) =>
        session.execute({ text: `DROP SCHEMA "${schema}" CASCADE`, values: [] }),
      ).catch(() => undefined);
      await connection.close();
    },
  };
};

const sqliteProfile = (): Profile => {
  const dir = mkdtempSync(join(tmpdir(), 'cm-identity-'));
  const engine = openSqliteEngine({ path: join(dir, 'identity.db'), moduleId: 'identity' });
  const stores = createIdentityEnforcementSqliteStores({ db: engine.db });
  return {
    name: 'SQLite (temp file)',
    conversations: stores.conversations,
    ledger: stores.ledger,
    async tamperFirstEntry() {
      const row = engine.db
        .prepare('SELECT entry_json FROM cm_identity_escalation_entries WHERE ordinal = 1')
        .get() as { entry_json: string };
      engine.db
        .prepare('UPDATE cm_identity_escalation_entries SET entry_json = ? WHERE ordinal = 1')
        .run(row.entry_json.replace('target-1', 'target-tampered'));
    },
    cleanup() {
      engine.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
};

const seedFrozenStores = async (stores: ReturnType<typeof createInMemoryIdentityStores>) => {
  await stores.tenants.createTenant({ tenantId: 'tenant-1', slug: 'acme', status: 'active', createdAt: NOW });
  await stores.accounts.createAccount({
    userId: 'user-1',
    email: 'user-1@example.com',
    accountStatus: 'active',
    globalRole: 'editor',
    createdAt: NOW,
    updatedAt: NOW,
  });
  await stores.workspaces.enrolWorkspace({
    workspaceId: 'ws-1',
    tenantId: 'tenant-1',
    repoIdentity: null,
    aliases: [],
    enrolledAt: NOW,
  });
  await stores.memberships.upsertMembershipRequest({
    userId: 'user-1',
    tenantId: 'tenant-1',
    status: 'approved',
    tenantRole: 'member',
    decidedBy: 'admin-1',
    decidedAt: NOW,
    updatedAt: NOW,
  });
  await stores.workspaceMembers.putWorkspaceMember({ workspaceId: 'ws-1', userId: 'user-1', role: 'editor' });
};

const runCorpusOn = async (profile: Profile): Promise<void> => {
  const authority = createConversationAuthority({
    sessions: profile.conversations,
    audit: profile.ledger,
    clock: () => NOW,
  });
  const opened = await authority.openSession(
    { conversationSessionId: 'conv-profile', userId: 'user-1', workspaceId: 'ws-1' },
    { now: NOW, ttlSeconds: 600 },
  );
  expect(opened).toMatchObject({ status: 'active', expiresAt: '2026-10-30T12:10:00.000Z' });
  await expect(authority.validateSession('conv-profile', NOW)).resolves.toMatchObject({ status: 'active' });
  const revoked = await authority.revokeSession('conv-profile', 'admin-1');
  expect(revoked).toMatchObject({ status: 'revoked' });
  await expect(authority.validateSession('conv-profile', NOW)).rejects.toMatchObject({
    name: 'ConversationSessionError',
    reason: 'revoked',
  });
  const listed = await authority.listSessionsForUser('user-1');
  expect(listed.map((session) => session.conversationSessionId)).toEqual(['conv-profile']);

  const collection = createEscalationCollection({ ledger: profile.ledger, clock: () => NOW });
  const first = await collection.collectRequest(requestDraft(), 'agent-1');
  expect(first.entryHash).toBe(escalationEntryDigest(sealedDraft('target-1'), null));
  const decided = await collection.decide('esc-profile', {
    approve: true,
    byUserId: 'owner-1',
    at: LATER,
  });
  expect(decided.prevEntryHash).toBe(first.entryHash);
  expect(decided).toMatchObject({ kind: 'decision', state: 'approved_unexecutable' });
  const chain = await profile.ledger.listEscalationChain('esc-profile');
  expect(chain).toHaveLength(2);
  expect(await profile.ledger.verifyEscalationChains()).toEqual([
    { escalationId: 'esc-profile', verified: true },
  ]);
};

const replayDecisionOn = async (profile: Profile): Promise<void> => {
  const stores = createInMemoryIdentityStores();
  await seedFrozenStores(stores);
  const authority = createConversationAuthority({
    sessions: profile.conversations,
    audit: profile.ledger,
    clock: () => NOW,
  });
  const producer = createFreshDecisionProducer({
    accounts: stores.accounts,
    sessions: stores.sessions,
    tenants: stores.tenants,
    memberships: stores.memberships,
    workspaces: stores.workspaces,
    workspaceMembers: stores.workspaceMembers,
    conversations: profile.conversations,
    catalog,
  });
  await authority.openSession(
    { conversationSessionId: 'conv-profile', userId: 'user-1', workspaceId: 'ws-1' },
    { now: NOW, ttlSeconds: 600 },
  );
  const allowed = await producer.decide(
    { inputKind: 'conversation_turn', userId: 'user-1', workspaceId: 'ws-1', conversationSessionId: 'conv-profile' },
    NOW,
  );
  expect(allowed.decision).toEqual({
    allow: true,
    sessionAuthority: 'conversation_session',
    tenantId: 'tenant-1',
    tid: 'acme',
    tenantRole: 'member',
    workspaceRole: 'editor',
    scopes: ['editor', 'tenant:member', 'workspace:editor'],
  });
  expect(allowed.allowedTools).toEqual(['mesh.read', 'mesh.write']);
  await authority.revokeSession('conv-profile', 'admin-1');
  const refused = await producer.decide(
    { inputKind: 'conversation_turn', userId: 'user-1', workspaceId: 'ws-1', conversationSessionId: 'conv-profile' },
    NOW,
  );
  expect(refused.decision).toEqual({
    allow: false,
    sessionAuthority: 'conversation_session',
    reason: 'session_invalid',
  });
  expect(refused.allowedTools).toEqual([]);
};

const describeProfile = (
  name: string,
  factory: () => Profile | Promise<Profile>,
  // The describe factory must stay side-effect free: vitest collects skipped
  // suites too, so the durable factories (which connect) run only inside `it`.
  suite: typeof describe = describe,
): void => {
  suite(`${name} profile`, () => {
    it('should pass the shared corpus against the reference behavior', async () => {
      const profile = await factory();
      try {
        await runCorpusOn(profile);
      } finally {
        await profile.cleanup();
      }
    });

    it('should detect a tampered chain entry', async () => {
      const profile = await factory();
      try {
        await profile.ledger.appendEscalationEntry(sealedDraft('target-1'));
        expect(await profile.ledger.verifyEscalationChains()).toEqual([
          { escalationId: 'esc-profile', verified: true },
        ]);
        await profile.tamperFirstEntry();
        expect(await profile.ledger.verifyEscalationChains()).toEqual([
          { escalationId: 'esc-profile', verified: false, reason: 'hash_mismatch' },
        ]);
      } finally {
        await profile.cleanup();
      }
    });

    it('should replay decisions through the fresh decision producer', async () => {
      const profile = await factory();
      try {
        await replayDecisionOn(profile);
      } finally {
        await profile.cleanup();
      }
    });
  });
};

describeProfile('in-memory', inMemoryProfile);
describeProfile('SQLite', sqliteProfile);
describeProfile('PostgreSQL', postgresProfile, describe.skipIf(!pgEnabled));
