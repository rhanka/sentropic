import { CanonicalCommandError, canonicalJson, hashRecord, sha256Hex } from '@sentropic/comments';
import type {
  CanonicalChainRecord,
  CanonicalReadSelection,
  CanonicalStoreScope,
  RecordKind,
  ResourceRef,
} from '@sentropic/comments';
export const COMMENTS_CHAIN_KINDS = Object.freeze({
  'annotation-revisions': ['annotation-revision', 'annotationId'],
  'thread-structure-revisions': ['thread-structure-revision', 'threadId'],
  'comment-revisions': ['comment-revision', 'commentId'],
  'review-events': ['review-event', 'annotationId'],
  'lifecycle-events': ['lifecycle-event', 'objectKind', 'objectId'],
  'operation-audit-events': ['operation-audit-event', 'subject', 'subjectId'],
  'prepared-submission-manifests': ['prepared-submission-manifest', 'submissionId'],
  'import-manifests': ['import-manifest', 'importId'],
  'unit-receipts': ['unit-receipt', 'unitId'],
  'batch-receipt-snapshots': ['batch-receipt-snapshot', 'batchId'],
  'conversion-reports': ['conversion-report', 'reportId'],
} as const);
export const invalid = (message: string): never => {
  throw new CanonicalCommandError('invalid-command', message);
};
export const sameScope = (a: CanonicalStoreScope, b: CanonicalStoreScope): boolean =>
  a?.tenantId === b?.tenantId && a?.workspaceId === b?.workspaceId;
export const own = <T,>(value: T): T => JSON.parse(canonicalJson(value)) as T;
export const chainIdentity = (selection: CanonicalReadSelection) => {
  const definition = COMMENTS_CHAIN_KINDS[selection?.kind];
  if (!definition) return invalid('unknown canonical selection');
  const values = definition.slice(1).map((key) => {
    const value = (selection as unknown as Record<string, unknown>)[key];
    if (typeof value !== 'string' || !value || value.length > 4096 || value.includes('\0'))
      return invalid('invalid canonical identity');
    return value;
  });
  return {
    kind: definition[0] as RecordKind,
    key: `comments-chain-v1:${sha256Hex(JSON.stringify([selection.kind, ...values]))}`,
    fields: definition.slice(1),
    values,
  };
};
export const canonicalRecordKey = (chain: string, hash: string): string =>
  JSON.stringify(['comments-record-v1', chain, hash]);
export const commentsObjectKey = (kind: string, id: string): string =>
  `comments-object-v1:${sha256Hex(JSON.stringify([kind, id]))}`;
export const commandKey = (key: string): string => JSON.stringify(['comments-command-v1', key]);
export const commentsResourceKey = (resource: ResourceRef): string =>
  JSON.stringify([resource.scope.tenantId, resource.scope.workspaceId, resource.namespace, resource.kind, resource.id]);
export const validateRecordIdentity = (
  scope: CanonicalStoreScope,
  selection: CanonicalReadSelection,
  record: CanonicalChainRecord,
): void => {
  const identity = chainIdentity(selection);
  if (
    !record ||
    record.kind !== identity.kind ||
    !sameScope(record.scope, scope) ||
    identity.fields.some(
      (field, index) => (record as unknown as Record<string, unknown>)[field] !== identity.values[index],
    )
  )
    invalid('record identity does not match its typed chain');
};
export const validateRecordHash = (record: CanonicalChainRecord): void => {
  const { kind, hash, ...envelope } = record;
  if (hashRecord(kind, envelope) !== hash) invalid('canonical record hash mismatch');
};
export const decodeRecord = (bytes: string, hash: string): CanonicalChainRecord => {
  const record = JSON.parse(bytes) as CanonicalChainRecord;
  if (record.hash !== hash) invalid('stored record envelope mismatch');
  validateRecordHash(record);
  return record;
};
export const selectionForRecord = (record: CanonicalChainRecord): CanonicalReadSelection => {
  const entry = Object.entries(COMMENTS_CHAIN_KINDS).find(([, definition]) => definition[0] === record.kind);
  if (!entry) return invalid('unknown canonical record kind');
  return Object.fromEntries([
    ['kind', entry[0]],
    ...entry[1].slice(1).map((field) => [field, (record as unknown as Record<string, unknown>)[field]]),
  ]) as CanonicalReadSelection;
};
