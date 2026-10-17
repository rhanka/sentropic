import { CanonicalCommandError, isCommandCapability } from '@sentropic/comments';
import type {
  CanonicalReadSelection,
  CanonicalStoreScope,
  CanonicalPageRequest,
  CanonicalReadPage,
  CanonicalChainRecord,
} from '@sentropic/comments';
import type { PgInstalledContext } from '../storage/postgres/installed-contracts.js';
import type { CommentsServiceOptions } from './lifecycle-contracts.js';
import { authorizeComments } from './authority.js';
import { chainIdentity, decodeRecord, invalid, sameScope } from './storage-schema.js';
import { readCommentsAuthorityTargets } from './authority-projection.js';
import { commentsRecordResources } from './export-readers.js';
import { readCommentsPgRecord } from './postgres-records.js';
import { commentsPgValue } from './postgres-records.js';
import { canonicalRecordKey } from './storage-schema.js';
import type { CommandCapability, ResourceRef } from '@sentropic/comments';
import { assertCommentsReadAudience } from './read-audience.js';
export interface CommentsReadRequest {
  readonly scope: CanonicalStoreScope;
  readonly selection: CanonicalReadSelection;
  readonly page?: CanonicalPageRequest;
}
export interface CommentsTargetsRequest {
  readonly scope: CanonicalStoreScope;
  readonly selection: CanonicalReadSelection;
  readonly capability: CommandCapability;
  readonly hash?: string;
}
export const executeCommentsTargets = async (
  options: CommentsServiceOptions,
  context: PgInstalledContext,
  supplied: unknown,
): Promise<readonly ResourceRef[]> => {
  const request = supplied as CommentsTargetsRequest;
  if (!request || !sameScope(request.scope, context.grant.scope))
    throw new CanonicalCommandError('denied', 'Comments target scope is unavailable');
  if (!isCommandCapability(request.capability)) return invalid('invalid comments target capability');
  const chain = chainIdentity(request.selection).key;
  const metadata = await context.headMetadata(chain);
  if (!metadata) {
    context.replayed();
    return [];
  }
  if (request.hash && !(await commentsPgValue(context, 'record', canonicalRecordKey(chain, request.hash))))
    throw new CanonicalCommandError('not-found', 'Comments reference is unavailable');
  const targets = await readCommentsAuthorityTargets(context, request.selection, request.hash ?? metadata.head);
  await authorizeComments(options, context, request.capability, targets);
  context.replayed();
  return targets;
};
export const executeCommentsRead = async (
  options: CommentsServiceOptions,
  context: PgInstalledContext,
  supplied: unknown,
): Promise<CanonicalChainRecord | CanonicalReadPage | null> => {
  const request = supplied as CommentsReadRequest;
  if (!request || !sameScope(request.scope, context.grant.scope))
    throw new CanonicalCommandError('denied', 'Comments read scope is unavailable');
  const chain = chainIdentity(request.selection).key;
  if (!(await context.available(chain))) throw new CanonicalCommandError('denied', 'Comments content is unavailable');
  const metadata = await context.headMetadata(chain);
  if (!metadata) return null;
  const targets = await readCommentsAuthorityTargets(context, request.selection, metadata.head);
  await authorizeComments(options, context, 'read', targets);
  if (request.page) {
    const page = request.page;
    if (
      !Number.isSafeInteger(page.limit) ||
      page.limit < 1 ||
      page.limit > 100 ||
      (page.cursor !== null && typeof page.cursor !== 'string')
    )
      return invalid('invalid comments page bounds');
    const stored = await context.readPage(chain, page.limit, page.cursor, 1048576);
    const records = stored.records.map((record) => decodeRecord(record.bytes, record.hash));
    for (const record of records) {
      assertCommentsReadAudience(context.grant.principalId, record);
      const direct = await commentsRecordResources(record, (selection, hash) =>
        readCommentsPgRecord(context, selection, hash),
      );
      await authorizeComments(
        options,
        context,
        'read',
        direct.length ? direct : await readCommentsAuthorityTargets(context, request.selection, record.hash),
      );
    }
    context.replayed();
    return { outcome: stored.outcome, records, nextCursor: stored.nextCursor };
  }
  const head = await context.head(chain);
  const record = head ? decodeRecord(head.bytes, head.hash) : null;
  if (record) assertCommentsReadAudience(context.grant.principalId, record);
  context.replayed();
  return record;
};
