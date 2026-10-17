import { CanonicalCommandError } from '@sentropic/comments';
import type {
  CanonicalChainRecord,
  CanonicalCommandStore,
  CanonicalReadSelection,
  ExpectedState,
} from '@sentropic/comments';
import type { PgInstalledContext } from '../storage/postgres/installed-contracts.js';
import { chainIdentity, validateRecordHash, validateRecordIdentity, own } from './storage-schema.js';
import { commentsRecordEffects } from './record-effects.js';
export const installedLifecycleStore = (
  context: PgInstalledContext,
): Pick<CanonicalCommandStore, 'appendLifecycleEvent' | 'appendOperationAuditEvent'> => {
  const append = async <T extends CanonicalChainRecord>(
    selection: CanonicalReadSelection,
    record: T,
    expected: ExpectedState,
  ): Promise<T> => {
    validateRecordIdentity(context.grant.scope, selection, record);
    validateRecordHash(record);
    const metadata = await context.headMetadata(chainIdentity(selection).key);
    if (
      (expected.kind === 'creation'
        ? metadata !== null || expected.aggregateVersion !== 0
        : metadata?.head !== expected.revisionHash) ||
      !('link' in record) ||
      record.link.sequence !== (metadata?.count ?? 0) + 1 ||
      record.link.previousHash !== (metadata?.head ?? null)
    )
      throw new CanonicalCommandError('cas-conflict', 'Canonical maintenance head changed');
    await context.apply(commentsRecordEffects(selection, record, metadata?.head ?? null));
    return own(record);
  };
  return Object.freeze<Pick<CanonicalCommandStore, 'appendLifecycleEvent' | 'appendOperationAuditEvent'>>({
    appendLifecycleEvent: async (scope, objectKind, objectId, record, expected) => {
      validateRecordIdentity(scope, { kind: 'lifecycle-events', objectKind, objectId }, record);
      return append({ kind: 'lifecycle-events', objectKind, objectId }, record, expected);
    },
    appendOperationAuditEvent: async (scope, subject, subjectId, record, expected) => {
      validateRecordIdentity(scope, { kind: 'operation-audit-events', subject, subjectId }, record);
      return append({ kind: 'operation-audit-events', subject, subjectId }, record, expected);
    },
  });
};
