import type { ReviewEventRecord } from '@sentropic/comments';
import type { PgProjectionContext } from '../storage/postgres/protocol.js';
import { quotePgIdentifier } from '../storage/postgres/protocol.js';
import { pgMapKey } from '../storage/postgres/roots.js';
import { decodePgText } from '../storage/postgres/codec.js';
import { commentsControlAddress } from './import-control.js';
import { chainIdentity } from './storage-schema.js';
import { readCommentsPgRecord } from './postgres-records.js';
import { CommentsTransportError } from './transport-contracts.js';
// At most six actual records summarize the frozen constructor's current
// revision state, open-contest existence and exact referenced-event status.
export const retainedCommentsReviewBasis = async (
  context: PgProjectionContext,
  record: ReviewEventRecord,
  previous: ReviewEventRecord | null,
): Promise<readonly ReviewEventRecord[]> => {
  const { schema, scope } = commentsControlAddress(context);
  const data = quotePgIdentifier(context.layout.dataSchema);
  const selection = { kind: 'review-events' as const, annotationId: record.annotationId };
  const chain = chainIdentity(selection).key;
  const memberKey = pgMapKey('chain-record', JSON.stringify([chain, '__SEQ__']));
  const member = (alias: string) =>
    `convert_from(${data}.map_get($3::bigint,
      replace($4,'__SEQ__',lpad(((${alias}.links->>'sequence')::bigint-1)::text,16,'0'))),
      'UTF8')::jsonb->>'hash'=${alias}.hash`;
  const filter = `h.scope_key=$1 AND h.chain_key=$2 AND h.selection->>'kind'='review-events'
    AND h.links->>'revisionHash'=$5 AND (h.links->>'sequence')::bigint<$6::bigint AND ${member('h')}`;
  const values = [scope, chain, context.root, memberKey, record.revisionHash, record.link.sequence];
  const basis = new Map<string, ReviewEventRecord>();
  if (previous) basis.set(previous.hash, previous);
  const add = async (hash: string) => {
    const found = await readCommentsPgRecord(context, selection, hash);
    if (found?.kind !== 'review-event')
      throw new CommentsTransportError('incomplete', 'Required actual review evidence is unavailable');
    basis.set(found.hash, found);
  };
  const find = async (predicate: string, order = 'DESC', reference?: string) => {
    const result = await context.session.execute({
      text: `SELECT h.hash FROM ${schema}.comments_headers h WHERE ${filter} AND (${predicate})
        ORDER BY (h.links->>'sequence')::bigint ${order}, h.hash COLLATE "C" LIMIT
        1`,
      values: reference === undefined ? values : [...values, reference],
    });
    if (result.rows[0]) await add(decodePgText(result.rows[0].hash));
  };
  await find('true');
  await find(
    `h.links->>'action'='contest' AND NOT EXISTS(SELECT 1 FROM ${schema}.comments_headers r
      WHERE r.scope_key=h.scope_key AND r.chain_key=h.chain_key AND r.selection->>'kind'='review-events'
      AND r.links->>'revisionHash'=h.links->>'revisionHash' AND r.links->>'action'='resolve-contest'
      AND r.links->>'referencesEventHash'=h.hash AND (r.links->>'sequence')::bigint<$6::bigint AND ${member('r')})`,
    'ASC',
  );
  if (record.referencesEventHash !== null) {
    await add(record.referencesEventHash);
    await find(
      `h.links->>'action'='resolve-contest' AND h.links->>'referencesEventHash'=$7`,
      'DESC',
      record.referencesEventHash,
    );
  }
  return [...basis.values()].sort((left, right) => left.link.sequence - right.link.sequence);
};
