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
