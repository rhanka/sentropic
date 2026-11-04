// Lot G5 (P6 replica sync, CM half): export -> sync round trip, replay
// idempotency, convergence, collision, credential/consent rules, retired
// fences, digest tampering and the foreign-host fixture, on both profiles
// plus cross-profile export -> sync (design a4-cm-gaps-r2 §9.5 CM part).

import { describe, expect, it } from 'vitest';
import type {
  IdentityReplicaSyncBatchV1,
  IdentityReplicaSyncRowV1,
  IdentityUnitOfWorkV1,
  WebAuthnCredentialV1,
} from '../../src/index.js';
import {
  createIdentityReplicaExporterV1,
  createIdentityReplicaSyncV1,
  IdentityCustodyErrorV1,
} from '../../src/index.js';
import type { OAuthConsentRecord, UserAccount, IdentityAccountProfileV1 } from '../../src/index.js';
import {
  asOpHost, LATER, NOW, openPostgresEnv, openSqliteEnv, pgEnabled,
  randomBase64Url, sha256Hex, syntheticCoseKey,
} from './a20b-helpers.js';
import type { CustodyOpHost } from '../../src/index.js';

const WRITE = { mode: 'write' as const, purpose: 'request' as const, maxAttempts: 3 as const, deadlineMs: 5000 };
const SYNC = { mode: 'write' as const, purpose: 'import' as const, maxAttempts: 3 as const, deadlineMs: 8000 };
const READ = { mode: 'read' as const, purpose: 'import' as const, maxAttempts: 3 as const, deadlineMs: 5000 };

type Uow = IdentityUnitOfWorkV1<CustodyOpHost>;

const account = (userId: string, email: string, over: Partial<UserAccount> = {}): UserAccount => ({
  userId, email, accountStatus: 'active', globalRole: 'user', createdAt: NOW, updatedAt: NOW, ...over,
});

const profile = (userId: string, over: Partial<IdentityAccountProfileV1> = {}): IdentityAccountProfileV1 => ({
  userId, emailVerified: true, displayName: `Name ${userId}`, approvalDueAt: null, approvedAt: NOW,
  approvedByUserId: 'admin', disabledAt: null, disabledReason: null, legacyAccountStatus: 'enabled', ...over,
});

const credential = (proofId: string, userId: string, over: Partial<WebAuthnCredentialV1> = {}): WebAuthnCredentialV1 => ({
  proofId, userId, credentialId: randomBase64Url(32), publicKeyCose: syntheticCoseKey(proofId), counter: 7, revision: 0,
  rpId: 'idp.example.test', deviceName: 'key', transports: ['usb'], uv: true, deviceType: 'phone', backedUp: false,
  createdAt: NOW, lastUsedAt: null, revokedAt: null, ...over,
});

const consent = (consentId: string, userId: string, tenantId: string, over: Partial<OAuthConsentRecord> = {}): OAuthConsentRecord => ({
  consentId, tenantId, userId, clientId: 'client-1', grantedAt: NOW, ...over,
});

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, field]) => field !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, field]) => `${JSON.stringify(key)}:${stableStringify(field)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};

const bytewise = (left: string, right: string): number => Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));

const ENTITY_RANK: Record<IdentityReplicaSyncRowV1['entity'], number> = { account: 0, credential: 1, oauth_consent: 2 };
const rowKey = (row: IdentityReplicaSyncRowV1): string =>
  row.entity === 'account' ? row.record.userId : row.entity === 'credential' ? row.record.proofId : row.record.consentId;

const sortRows = (rows: readonly IdentityReplicaSyncRowV1[]): IdentityReplicaSyncRowV1[] =>
  [...rows].sort((left, right) =>
    ENTITY_RANK[left.entity] - ENTITY_RANK[right.entity] || bytewise(rowKey(left), rowKey(right)));

const manifestDigestOf = (rows: readonly IdentityReplicaSyncRowV1[]): string => sha256Hex(stableStringify(rows));

const snapshotDigestOf = (batch: Omit<IdentityReplicaSyncBatchV1, 'sourceSnapshotDigest' | 'manifestDigest'>): string =>
  sha256Hex(stableStringify({
    contractVersion: batch.contractVersion, syncId: batch.syncId, sourcePlacement: batch.sourcePlacement,
    sourceSnapshotRef: batch.sourceSnapshotRef, exportedAt: batch.exportedAt, rows: batch.rows,
  }));

const makeBatch = (
  rows: readonly IdentityReplicaSyncRowV1[],
  over: Partial<IdentityReplicaSyncBatchV1> = {},
): IdentityReplicaSyncBatchV1 => {
  const sorted = sortRows(rows);
  const base = {
    contractVersion: '1.2.0' as const, syncId: 'sync-1', sourcePlacement: 'prod',
    sourceSnapshotRef: 'relay/snap-1', exportedAt: NOW, rows: sorted, ...over,
  };
  return { ...base, manifestDigest: manifestDigestOf(base.rows), sourceSnapshotDigest: snapshotDigestOf(base) };
};

const accountRow = (record: UserAccount, prof: IdentityAccountProfileV1): IdentityReplicaSyncRowV1 =>
  ({ entity: 'account', record, profile: prof });
const credentialRow = (record: WebAuthnCredentialV1): IdentityReplicaSyncRowV1 => ({ entity: 'credential', record });
const consentRow = (record: OAuthConsentRecord): IdentityReplicaSyncRowV1 => ({ entity: 'oauth_consent', record });

/** Seed one source placement: account + fence + profile (+ tenant/credential/consent rows). */
const seedAccount = async (
  uow: Uow,
  input: {
    readonly record: UserAccount;
    readonly profile?: IdentityAccountProfileV1;
    readonly tenantId?: string;
    readonly credentials?: readonly WebAuthnCredentialV1[];
    readonly consents?: readonly OAuthConsentRecord[];
  },
): Promise<void> => {
  await uow.run(WRITE, async (tx) => {
    const host = tx.hostTransaction;
    await host.journal.insertAccountCore(input.record);
    await host.journal.ensureLiveFence(input.record.userId, input.record.createdAt);
    await tx.custody.profiles.put(input.profile ?? profile(input.record.userId));
    if (input.tenantId) await host.journal.insertTenantCore({ tenantId: input.tenantId, slug: input.tenantId, status: 'active', createdAt: NOW });
    for (const cred of input.credentials ?? []) await tx.custody.credentials.insert(cred);
    for (const con of input.consents ?? []) await host.journal.insertConsentCore(con);
  });
};

interface ReplicaState {
  readonly accounts: readonly UserAccount[];
  readonly profiles: Readonly<Record<string, IdentityAccountProfileV1 | null>>;
  readonly credentials: Readonly<Record<string, readonly WebAuthnCredentialV1[]>>;
  readonly consents: Readonly<Record<string, readonly OAuthConsentRecord[]>>;
}

const readState = async (uow: Uow, userIds: readonly string[]): Promise<ReplicaState> =>
  uow.run(READ, async (tx) => {
    const accounts = await tx.stores.accounts.listAccounts();
    const profiles: Record<string, IdentityAccountProfileV1 | null> = {};
    const credentials: Record<string, readonly WebAuthnCredentialV1[]> = {};
    const consents: Record<string, readonly OAuthConsentRecord[]> = {};
    for (const userId of userIds) {
      profiles[userId] = await tx.custody.profiles.find(userId);
      credentials[userId] = await tx.custody.credentials.listForUser(userId);
      consents[userId] = await tx.hostTransaction.journal.listConsentsForUserCore(userId);
    }
    return { accounts, profiles, credentials, consents };
  });

const PROFILES = (pgEnabled ? ['postgres', 'sqlite'] : ['sqlite']) as const;

describe.each(PROFILES.map((profileName) => ({ profileName })))('G5 replica sync on $profileName', ({ profileName }) => {
  const openEnv = async (): Promise<{ uow: Uow }> => {
    const env = profileName === 'postgres' ? await openPostgresEnv() : openSqliteEnv();
    return { uow: asOpHost(env.unitOfWork) };
  };

  it('export -> sync round trip lands byte-identical rows and exact counts; replay is a no-op', async () => {
    const source = await openEnv();
    const replica = await openEnv();
    const cred = credential('cred-1', 'u-1');
    const con = consent('consent-1', 'u-1', 't-1');
    await seedAccount(source.uow, {
      record: account('u-1', 'one@example.test'), tenantId: 't-1', credentials: [cred], consents: [con],
    });
    await seedAccount(source.uow, { record: account('u-2', 'two@example.test', { globalRole: 'editor', updatedAt: LATER }) });
    // Tenants stay placement-local (closed entity union): align the registry
    // operationally, as the design requires, before consent sync.
    await replica.uow.run(WRITE, async (tx) => {
      await tx.hostTransaction.journal.insertTenantCore({ tenantId: 't-1', slug: 't-1', status: 'active', createdAt: NOW });
    });

    const exporter = createIdentityReplicaExporterV1({ unitOfWork: source.uow, clock: () => NOW, exportOptions: READ });
    const batch = await exporter.exportBatch({ syncId: 'sync-rt', sourcePlacement: 'prod', sourceSnapshotRef: 'relay/rt' });
    expect(batch.rows.map((row) => row.entity)).toEqual(['account', 'account', 'credential', 'oauth_consent']);

    const sync = createIdentityReplicaSyncV1({ unitOfWork: replica.uow, clock: () => LATER, syncOptions: SYNC, validationOptions: READ });
    const receipt = await sync.syncBatch(batch);
    expect(receipt.counts.account).toEqual({ inserted: 2, updated: 0, unchanged: 0, revokedApplied: 0, revokedKept: 0 });
    expect(receipt.counts.credential).toEqual({ inserted: 1, updated: 0, unchanged: 0, revokedApplied: 0, revokedKept: 0 });
    expect(receipt.counts.oauth_consent).toEqual({ inserted: 1, updated: 0, unchanged: 0, revokedApplied: 0, revokedKept: 0 });
    expect(receipt.identitiesPreserved).toBe(true);
    expect(receipt.ownersPreserved).toBe(true);
    expect(receipt.countersPreserved).toBe(true);

    const state = await readState(replica.uow, ['u-1', 'u-2']);
    expect(state.accounts).toEqual([
      account('u-1', 'one@example.test'),
      account('u-2', 'two@example.test', { globalRole: 'editor', updatedAt: LATER }),
    ]);
    expect(state.profiles['u-1']).toEqual(profile('u-1'));
    expect(state.credentials['u-1']).toEqual([{ ...cred, revision: 0 }]);
    expect(state.consents['u-1']).toEqual([con]);

    const replay = await sync.syncBatch(batch);
    expect(replay.counts.account).toEqual({ inserted: 0, updated: 0, unchanged: 2, revokedApplied: 0, revokedKept: 0 });
    expect(replay.counts.credential).toEqual({ inserted: 0, updated: 0, unchanged: 1, revokedApplied: 0, revokedKept: 0 });
    expect(replay.counts.oauth_consent).toEqual({ inserted: 0, updated: 0, unchanged: 1, revokedApplied: 0, revokedKept: 0 });
  });

  it('converges email, role, status and profile with the source updatedAt', async () => {
    const source = await openEnv();
    const replica = await openEnv();
    await seedAccount(source.uow, { record: account('u-1', 'new@example.test', { globalRole: 'admin_org', accountStatus: 'disabled', updatedAt: LATER }) });
    await seedAccount(replica.uow, { record: account('u-1', 'old@example.test') });
    await replica.uow.run(WRITE, async (tx) => {
      await tx.custody.profiles.put(profile('u-1', { displayName: 'Stale' }));
    });

    const exporter = createIdentityReplicaExporterV1({ unitOfWork: source.uow, clock: () => NOW, exportOptions: READ });
    const batch = await exporter.exportBatch({ syncId: 'sync-conv', sourcePlacement: 'prod', sourceSnapshotRef: 'relay/conv' });
    const sync = createIdentityReplicaSyncV1({ unitOfWork: replica.uow, clock: () => NOW, syncOptions: SYNC, validationOptions: READ });
    const receipt = await sync.syncBatch(batch);
    expect(receipt.counts.account).toEqual({ inserted: 0, updated: 1, unchanged: 0, revokedApplied: 0, revokedKept: 0 });

    const state = await readState(replica.uow, ['u-1']);
    expect(state.accounts).toEqual([account('u-1', 'new@example.test', { globalRole: 'admin_org', accountStatus: 'disabled', updatedAt: LATER })]);
    expect(state.profiles['u-1']).toEqual(profile('u-1'));
  });

  it('createdAt mismatch rolls back the whole batch', async () => {
    const source = await openEnv();
    const replica = await openEnv();
    await seedAccount(source.uow, { record: account('u-1', 'one@example.test') });
    await seedAccount(source.uow, { record: account('u-2', 'two@example.test') });
    await seedAccount(replica.uow, { record: account('u-1', 'one@example.test', { createdAt: '2026-10-01T00:00:00.000Z' }) });

    const exporter = createIdentityReplicaExporterV1({ unitOfWork: source.uow, clock: () => NOW, exportOptions: READ });
    const batch = await exporter.exportBatch({ syncId: 'sync-created', sourcePlacement: 'prod', sourceSnapshotRef: 'relay/c' });
    const sync = createIdentityReplicaSyncV1({ unitOfWork: replica.uow, clock: () => NOW, syncOptions: SYNC, validationOptions: READ });
    await expect(sync.syncBatch(batch)).rejects.toMatchObject({ code: 'identity_sync_conflict' });

    const state = await readState(replica.uow, ['u-1', 'u-2']);
    expect(state.accounts.map((row) => row.userId)).toEqual(['u-1']);
    expect(state.accounts[0].createdAt).toBe('2026-10-01T00:00:00.000Z');
  });

  it('email collision under a different local id conflicts, rolls back and leaks no email in issues', async () => {
    const source = await openEnv();
    const replica = await openEnv();
    await seedAccount(source.uow, { record: account('u-src', 'shared@example.test') });
    await seedAccount(source.uow, { record: account('u-other', 'other@example.test') });
    await seedAccount(replica.uow, { record: account('u-local', 'shared@example.test') });

    const exporter = createIdentityReplicaExporterV1({ unitOfWork: source.uow, clock: () => NOW, exportOptions: READ });
    const batch = await exporter.exportBatch({ syncId: 'sync-collide', sourcePlacement: 'prod', sourceSnapshotRef: 'relay/x' });
    const sync = createIdentityReplicaSyncV1({ unitOfWork: replica.uow, clock: () => NOW, syncOptions: SYNC, validationOptions: READ });

    const validation = await sync.validate(batch);
    expect(validation.valid).toBe(false);
    const issue = validation.issues.find((entry) => entry.code === 'identity_sync_conflict');
    expect(issue).toBeDefined();
    expect(issue?.references.flatMap((reference) => reference.safeIdentity ?? [])).toEqual(expect.arrayContaining(['u-src', 'u-local']));
    const serialized = JSON.stringify(validation);
    expect(serialized).not.toContain('shared@example.test');
    expect(serialized).not.toContain('other@example.test');

    await expect(sync.syncBatch(batch)).rejects.toMatchObject({ code: 'identity_sync_conflict' });
    const state = await readState(replica.uow, ['u-local', 'u-other']);
    expect(state.accounts.map((row) => row.userId)).toEqual(['u-local']);
  });

  it('keeps local counter/lastUsedAt and never copies a source-advanced counter', async () => {
    const source = await openEnv();
    const replica = await openEnv();
    const cred = credential('cred-1', 'u-1', { counter: 3 });
    await seedAccount(source.uow, { record: account('u-1', 'one@example.test'), credentials: [{ ...cred, counter: 30 }] });
    await seedAccount(replica.uow, { record: account('u-1', 'one@example.test'), credentials: [cred] });
    await replica.uow.run(WRITE, async (tx) => {
      await tx.custody.credentials.compareAndSwapCounter({
        proofId: 'cred-1', userId: 'u-1', expectedCounter: 3, expectedRevision: 0, newCounter: 20, at: LATER,
      });
    });

    const exporter = createIdentityReplicaExporterV1({ unitOfWork: source.uow, clock: () => NOW, exportOptions: READ });
    const batch = await exporter.exportBatch({ syncId: 'sync-counter', sourcePlacement: 'prod', sourceSnapshotRef: 'relay/ct' });
    const sync = createIdentityReplicaSyncV1({ unitOfWork: replica.uow, clock: () => NOW, syncOptions: SYNC, validationOptions: READ });
    const receipt = await sync.syncBatch(batch);
    expect(receipt.counts.credential.unchanged).toBe(1);

    const state = await readState(replica.uow, ['u-1']);
    expect(state.credentials['u-1'][0].counter).toBe(20);
    expect(state.credentials['u-1'][0].lastUsedAt).toBe(LATER);
  });

  it('credential owner or COSE drift conflicts; source-revoked applies; local-revoked is kept; rename converges', async () => {
    const source = await openEnv();
    const replica = await openEnv();
    const cred = credential('cred-1', 'u-1');
    const cred2 = credential('cred-2', 'u-1');
    await seedAccount(source.uow, {
      record: account('u-1', 'one@example.test'),
      credentials: [
        { ...cred, revokedAt: LATER },
        { ...cred2, deviceName: 'renamed' },
      ],
    });
    await seedAccount(replica.uow, {
      record: account('u-1', 'one@example.test'),
      credentials: [cred, { ...cred2, deviceName: 'old', revision: 4 }],
    });

    const exporter = createIdentityReplicaExporterV1({ unitOfWork: source.uow, clock: () => NOW, exportOptions: READ });
    const batch = await exporter.exportBatch({ syncId: 'sync-cred', sourcePlacement: 'prod', sourceSnapshotRef: 'relay/cr' });
    const sync = createIdentityReplicaSyncV1({ unitOfWork: replica.uow, clock: () => NOW, syncOptions: SYNC, validationOptions: READ });
    const receipt = await sync.syncBatch(batch);
    expect(receipt.counts.credential).toEqual({ inserted: 0, updated: 1, unchanged: 0, revokedApplied: 1, revokedKept: 0 });

    const state = await readState(replica.uow, ['u-1']);
    const byId = new Map(state.credentials['u-1'].map((row) => [row.proofId, row]));
    expect(byId.get('cred-1')?.revokedAt).toBe(LATER);
    expect(byId.get('cred-1')?.counter).toBe(7);
    expect(byId.get('cred-2')?.deviceName).toBe('renamed');
    expect(byId.get('cred-2')?.revision).toBe(5);

    // COSE drift on an existing row is a conflict with full rollback.
    const drifted = makeBatch([
      accountRow(account('u-1', 'one@example.test'), profile('u-1')),
      credentialRow({ ...cred, publicKeyCose: syntheticCoseKey('other') }),
    ]);
    await expect(sync.syncBatch(drifted)).rejects.toMatchObject({ code: 'identity_sync_conflict' });
    const after = await readState(replica.uow, ['u-1']);
    expect(after.credentials['u-1'].find((row) => row.proofId === 'cred-1')?.publicKeyCose).toBe(cred.publicKeyCose);

    // A live source row never resurrects a locally revoked credential.
    const liveSource = makeBatch([
      accountRow(account('u-1', 'one@example.test'), profile('u-1')),
      credentialRow(cred),
    ]);
    const receipt2 = await sync.syncBatch(liveSource);
    expect(receipt2.counts.credential.revokedKept).toBe(1);
    const kept = await readState(replica.uow, ['u-1']);
    expect(kept.credentials['u-1'].find((row) => row.proofId === 'cred-1')?.revokedAt).toBe(LATER);
  });

  it('consent rules: revoked local is never resurrected, unknown tenant conflicts', async () => {
    const source = await openEnv();
    const replica = await openEnv();
    const live = consent('consent-1', 'u-1', 't-1');
    await seedAccount(source.uow, { record: account('u-1', 'one@example.test'), tenantId: 't-1', consents: [live] });
    await seedAccount(replica.uow, {
      record: account('u-1', 'one@example.test'), tenantId: 't-1',
      consents: [consent('consent-1', 'u-1', 't-1', { revokedAt: LATER })],
    });

    const exporter = createIdentityReplicaExporterV1({ unitOfWork: source.uow, clock: () => NOW, exportOptions: READ });
    const batch = await exporter.exportBatch({ syncId: 'sync-consent', sourcePlacement: 'prod', sourceSnapshotRef: 'relay/cs' });
    const sync = createIdentityReplicaSyncV1({ unitOfWork: replica.uow, clock: () => NOW, syncOptions: SYNC, validationOptions: READ });
    const receipt = await sync.syncBatch(batch);
    expect(receipt.counts.oauth_consent).toEqual({ inserted: 0, updated: 0, unchanged: 0, revokedApplied: 0, revokedKept: 1 });
    const state = await readState(replica.uow, ['u-1']);
    expect(state.consents['u-1'][0].revokedAt).toBe(LATER);

    const unknownTenant = makeBatch([
      accountRow(account('u-1', 'one@example.test'), profile('u-1')),
      consentRow(consent('consent-9', 'u-1', 't-unknown')),
    ]);
    await expect(sync.syncBatch(unknownTenant)).rejects.toMatchObject({ code: 'identity_sync_conflict' });
  });

  it('retired fence on a source id conflicts; source-side deletion does not propagate', async () => {
    const source = await openEnv();
    const replica = await openEnv();
    await seedAccount(source.uow, { record: account('u-1', 'one@example.test') });
    await seedAccount(source.uow, { record: account('u-gone', 'gone@example.test') });
    await seedAccount(replica.uow, { record: account('u-gone', 'gone@example.test') });
    await replica.uow.run(WRITE, async (tx) => {
      await tx.hostTransaction.journal.ensureLiveFence('u-1', NOW);
      await tx.hostTransaction.journal.retireFence('u-1', LATER);
    });

    const exporter = createIdentityReplicaExporterV1({ unitOfWork: source.uow, clock: () => NOW, exportOptions: READ });
    const batch = await exporter.exportBatch({ syncId: 'sync-fence', sourcePlacement: 'prod', sourceSnapshotRef: 'relay/f' });
    const sync = createIdentityReplicaSyncV1({ unitOfWork: replica.uow, clock: () => NOW, syncOptions: SYNC, validationOptions: READ });
    const validation = await sync.validate(batch);
    expect(validation.valid).toBe(false);
    expect(validation.issues.some((issue) => issue.code === 'identity_sync_conflict')).toBe(true);
    await expect(sync.syncBatch(batch)).rejects.toMatchObject({ code: 'identity_sync_conflict' });

    // u-gone is absent from a second batch: the replica keeps its local row.
    const partial = makeBatch([accountRow(account('u-1', 'one@example.test'), profile('u-1'))]);
    await expect(sync.syncBatch(partial)).rejects.toMatchObject({ code: 'identity_sync_conflict' });
    const state = await readState(replica.uow, ['u-gone']);
    expect(state.accounts.map((row) => row.userId)).toEqual(['u-gone']);
  });

  it('digest tampering is rejected as invalid before any write; missing profile aborts export', async () => {
    const source = await openEnv();
    const replica = await openEnv();
    await seedAccount(source.uow, { record: account('u-1', 'one@example.test') });
    const exporter = createIdentityReplicaExporterV1({ unitOfWork: source.uow, clock: () => NOW, exportOptions: READ });
    const batch = await exporter.exportBatch({ syncId: 'sync-tamper', sourcePlacement: 'prod', sourceSnapshotRef: 'relay/t' });
    const sync = createIdentityReplicaSyncV1({ unitOfWork: replica.uow, clock: () => NOW, syncOptions: SYNC, validationOptions: READ });

    const tamperedRows = makeBatch([
      accountRow(account('u-1', 'evil@example.test'), profile('u-1')),
    ], { syncId: batch.syncId, sourceSnapshotRef: batch.sourceSnapshotRef, exportedAt: batch.exportedAt });
    const withStaleManifest = { ...tamperedRows, rows: batch.rows, manifestDigest: tamperedRows.manifestDigest };
    await expect(sync.syncBatch(withStaleManifest)).rejects.toMatchObject({ code: 'identity_sync_invalid' });
    const withStaleSnapshot = { ...batch, exportedAt: LATER };
    await expect(sync.syncBatch(withStaleSnapshot)).rejects.toMatchObject({ code: 'identity_sync_invalid' });

    const state = await readState(replica.uow, ['u-1']);
    expect(state.accounts).toEqual([]);

    // A source account without a profile aborts the export.
    await source.uow.run(WRITE, async (tx) => {
      await tx.hostTransaction.journal.insertAccountCore(account('u-noprofile', 'np@example.test'));
      await tx.hostTransaction.journal.ensureLiveFence('u-noprofile', NOW);
    });
    await expect(exporter.exportBatch({ syncId: 'sync-np', sourcePlacement: 'prod', sourceSnapshotRef: 'relay/np' }))
      .rejects.toMatchObject({ code: 'identity_material_missing' });
  });

  it('runs under a foreign host transaction (opaque sentinel) per §3.5', async () => {
    const env = profileName === 'postgres' ? await openPostgresEnv() : openSqliteEnv();
    const sentinel = { opaque: 'host-transaction' } as unknown;
    let foreignUow: Uow;
    if (profileName === 'postgres') {
      const { createPostgresIdentityHostV1, createPostgresIdentityUnitOfWorkV1 } = await import('../../src/index.js');
      const base = createPostgresIdentityHostV1({ driver: env.raw, schema: env.schema });
      const foreignHost = {
        runSerializable: (options: never, operation: (binding: never) => Promise<unknown>) =>
          base.runSerializable(options as never, (binding) => operation({ ...binding, hostTransaction: sentinel } as never)),
      };
      foreignUow = createPostgresIdentityUnitOfWorkV1({ schema: env.schema, host: foreignHost }) as unknown as Uow;
    } else {
      const { createSqliteIdentityHostV1, createSqliteIdentityUnitOfWorkV1 } = await import('../../src/index.js');
      const base = createSqliteIdentityHostV1({ connection: env.connection, applySchema: false });
      const foreignHost = {
        runExclusiveTransaction: (options: never, operation: (binding: never) => Promise<unknown>) =>
          base.runExclusiveTransaction(options as never, (binding) => operation({ ...binding, hostTransaction: sentinel } as never)),
      };
      foreignUow = createSqliteIdentityUnitOfWorkV1({ host: foreignHost }) as unknown as Uow;
    }

    const batch = makeBatch([accountRow(account('u-1', 'one@example.test'), profile('u-1'))]);
    const sync = createIdentityReplicaSyncV1({ unitOfWork: foreignUow, clock: () => NOW, syncOptions: SYNC, validationOptions: READ });
    const receipt = await sync.syncBatch(batch);
    expect(receipt.counts.account.inserted).toBe(1);
    const state = await readState(asOpHost(env.unitOfWork), ['u-1']);
    expect(state.accounts).toEqual([account('u-1', 'one@example.test')]);
  });
});

if (pgEnabled) {
  describe('G5 cross-profile export -> sync', () => {
    it('sqlite export syncs into postgres and postgres export syncs into sqlite', async () => {
      const sqliteEnv = openSqliteEnv();
      const pgEnv = await openPostgresEnv();
      const sqliteUow = asOpHost(sqliteEnv.unitOfWork);
      const pgUow = asOpHost(pgEnv.unitOfWork);
      const cred = credential('cred-x', 'u-1');
      await seedAccount(sqliteUow, {
        record: account('u-1', 'one@example.test'), tenantId: 't-1', credentials: [cred], consents: [consent('consent-x', 'u-1', 't-1')],
      });
      await seedAccount(pgUow, { record: account('u-2', 'two@example.test') });
      await pgUow.run(WRITE, async (tx) => {
        await tx.hostTransaction.journal.insertTenantCore({ tenantId: 't-1', slug: 't-1', status: 'active', createdAt: NOW });
      });

      const sqliteExporter = createIdentityReplicaExporterV1({ unitOfWork: sqliteUow, clock: () => NOW, exportOptions: READ });
      const pgExporter = createIdentityReplicaExporterV1({ unitOfWork: pgUow, clock: () => NOW, exportOptions: READ });
      const sqliteBatch = await sqliteExporter.exportBatch({ syncId: 'x-sqlite', sourcePlacement: 'prod', sourceSnapshotRef: 'relay/x1' });
      const pgBatch = await pgExporter.exportBatch({ syncId: 'x-pg', sourcePlacement: 'prod', sourceSnapshotRef: 'relay/x2' });

      const pgSync = createIdentityReplicaSyncV1({ unitOfWork: pgUow, clock: () => NOW, syncOptions: SYNC, validationOptions: READ });
      const sqliteSync = createIdentityReplicaSyncV1({ unitOfWork: sqliteUow, clock: () => NOW, syncOptions: SYNC, validationOptions: READ });
      const intoPg = await pgSync.syncBatch(sqliteBatch);
      expect(intoPg.counts.account.inserted).toBe(1);
      expect(intoPg.counts.credential.inserted).toBe(1);
      expect(intoPg.counts.oauth_consent.inserted).toBe(1);
      const intoSqlite = await sqliteSync.syncBatch(pgBatch);
      expect(intoSqlite.counts.account.inserted).toBe(1);

      const pgState = await readState(pgUow, ['u-1']);
      expect(pgState.accounts).toEqual([account('u-1', 'one@example.test'), account('u-2', 'two@example.test')]);
      expect(pgState.credentials['u-1']).toEqual([{ ...cred, revision: 0 }]);
      const sqliteState = await readState(sqliteUow, ['u-2']);
      expect(sqliteState.accounts).toEqual([account('u-1', 'one@example.test'), account('u-2', 'two@example.test')]);
    });
  });
}
