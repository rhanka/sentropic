import type { CanonicalChainRecord } from '@sentropic/comments';
import type { PgRegisteredProjection } from '../storage/postgres/protocol.js';
import { quotePgIdentifier } from '../storage/postgres/protocol.js';
import {
  chainIdentity,
  commentsResourceKey,
  decodeRecord,
  invalid,
  selectionForRecord,
  validateRecordIdentity,
} from './storage-schema.js';
export const commentsHeaderLinks = (record: CanonicalChainRecord): Record<string, unknown> => {
  if (record.kind === 'annotation-revision')
    return { resources: [record.primary, ...record.secondary].map((target) => commentsResourceKey(target.resource)) };
  if (record.kind === 'thread-structure-revision')
    return { resources: [commentsResourceKey(record.primary.resource)], annotationId: record.annotationId };
  if (record.kind === 'comment-revision')
    return {
      threadId: record.threadId,
      parentCommentId: record.parentCommentId,
      structureRevision: record.structureRevision,
      annotationPin: record.annotationPin,
    };
  if (record.kind === 'review-event')
    return {
      revisionHash: record.revisionHash,
      referencesEventHash: record.referencesEventHash,
      action: record.action,
      sequence: record.link.sequence,
    };
  if (record.kind === 'lifecycle-event')
    return { action: record.action, archiveKind: record.archiveKind, sequence: record.link.sequence };
  return {};
};
// Installed trusted code writes only projection rows on the kernel session.
// Queries join those rows against the captured canonical membership root.
export const prepareCommentsProjection: PgRegisteredProjection = async (effects, context) => {
  const schema = quotePgIdentifier(
    context.layout.projectionSchemas.comments ?? invalid('comments projection schema is required'),
  );
  const scope = JSON.stringify([
    context.stream.moduleId,
    context.stream.scope.tenantId,
    context.stream.scope.workspaceId,
  ]);
  for (const append of effects.appends) {
    const record = decodeRecord(append.record.bytes, append.record.hash);
    const selection = selectionForRecord(record);
    validateRecordIdentity(context.stream.scope, selection, record);
    if (chainIdentity(selection).key !== append.chainId) invalid('projection chain identity mismatch');
    const links = commentsHeaderLinks(record);
    await context.session.execute({
      text: `INSERT INTO ${schema}.comments_chains(scope_key, chain_key) VALUES($1, $2) ON CONFLICT DO NOTHING`,
      values: [scope, append.chainId],
    });
    await context.session.execute({
      text: `INSERT INTO ${schema}.comments_headers(scope_key, chain_key, hash, selection, links) VALUES($1, $2, $3, $4::jsonb, $5::jsonb) ON CONFLICT
        DO NOTHING`,
      values: [scope, append.chainId, record.hash, JSON.stringify(selection), JSON.stringify(links)],
    });
    for (const resource of new Set((links.resources as readonly string[]) ?? []))
      await context.session.execute({
        text: `INSERT INTO ${schema}.comments_resources(scope_key, resource_key, chain_key, hash) VALUES($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        values: [scope, resource, append.chainId, record.hash],
      });
  }
};
