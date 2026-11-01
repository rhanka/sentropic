// A2.0b custody importer: id-preserving, verification-material-preserving,
// whole-batch atomic import over both durable profiles. The batch is one
// atomic unit: any mismatch rolls back the complete batch. An identical
// completed (migrationId, snapshot, manifest) triple replays the recorded
// receipt without touching live rows.

import type {
  BoundLoginSessionV1,
  DigestInvitationV1,
  EmailRegistrationTicketV1,
  IdentityCustodyImportPortV1,
  IdentityCustodyImporterInput,
  IdentityCustodyStoresV1,
  IdentityImportBatchV1,
  IdentityImportReceiptV1,
  IdentityImportRowV1,
  IdentityImportValidationV1,
  IdentityRunOptionsV1,
  IdentityTransactionV1,
  IdentityUnitOfWorkV1,
  SingleUseProofV1,
  SocialIdentityV1,
  WebAuthnCredentialV1,
} from '../../identity-contracts/custody.js';
import { canonicalBindingEmailV1 } from '../../identity-contracts/custody.js';
import { IdentityCustodyErrorV1 } from '../../identity-contracts/custody-errors.js';
import type { CustodyOpHost } from './custody-host.js';

type Entity = IdentityImportRowV1['entity'];

const ALL_ENTITIES: readonly Entity[] = [
  'account', 'credential', 'single_use_proof', 'email_ticket', 'invitation',
  'login_session', 'social_link', 'tenant', 'tenant_membership', 'workspace',
  'workspace_membership', 'oauth_consent',
];

const zeroCounts = (): Record<Entity, number> =>
  Object.fromEntries(ALL_ENTITIES.map((entity) => [entity, 0])) as Record<Entity, number>;

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

const sameRecord = (left: unknown, right: unknown): boolean => stableStringify(left) === stableStringify(right);

/**
 * Staged-covers-existing comparison: every defined staged field must be
 * present with the same value in the stored row. Storage-managed additions
 * (decoded booleans, normalized timestamps) are ignored; a dropped staged
 * field is a preservation failure. This keeps id-preserving and
 * verification-material-preserving replay working across both profiles,
 * whose drivers surface extra columns with different native types.
 */
const coversStaged = (staged: unknown, existing: unknown): boolean => {
  if (staged === undefined) return true;
  if (Array.isArray(staged)) {
    return (
      Array.isArray(existing) &&
      staged.length === existing.length &&
      staged.every((item, index) => coversStaged(item, (existing as readonly unknown[])[index]))
    );
  }
  if (typeof staged === 'object' && staged !== null) {
    if (typeof existing !== 'object' || existing === null || Array.isArray(existing)) return false;
    return Object.entries(staged as Record<string, unknown>).every(([key, value]) =>
      coversStaged(value, (existing as Record<string, unknown>)[key]),
    );
  }
  return stableStringify(staged) === stableStringify(existing);
};

interface MutableIssue {
  readonly entity: Entity;
  readonly code: 'identity_import_conflict' | 'identity_import_invalid';
  count: number;
  readonly references: { readonly rowIndex: number; readonly safeIdentity?: readonly string[] }[];
}

type Issue = MutableIssue;

const assertCanonicalEmail = (email: string): void => {
  if (email !== canonicalBindingEmailV1(email) || !email.includes('@')) {
    throw new IdentityCustodyErrorV1('identity_import_invalid');
  }
};

const naturalKey = (row: IdentityImportRowV1): string => {
  switch (row.entity) {
    case 'account': return `account:${row.record.userId}`;
    case 'credential': return `credential:${row.record.proofId}`;
    case 'single_use_proof': return `proof:${row.record.kind}:${row.record.proofId}`;
    case 'email_ticket': return `ticket:${row.record.codeProofId}`;
    case 'invitation': return `invitation:${row.record.invitationId}`;
    case 'login_session': return `session:${row.record.sessionId}`;
    case 'social_link': return `social:${row.record.proofId}`;
    case 'tenant': return `tenant:${row.record.tenantId}`;
    case 'tenant_membership': return `membership:${row.record.userId}:${row.record.tenantId}`;
    case 'workspace': return `workspace:${row.record.workspaceId}`;
    case 'workspace_membership': return `wsmember:${row.record.workspaceId}:${row.record.userId}`;
    case 'oauth_consent': return `consent:${row.record.consentId}`;
  }
};

/** Structural validation shared by validate() and the in-transaction gate. */
const structuralIssues = (batch: IdentityImportBatchV1): Issue[] => {
  const issues: Issue[] = [];
  const seen = new Map<string, { readonly index: number; readonly record: unknown }>();
  const seenEmails = new Map<string, number>();
  const seenCredentialIds = new Map<string, number>();
  const seenTokenHashes = new Map<string, number>();
  const seenSubjects = new Map<string, number>();
  const fail = (entity: Entity, code: Issue['code'], rowIndex: number, safeIdentity?: readonly string[]): void => {
    const existing = issues.find((issue) => issue.entity === entity && issue.code === code);
    const reference = safeIdentity ? { rowIndex, safeIdentity } : { rowIndex };
    if (existing) {
      existing.references.push(reference);
      existing.count += 1;
    } else {
      issues.push({ entity, code, count: 1, references: [reference] });
    }
  };
  if (batch.contractVersion !== '1.1.0') {
    fail('account', 'identity_import_invalid', -1);
    return issues;
  }
  batch.rows.forEach((row, rowIndex) => {
    const key = naturalKey(row);
    const prior = seen.get(key);
    if (prior && !sameRecord(prior.record, row)) fail(row.entity, 'identity_import_conflict', rowIndex);
    else if (!prior) seen.set(key, { index: rowIndex, record: row });
    try {
      switch (row.entity) {
        case 'account':
          assertCanonicalEmail(row.record.email);
          if (row.record.userId.length === 0) throw new IdentityCustodyErrorV1('identity_import_invalid');
          if (row.profile.userId !== row.record.userId) throw new IdentityCustodyErrorV1('identity_import_invalid');
          break;
        case 'credential':
          if (row.record.revision !== 0) throw new IdentityCustodyErrorV1('identity_import_invalid');
          break;
        case 'single_use_proof':
          if (row.record.revision < 0) throw new IdentityCustodyErrorV1('identity_import_invalid');
          break;
        case 'email_ticket':
          assertCanonicalEmail(row.record.email);
          break;
        case 'invitation':
          assertCanonicalEmail(row.record.email);
          break;
        case 'login_session':
          if (row.record.refreshTokenHash !== null && row.record.refreshTokenHash === row.record.sessionTokenHash) {
            throw new IdentityCustodyErrorV1('identity_import_invalid');
          }
          break;
        case 'social_link':
          if (row.record.provider.length === 0 || row.record.providerSubject.length === 0) {
            throw new IdentityCustodyErrorV1('identity_import_invalid');
          }
          break;
        case 'tenant':
        case 'tenant_membership':
        case 'workspace':
        case 'workspace_membership':
        case 'oauth_consent':
          break;
      }
    } catch {
      fail(row.entity, 'identity_import_invalid', rowIndex);
    }
    if (row.entity === 'account') {
      const priorIndex = seenEmails.get(row.record.email);
      if (priorIndex !== undefined && priorIndex !== rowIndex) fail('account', 'identity_import_conflict', rowIndex);
      else seenEmails.set(row.record.email, rowIndex);
    }
    if (row.entity === 'credential') {
      const priorIndex = seenCredentialIds.get(row.record.credentialId);
      if (priorIndex !== undefined) fail('credential', 'identity_import_conflict', rowIndex);
      else seenCredentialIds.set(row.record.credentialId, rowIndex);
    }
    if (row.entity === 'invitation') {
      const priorIndex = seenTokenHashes.get(row.record.tokenHash);
      if (priorIndex !== undefined) fail('invitation', 'identity_import_conflict', rowIndex);
      else seenTokenHashes.set(row.record.tokenHash, rowIndex);
    }
    if (row.entity === 'social_link') {
      const subject = `${row.record.provider}:${row.record.providerSubject}`;
      const priorIndex = seenSubjects.get(subject);
      if (priorIndex !== undefined) fail('social_link', 'identity_import_conflict', rowIndex);
      else seenSubjects.set(subject, rowIndex);
    }
  });
  return issues;
};

/** Reads the existing destination row for identical-replay recognition. */
const readExisting = async (
  host: CustodyOpHost,
  row: IdentityImportRowV1,
): Promise<unknown> => {
  switch (row.entity) {
    case 'account': {
      const account = await host.journal.findAccountCore(row.record.userId);
      if (!account) return null;
      const profile = await host.stores.profiles.find(row.record.userId);
      return { account, profile };
    }
    case 'credential': return host.stores.credentials.findById(row.record.proofId);
    case 'single_use_proof': return host.stores.singleUseProofs.find({ kind: row.record.kind, proofId: row.record.proofId });
    case 'email_ticket': return host.stores.emailTickets.findByTokenHash(row.record.tokenHash);
    case 'invitation': return host.stores.invitations.findById(row.record.invitationId);
    case 'login_session': return host.stores.sessions.findById(row.record.sessionId);
    case 'social_link': return host.stores.social.findById(row.record.proofId);
    case 'tenant': return host.journal.findTenantCore(row.record.tenantId);
    case 'tenant_membership': {
      const memberships = await host.journal.listMembershipsForUser(row.record.userId);
      return memberships.find((membership) => membership.tenantId === row.record.tenantId) ?? null;
    }
    case 'workspace': return host.journal.findWorkspaceCore(row.record.workspaceId);
    case 'workspace_membership':
      return host.journal.roleInWorkspace(row.record.workspaceId, row.record.userId);
    case 'oauth_consent':
      return host.journal.findConsentCore(row.record.consentId);
  }
};

const normalizedForCompare = (row: IdentityImportRowV1): unknown => {
  switch (row.entity) {
    case 'account': return { account: row.record, profile: row.profile };
    case 'tenant_membership':
      return { userId: row.record.userId, tenantId: row.record.tenantId, status: row.record.status, tenantRole: row.record.tenantRole };
    case 'workspace_membership':
      return row.record.role;
    default:
      return (row as { readonly record: unknown }).record;
  }
};

const insertRow = async (host: CustodyOpHost, row: IdentityImportRowV1, importedAt: string): Promise<void> => {
  switch (row.entity) {
    case 'account':
      await host.journal.insertAccountCore(row.record);
      await host.journal.ensureLiveFence(row.record.userId, importedAt);
      await host.stores.profiles.put(row.profile);
      return;
    case 'credential': {
      const owner = await host.stores.credentials.findByCredentialId(row.record.credentialId);
      if (owner && owner.proofId !== row.record.proofId) throw new IdentityCustodyErrorV1('identity_import_conflict');
      return host.stores.credentials.insert(row.record);
    }
    case 'single_use_proof': return host.stores.singleUseProofs.insert(row.record);
    case 'email_ticket': return host.stores.emailTickets.importTicket(row.record);
    case 'invitation': {
      const owner = await host.stores.invitations.findByDigest(row.record.tokenHash);
      if (owner && owner.invitationId !== row.record.invitationId) throw new IdentityCustodyErrorV1('identity_import_conflict');
      return host.stores.invitations.insert(row.record);
    }
    case 'login_session': {
      const owner = await host.stores.sessions.findBySessionTokenHash(row.record.sessionTokenHash);
      if (owner && owner.sessionId !== row.record.sessionId) throw new IdentityCustodyErrorV1('identity_import_conflict');
      await host.stores.sessions.insert(row.record);
      const status = row.record.revokedAt !== null ? 'revoked' : row.record.expiresAt <= importedAt ? 'expired' : 'active';
      await host.journal.setImportedSessionBase(row.record.sessionId, status, row.record.revokedAt);
      return;
    }
    case 'social_link': {
      const owner = await host.stores.social.findBySubject(row.record.provider, row.record.providerSubject);
      if (owner && owner.proofId !== row.record.proofId) throw new IdentityCustodyErrorV1('identity_import_conflict');
      return host.stores.social.insert(row.record);
    }
    case 'tenant': return host.journal.insertTenantCore(row.record);
    case 'tenant_membership': return host.journal.insertMembershipCore(row.record);
    case 'workspace': return host.journal.insertWorkspaceCore({ ...row.record, aliases: [...row.record.aliases] });
    case 'workspace_membership': return host.journal.insertWorkspaceMemberCore(row.record);
    case 'oauth_consent': return host.journal.insertConsentCore(row.record);
  }
};

const requireWriteTx = (tx: IdentityTransactionV1<CustodyOpHost>): CustodyOpHost => {
  if (tx.readOnly) throw new IdentityCustodyErrorV1('identity_transaction_unbound');
  return tx.hostTransaction;
};

export const createIdentityCustodyImporterV1 = (input: {
  readonly unitOfWork: IdentityUnitOfWorkV1<CustodyOpHost>;
  readonly fence: { assertExclusiveWriter(sourceSnapshotRef: string): Promise<void> };
  readonly importOptions: IdentityRunOptionsV1;
  readonly validationOptions: IdentityRunOptionsV1;
}): IdentityCustodyImportPortV1<CustodyOpHost> => {
  const validateStructure = (batch: IdentityImportBatchV1): IdentityImportValidationV1 => {
    const issues = structuralIssues(batch);
    return { valid: issues.length === 0, issues };
  };

  const importInTx = async (batch: IdentityImportBatchV1, tx: IdentityTransactionV1<CustodyOpHost>): Promise<IdentityImportReceiptV1> => {
    const host = requireWriteTx(tx);
    await input.fence.assertExclusiveWriter(batch.sourceSnapshotRef);
    const structural = validateStructure(batch);
    if (!structural.valid) throw new IdentityCustodyErrorV1('identity_import_invalid');
    const recorded = await host.journal.findImportReceipt(batch.migrationId);
    if (recorded) {
      if (recorded.sourceSnapshotDigest === batch.sourceSnapshotDigest && recorded.manifestDigest === batch.manifestDigest) {
        return recorded;
      }
      throw new IdentityCustodyErrorV1('identity_import_conflict');
    }
    const counts = zeroCounts();
    for (const row of batch.rows) {
      const existing = await readExisting(host, row);
      if (existing !== null) {
        if (!coversStaged(normalizedForCompare(row), existing)) throw new IdentityCustodyErrorV1('identity_import_conflict');
        counts[row.entity] += 1;
        continue;
      }
      await insertRow(host, row, batch.importedAt);
      const reread = await readExisting(host, row);
      if (reread === null || !coversStaged(normalizedForCompare(row), reread)) {
        throw new IdentityCustodyErrorV1('identity_import_invalid');
      }
      counts[row.entity] += 1;
    }
    const receipt: IdentityImportReceiptV1 = {
      contractVersion: '1.1.0',
      migrationId: batch.migrationId,
      sourceSnapshotRef: batch.sourceSnapshotRef,
      sourceSnapshotDigest: batch.sourceSnapshotDigest,
      manifestDigest: batch.manifestDigest,
      importedAt: batch.importedAt,
      counts,
      identitiesPreserved: true,
      verificationMaterialPreserved: true,
      lifecyclePreserved: true,
    };
    await host.journal.insertImportReceipt(batch.migrationId, batch, receipt);
    return receipt;
  };

  return {
    validate: async (batch) => input.unitOfWork.runRead(input.validationOptions, async () => validateStructure(batch)),
    importBatch: async (batch) => {
      await input.fence.assertExclusiveWriter(batch.sourceSnapshotRef);
      return input.unitOfWork.runWrite(input.importOptions, (tx) => importInTx(batch, tx));
    },
    importBatchInTransaction: (batch, tx) => importInTx(batch, tx),
  };
};
