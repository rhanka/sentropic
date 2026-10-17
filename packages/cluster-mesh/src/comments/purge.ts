import { CanonicalCommandError } from '@sentropic/comments';
import type { PgPurgeFinalizer, PgInstalledContext } from '../storage/postgres/installed-contracts.js';
import type { RootPurgeJob } from '../storage/staged-state.js';
import type { CommentsServiceOptions, CommentsLifecycleControl } from './lifecycle-contracts.js';
import { purgeControlKey } from './lifecycle-contracts.js';
import { authorizeComments } from './authority.js';
import { installedLifecycleStore } from './installed-store.js';
import { writeLifecycleControl } from './lifecycle-io.js';
import { commentsObjectKey, invalid } from './storage-schema.js';
const read = async (context: PgInstalledContext, job: RootPurgeJob) => {
  const index = await context.index(purgeControlKey(job.intentId));
  const stored = index ? await context.aggregate(index.resultIds[0]!) : null;
  if (!index || !stored) return invalid('purge lacks its canonical intent binding');
  const value = JSON.parse(stored.value.data) as CommentsLifecycleControl;
  if (value.intentId !== job.intentId || !value.tombstoned) return invalid('purge control binding differs');
  return { index, version: stored.version, value };
};
export const authorizeCommentsPurge =
  (options: CommentsServiceOptions): PgPurgeFinalizer =>
  async (job, context) => {
    const { value } = await read(context, job);
    await authorizeComments(options, context, 'purge', value.targets);
    if (value.candidate && value.candidate.actor.principal !== context.grant.principalId)
      throw new CanonicalCommandError('denied', 'Purge maintenance principal differs');
  };
export const finalizeCommentsPurge =
  (options: CommentsServiceOptions): PgPurgeFinalizer =>
  async (job, context) => {
    if (job.state !== 'complete' || job.payloadDisposition !== 'erased')
      return invalid('canonical completion requires verified erasure');
    const { index, version, value } = await read(context, job);
    const record = value.candidate;
    if (
      !record ||
      record.kind !== 'lifecycle-event' ||
      record.action !== 'purge-outcome' ||
      record.reason !== null ||
      record.hash !== index.resultHash ||
      commentsObjectKey(record.objectKind, record.objectId) !== job.target ||
      record.actor.principal !== context.grant.principalId
    )
      return invalid('invalid canonical completion candidate');
    await authorizeComments(options, context, 'purge', value.targets);
    await installedLifecycleStore(context).appendLifecycleEvent(
      context.grant.scope,
      record.objectKind,
      record.objectId,
      record,
      { kind: 'revision', revisionHash: record.link.previousHash! },
    );
    const { candidate: _candidate, ...control } = value;
    await writeLifecycleControl(context, job.target, version, { ...control, outcomeHash: record.hash });
  };
