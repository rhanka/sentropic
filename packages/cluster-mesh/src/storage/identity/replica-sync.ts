// A4 composition-gaps bundle (1.2.0), lot G5: preprod IdP replica sync on CM
// authority (design a4-cm-gaps-r2 §9). The source placement stays sole author
// for its subjects; the replica converges its copies and authors nothing for
// them. Ids, owners and counters are never rekeyed, merged or rewritten by
// sync. Whole batch is atomic: the first conflict throws and rolls back.

import { createHash } from 'node:crypto';
import type {
  IdentityReplicaExportInputV1,
  IdentityReplicaExportPortV1,
  IdentityReplicaSyncBatchV1,
  IdentityReplicaSyncCountsV1,
  IdentityReplicaSyncInputV1,
  IdentityReplicaSyncPortV1,
  IdentityReplicaSyncReceiptV1,
  IdentityReplicaSyncRowV1,
  IdentityReplicaSyncValidationV1,
  IdentityTransactionV1,
} from '../../identity-contracts/replica-sync.js';
import { canonicalBindingEmailV1 } from '../../identity-contracts/custody.js';
import { IdentityCustodyErrorV1 } from '../../identity-contracts/custody-errors.js';
import { identityTransactionHost, requireIdentityRunOptions } from './custody-transaction-guards.js';
import { boundIdentitySql } from './custody-transaction-ports.js';
import type { CustodyOpHost } from './custody-host.js';

type Entity = IdentityReplicaSyncRowV1['entity'];

const ALL_ENTITIES: readonly Entity[] = ['account', 'credential', 'oauth_consent'];

const zeroCounts = (): Record<Entity, IdentityReplicaSyncCountsV1> =>
  Object.fromEntries(ALL_ENTITIES.map((entity) => [entity, {
    inserted: 0, updated: 0, unchanged: 0, revokedApplied: 0, revokedKept: 0,
  }])) as Record<Entity, IdentityReplicaSyncCountsV1>;

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

const sha256Hex = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

const bytewise = (left: string, right: string): number =>
  Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));

const ENTITY_RANK: Record<Entity, number> = { account: 0, credential: 1, oauth_consent: 2 };

const rowKey = (row: IdentityReplicaSyncRowV1): string =>
  row.entity === 'account' ? row.record.userId : row.entity === 'credential' ? row.record.proofId : row.record.consentId;

const canonicalSort = (rows: readonly IdentityReplicaSyncRowV1[]): IdentityReplicaSyncRowV1[] =>
  [...rows].sort((left, right) =>
    ENTITY_RANK[left.entity] - ENTITY_RANK[right.entity] || bytewise(rowKey(left), rowKey(right)));

const manifestDigestOf = (rows: readonly IdentityReplicaSyncRowV1[]): string => sha256Hex(stableStringify(rows));

const snapshotDigestOf = (batch: Pick<IdentityReplicaSyncBatchV1,
  'contractVersion' | 'syncId' | 'sourcePlacement' | 'sourceSnapshotRef' | 'exportedAt' | 'rows'>): string =>
  sha256Hex(stableStringify({
    contractVersion: batch.contractVersion,
    syncId: batch.syncId,
    sourcePlacement: batch.sourcePlacement,
    sourceSnapshotRef: batch.sourceSnapshotRef,
    exportedAt: batch.exportedAt,
    rows: batch.rows,
  }));

/** Both digests recomputed and compared before any write; mismatch ⇒ invalid. */
const digestsValid = (batch: IdentityReplicaSyncBatchV1): boolean =>
  batch.contractVersion === '1.2.0'
  && typeof batch.syncId === 'string' && batch.syncId.length > 0
  && typeof batch.sourcePlacement === 'string' && batch.sourcePlacement.length > 0
  && typeof batch.sourceSnapshotRef === 'string' && batch.sourceSnapshotRef.length > 0
  && typeof batch.exportedAt === 'string' && batch.exportedAt.length > 0
  && Array.isArray(batch.rows)
  && manifestDigestOf(batch.rows) === batch.manifestDigest
  && snapshotDigestOf(batch) === batch.sourceSnapshotDigest;

interface MutableIssue {
  readonly entity: Entity;
  readonly code: 'identity_sync_conflict' | 'identity_sync_invalid';
  count: number;
  readonly references: { readonly rowIndex: number; readonly safeIdentity?: readonly string[] }[];
}

const addIssue = (
  issues: MutableIssue[],
  entity: Entity,
  code: MutableIssue['code'],
  rowIndex: number,
  safeIdentity?: readonly string[],
): void => {
  const existing = issues.find((issue) => issue.entity === entity && issue.code === code);
  const reference = safeIdentity ? { rowIndex, safeIdentity } : { rowIndex };
  if (existing) {
    existing.references.push(reference);
    existing.count += 1;
  } else {
    issues.push({ entity, code, count: 1, references: [reference] });
  }
};

/** Structural validation shared by validate() and the in-transaction gate.
    Issue references carry subject ids only — never emails or row ids. */
const structuralIssues = (batch: IdentityReplicaSyncBatchV1): MutableIssue[] => {
  const issues: MutableIssue[] = [];
  if (batch.contractVersion !== '1.2.0') {
    addIssue(issues, 'account', 'identity_sync_invalid', -1);
    return issues;
  }
  const seenKeys = new Set<string>();
  const seenEmails = new Map<string, number>();
  batch.rows.forEach((row, rowIndex) => {
    const key = `${row.entity}:${rowKey(row)}`;
    if (seenKeys.has(key)) addIssue(issues, row.entity, 'identity_sync_invalid', rowIndex);
    else seenKeys.add(key);
    try {
      switch (row.entity) {
        case 'account': {
          const { record, profile } = row;
          if (!record.userId || !record.email.includes('@') || canonicalBindingEmailV1(record.email) !== record.email) {
            throw new IdentityCustodyErrorV1('identity_sync_invalid');
          }
          if (profile.userId !== record.userId) throw new IdentityCustodyErrorV1('identity_sync_invalid');
          const prior = seenEmails.get(record.email);
          if (prior !== undefined && prior !== rowIndex) {
            addIssue(issues, 'account', 'identity_sync_conflict', rowIndex, [record.userId]);
          } else seenEmails.set(record.email, rowIndex);
          break;
        }
        case 'credential': {
          const { record } = row;
          if (!record.proofId || !record.userId || !record.credentialId || !record.publicKeyCose || !record.rpId
            || !record.createdAt || !Number.isInteger(record.counter) || record.counter < 0) {
            throw new IdentityCustodyErrorV1('identity_sync_invalid');
          }
          break;
        }
        case 'oauth_consent': {
          const { record } = row;
          if (!record.consentId || !record.tenantId || !record.userId || !record.clientId || !record.grantedAt) {
            throw new IdentityCustodyErrorV1('identity_sync_invalid');
          }
          break;
        }
      }
    } catch {
      addIssue(issues, row.entity, 'identity_sync_invalid', rowIndex);
    }
  });
  return issues;
};

// -- Locking (§9.1: operation key, then subject keys bytewise, then email keys) --

const lockKey = async (host: CustodyOpHost, kind: string, id: string): Promise<void> => {
  if (!id) throw new IdentityCustodyErrorV1('identity_sync_invalid');
  if (host.profile === 'postgres') {
    await boundIdentitySql(host).query('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [JSON.stringify([kind, id])]);
  }
};

const lockBatch = async (host: CustodyOpHost, batch: IdentityReplicaSyncBatchV1): Promise<void> => {
  await lockKey(host, 'operation', batch.syncId);
  const subjects = new Set<string>();
  const emails = new Set<string>();
  for (const row of batch.rows) {
    subjects.add(row.record.userId);
    if (row.entity === 'account') emails.add(row.record.email);
  }
  for (const userId of [...subjects].sort(bytewise)) await lockKey(host, 'subject', userId);
  for (const email of [...emails].sort(bytewise)) await lockKey(host, 'email', email);
};

const fenceRetired = async (host: CustodyOpHost, userId: string): Promise<boolean> => {
  const sql = boundIdentitySql(host);
  const [fence] = await sql.query(`SELECT retired_at FROM ${sql.table('identity_subject_fences')} WHERE user_id = ?`, [userId]);
  return fence?.retired_at != null;
};

// -- Read-only conflict detection (validate + pre-write gate) ------------------

type AnyTx = IdentityTransactionV1<unknown>;

const CREDENTIAL_MATERIAL_FIELDS = [
  'userId', 'credentialId', 'publicKeyCose', 'rpId', 'uv', 'transports', 'deviceType', 'backedUp', 'createdAt',
] as const;

const detectRow = async (
  host: CustodyOpHost,
  tx: AnyTx,
  row: IdentityReplicaSyncRowV1,
  rowIndex: number,
  batchUserIds: ReadonlySet<string>,
  issues: MutableIssue[],
): Promise<void> => {
  switch (row.entity) {
    case 'account': {
      const { record } = row;
      const existing = await host.journal.findAccountCore(record.userId);
      if (!existing) {
        if (await fenceRetired(host, record.userId)) {
          addIssue(issues, 'account', 'identity_sync_conflict', rowIndex, [record.userId]);
          return;
        }
        const holder = await tx.stores.accounts.findAccountByEmail(record.email);
        if (holder && holder.userId !== record.userId) {
          addIssue(issues, 'account', 'identity_sync_conflict', rowIndex, [record.userId, holder.userId]);
        }
        return;
      }
      if (existing.createdAt !== record.createdAt) {
        addIssue(issues, 'account', 'identity_sync_conflict', rowIndex, [record.userId]);
        return;
      }
      if (existing.email !== record.email) {
        const holder = await tx.stores.accounts.findAccountByEmail(record.email);
        if (holder && holder.userId !== record.userId) {
          addIssue(issues, 'account', 'identity_sync_conflict', rowIndex, [record.userId, holder.userId]);
        }
      }
      return;
    }
    case 'credential': {
      const { record } = row;
      const byProof = await tx.custody.credentials.findById(record.proofId);
      const byCredentialId = await tx.custody.credentials.findByCredentialId(record.credentialId);
      if (byProof && byCredentialId && byProof.proofId === byCredentialId.proofId) {
        for (const field of CREDENTIAL_MATERIAL_FIELDS) {
          if (stableStringify(byProof[field]) !== stableStringify(record[field])) {
            addIssue(issues, 'credential', 'identity_sync_conflict', rowIndex, [record.userId]);
            return;
          }
        }
        return;
      }
      if (byProof || byCredentialId) {
        addIssue(issues, 'credential', 'identity_sync_conflict', rowIndex, [record.userId]);
        return;
      }
      if (!batchUserIds.has(record.userId) && !(await host.journal.findAccountCore(record.userId))) {
        addIssue(issues, 'credential', 'identity_sync_conflict', rowIndex, [record.userId]);
      }
      return;
    }
    case 'oauth_consent': {
      const { record } = row;
      const existing = await host.journal.findConsentCore(record.consentId);
      if (!existing) {
        if (!(await host.journal.findTenantCore(record.tenantId))) {
          addIssue(issues, 'oauth_consent', 'identity_sync_conflict', rowIndex, [record.userId]);
        }
        return;
      }
      if (existing.tenantId !== record.tenantId || existing.userId !== record.userId
        || existing.clientId !== record.clientId || existing.grantedAt !== record.grantedAt) {
        addIssue(issues, 'oauth_consent', 'identity_sync_conflict', rowIndex, [record.userId]);
      }
      return;
    }
  }
};

