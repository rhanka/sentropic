import type { CanonicalReadSelection, LifecycleEventRecord } from '@sentropic/comments';
import type { PgProjectionContext } from '../storage/postgres/protocol.js';
import { quotePgIdentifier } from '../storage/postgres/protocol.js';
import { pgMapKey } from '../storage/postgres/roots.js';
import { decodePgText } from '../storage/postgres/codec.js';
import { commentsControlAddress } from './import-control.js';
import { chainIdentity } from './storage-schema.js';
import { readCommentsPgRecord } from './postgres-records.js';
import { CommentsTransportError } from './transport-contracts.js';
// The frozen constructor receives actual retained records only: its last
// event plus the actual tombstone fact, without replaying the whole chain.
export const retainedCommentsLifecycleBasis = async (context: PgProjectionContext, selection: CanonicalReadSelection, previous: LifecycleEventRecord | null): Promise<readonly LifecycleEventRecord[]> => {
  if (!previous || previous.action === 'tombstone') return previous ? [previous] : [];
  const { schema, scope } = commentsControlAddress(context); const data = quotePgIdentifier(context.layout.dataSchema); const chain = chainIdentity(selection).key;
  const memberKey = pgMapKey('chain-record', JSON.stringify([chain, '__SEQ__']));
  const result = await context.session.execute({ text: `SELECT h.hash FROM ${schema}.comments_headers h WHERE h.scope_key=$1 AND h.chain_key=$2 AND h.selection->>'kind'='lifecycle-events' AND h.links->>'action'='tombstone' AND (h.links->>'sequence')::bigint<$5::bigint AND convert_from(${data}.map_get($3::bigint,replace($4,'__SEQ__',lpad(((h.links->>'sequence')::bigint-1)::text,16,'0'))),'UTF8')::jsonb->>'hash'=h.hash ORDER BY h.hash COLLATE "C" LIMIT 1`, values: [scope, chain, context.root, memberKey, previous.link.sequence + 1] });
  if (!result.rows[0]) return [previous];
  const tombstone = await readCommentsPgRecord({ ...context, coverageRoot: null }, selection, decodePgText(result.rows[0].hash));
  if (tombstone?.kind !== 'lifecycle-event' || tombstone.action !== 'tombstone') throw new CommentsTransportError('unavailable', 'Retained tombstone evidence is unavailable');
  return [tombstone, previous];
};
