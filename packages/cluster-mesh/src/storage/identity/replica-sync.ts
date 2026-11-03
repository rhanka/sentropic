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

// -- Apply (write path; runs only after detectRow reported no conflict) --------

type Outcome = 'inserted' | 'updated' | 'unchanged' | 'revokedApplied' | 'revokedKept';

const applyAccount = async (host: CustodyOpHost, tx: AnyTx, row: Extract<IdentityReplicaSyncRowV1, { entity: 'account' }>): Promise<Outcome> => {
  const { record, profile } = row;
  const existing = await host.journal.findAccountCore(record.userId);
  if (!existing) {
    await host.journal.insertAccountCore(record);
    await host.journal.ensureLiveFence(record.userId, record.createdAt);
    await tx.custody.profiles.put(profile);
    return 'inserted';
  }
  let changed = false;
  let current = existing;
  if (current.email !== record.email) {
    current = await tx.custody.subjects.updateEmail(record.userId, record.email, record.updatedAt);
    changed = true;
  }
  if (current.globalRole !== record.globalRole) {
    current = await tx.stores.accounts.setGlobalRole(record.userId, record.globalRole, record.updatedAt);
    changed = true;
  }
  if (current.accountStatus !== record.accountStatus) {
    current = await tx.stores.accounts.setAccountStatus(record.userId, record.accountStatus, record.updatedAt);
    changed = true;
  }
  if (current.updatedAt !== record.updatedAt) {
    const sql = boundIdentitySql(host);
    await sql.query(`UPDATE ${sql.table('identity_user_accounts')} SET updated_at = ? WHERE user_id = ?`, [record.updatedAt, record.userId]);
    changed = true;
  }
  const localProfile = await tx.custody.profiles.find(record.userId);
  if (!localProfile || stableStringify(localProfile) !== stableStringify(profile)) {
    await tx.custody.profiles.put(profile);
    changed = true;
  }
  return changed ? 'updated' : 'unchanged';
};

const applyCredential = async (tx: AnyTx, row: Extract<IdentityReplicaSyncRowV1, { entity: 'credential' }>): Promise<Outcome> => {
  const { record } = row;
  const existing = await tx.custody.credentials.findById(record.proofId);
  if (!existing) {
    await tx.custody.credentials.insert({ ...record, revision: 0, lastUsedAt: null, revokedAt: null });
    if (record.revokedAt) {
      await tx.custody.credentials.revoke(record.proofId, record.userId, record.revokedAt);
      return 'revokedApplied';
    }
    return 'inserted';
  }
  if (record.revokedAt && !existing.revokedAt) {
    await tx.custody.credentials.revoke(record.proofId, record.userId, record.revokedAt);
    return 'revokedApplied';
  }
  if (existing.revokedAt && !record.revokedAt) return 'revokedKept';
  if (existing.revokedAt && record.revokedAt) return 'unchanged';
  if (existing.deviceName !== record.deviceName) {
    await tx.custody.credentials.rename(record.proofId, record.userId, record.deviceName);
    return 'updated';
  }
  return 'unchanged';
};

const applyConsent = async (host: CustodyOpHost, tx: AnyTx, row: Extract<IdentityReplicaSyncRowV1, { entity: 'oauth_consent' }>): Promise<Outcome> => {
  const { record } = row;
  const existing = await host.journal.findConsentCore(record.consentId);
  if (!existing) {
    await host.journal.insertConsentCore(record);
    return 'inserted';
  }
  if (record.revokedAt && !existing.revokedAt) {
    await tx.stores.oauth.revokeConsent(record.consentId, record.revokedAt);
    return 'revokedApplied';
  }
  if (existing.revokedAt && !record.revokedAt) return 'revokedKept';
  return 'unchanged';
};

const applyRow = async (host: CustodyOpHost, tx: AnyTx, row: IdentityReplicaSyncRowV1): Promise<Outcome> => {
  switch (row.entity) {
    case 'account': return applyAccount(host, tx, row);
    case 'credential': return applyCredential(tx, row);
    case 'oauth_consent': return applyConsent(host, tx, row);
  }
};

// -- In-transaction sync --------------------------------------------------------

const syncInTransaction = async <H>(
  clock: () => string,
  batch: IdentityReplicaSyncBatchV1,
  tx: IdentityTransactionV1<H>,
): Promise<IdentityReplicaSyncReceiptV1> => {
  if (tx.mode !== 'write') throw new IdentityCustodyErrorV1('identity_transaction_unbound');
  const host = identityTransactionHost(tx);
  if (!digestsValid(batch)) throw new IdentityCustodyErrorV1('identity_sync_invalid');
  if (structuralIssues(batch).length > 0) throw new IdentityCustodyErrorV1('identity_sync_invalid');
  await lockBatch(host, batch);
  const batchUserIds = new Set(batch.rows.filter((row) => row.entity === 'account').map((row) => row.record.userId));
  const counts = zeroCounts();
  for (const [rowIndex, row] of canonicalSort(batch.rows).entries()) {
    const issues: MutableIssue[] = [];
    await detectRow(host, tx, row, rowIndex, batchUserIds, issues);
    if (issues.length > 0) throw new IdentityCustodyErrorV1('identity_sync_conflict');
    counts[row.entity][await applyRow(host, tx, row)] += 1;
  }
  return {
    contractVersion: '1.2.0',
    syncId: batch.syncId,
    sourcePlacement: batch.sourcePlacement,
    sourceSnapshotDigest: batch.sourceSnapshotDigest,
    manifestDigest: batch.manifestDigest,
    appliedAt: clock(),
    counts,
    identitiesPreserved: true,
    ownersPreserved: true,
    countersPreserved: true,
  };
};

const validateBatch = async <H>(
  batch: IdentityReplicaSyncBatchV1,
  tx: IdentityTransactionV1<H>,
): Promise<IdentityReplicaSyncValidationV1> => {
  const host = identityTransactionHost(tx);
  const issues: MutableIssue[] = [];
  if (!digestsValid(batch)) {
    addIssue(issues, 'account', 'identity_sync_invalid', -1);
    return { valid: false, issues };
  }
  issues.push(...structuralIssues(batch));
  if (issues.length > 0) return { valid: false, issues };
  const batchUserIds = new Set(batch.rows.filter((row) => row.entity === 'account').map((row) => row.record.userId));
  for (const [rowIndex, row] of canonicalSort(batch.rows).entries()) {
    await detectRow(host, tx, row, rowIndex, batchUserIds, issues);
  }
  return { valid: issues.length === 0, issues };
};

// -- Factories (host-generic per §3.5: CM state only via identityTransactionHost) --

export const createIdentityReplicaSyncV1 = <H>(input: IdentityReplicaSyncInputV1<H>): IdentityReplicaSyncPortV1<H> => {
  requireIdentityRunOptions(input.syncOptions);
  requireIdentityRunOptions(input.validationOptions);
  if (input.syncOptions.mode !== 'write' || input.syncOptions.purpose !== 'import'
    || input.validationOptions.mode !== 'read' || input.validationOptions.purpose !== 'import') {
    throw new IdentityCustodyErrorV1('identity_contract_unavailable');
  }
  return {
    validate: (batch) => input.unitOfWork.run(input.validationOptions, (tx) => validateBatch(batch, tx)),
    syncBatch: (batch) => input.unitOfWork.run(input.syncOptions, (tx) => syncInTransaction(input.clock, batch, tx)),
    syncBatchInTransaction: (batch, tx) => syncInTransaction(input.clock, batch, tx),
  };
};

export const createIdentityReplicaExporterV1 = <H>(input: IdentityReplicaExportInputV1<H>): IdentityReplicaExportPortV1<H> => {
  requireIdentityRunOptions(input.exportOptions);
  if (input.exportOptions.mode !== 'read' || input.exportOptions.purpose !== 'import') {
    throw new IdentityCustodyErrorV1('identity_contract_unavailable');
  }
  return {
    exportBatch: async ({ syncId, sourcePlacement, sourceSnapshotRef }) =>
      input.unitOfWork.run(input.exportOptions, async (tx) => {
        const host = identityTransactionHost(tx);
        const rows: IdentityReplicaSyncRowV1[] = [];
        for (const account of await tx.stores.accounts.listAccounts()) {
          const profile = await tx.custody.profiles.find(account.userId);
          if (!profile) throw new IdentityCustodyErrorV1('identity_material_missing');
          rows.push({ entity: 'account', record: account, profile });
          for (const credential of await tx.custody.credentials.listForUser(account.userId)) {
            rows.push({ entity: 'credential', record: credential });
          }
          for (const consent of await host.journal.listConsentsForUserCore(account.userId)) {
            rows.push({ entity: 'oauth_consent', record: consent });
          }
        }
        const sorted = canonicalSort(rows);
        const exportedAt = input.clock();
        return {
          contractVersion: '1.2.0' as const,
          syncId,
          sourcePlacement,
          sourceSnapshotRef,
          exportedAt,
          rows: sorted,
          manifestDigest: manifestDigestOf(sorted),
          sourceSnapshotDigest: snapshotDigestOf({ contractVersion: '1.2.0', syncId, sourcePlacement, sourceSnapshotRef, exportedAt, rows: sorted }),
        };
      }),
  };
};
