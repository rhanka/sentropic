import type { CanonicalChainRecord, CanonicalReadSelection } from '@sentropic/comments';
import type { PgProjectionContext } from '../storage/postgres/protocol.js';
import { quotePgIdentifier } from '../storage/postgres/protocol.js';
import { decodePgJson, decodePgUtf8 } from '../storage/postgres/codec.js';
import { chainRecordKey, type PgChain, type PgRecordRef, type PgChainRef } from '../storage/postgres/effects.js';
import { pgMapKey } from '../storage/postgres/roots.js';
import { canonicalRecordKey, chainIdentity, decodeRecord, validateRecordIdentity } from './storage-schema.js';
import { CommentsTransportError } from './transport-contracts.js';
export const commentsPgValue = async <T>(context: PgProjectionContext, kind: string, id: string, root = context.root): Promise<T | null> => {
  const schema = quotePgIdentifier(context.layout.dataSchema);
  const result = await context.session.execute({ text: `SELECT ${schema}.map_get($1::bigint,$2) AS value`, values: [root, pgMapKey(kind, id)] });
  return result.rows[0]?.value === null ? null : decodePgJson<T>(decodePgUtf8(result.rows[0]?.value));
};
export const assertCommentsPgVisible = async (context: PgProjectionContext, target: string): Promise<void> => {
  const pending = [target]; const seen = new Set<string>();
  while (pending.length) {
    const next = pending.pop()!; if (seen.has(next)) continue;
    if (seen.size >= 128 || await commentsPgValue(context, 'barrier', next, context.coverageRoot === undefined ? context.root : context.coverageRoot)) throw new CommentsTransportError('denied', 'Required comments content is unavailable');
    seen.add(next); pending.push(...await commentsPgValue<readonly string[]>(context, 'parents', next) ?? []);
  }
};
const payload = async (context: PgProjectionContext, id: string): Promise<string> => {
  const schema = quotePgIdentifier(context.layout.dataSchema);
  const scope = JSON.stringify([context.stream.moduleId, context.grant.scope.tenantId, context.grant.scope.workspaceId]);
  const result = await context.session.execute({ text: `SELECT bytes FROM ${schema}.payloads WHERE id=$1 AND scope_key=$2 AND NOT erased`, values: [id, scope] });
  if (!result.rows[0]) throw new CommentsTransportError('unavailable', 'Required canonical payload is unavailable');
  return decodePgUtf8(result.rows[0].bytes);
};
export const readCommentsPgRecord = async (context: PgProjectionContext, selection: CanonicalReadSelection, hash?: string): Promise<CanonicalChainRecord | null> => {
  const chain = chainIdentity(selection).key; await assertCommentsPgVisible(context, chain);
  const metadata = await commentsPgValue<PgChain>(context, 'chain', chain);
  if (!metadata || metadata.disposed) return null;
  let sequence = metadata.count - 1;
  if (hash !== undefined && hash !== metadata.head) {
    const ref = await commentsPgValue<PgRecordRef>(context, 'record', canonicalRecordKey(chain, hash)); if (!ref) return null;
    const encoded = decodePgJson<{ format: string; data: string }>(await payload(context, ref.payload));
    if (encoded.format !== 'utf8') throw new CommentsTransportError('unavailable', 'Canonical encoding differs');
    const record = decodeRecord(encoded.data, hash);
    if (!('link' in record)) return null;
    sequence = record.link.sequence - 1;
  }
  if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence >= metadata.count) return null;
  const ref = await commentsPgValue<PgChainRef>(context, 'chain-record', chainRecordKey(chain, sequence));
  if (!ref || (hash !== undefined && ref.hash !== hash)) return null;
  const record = decodeRecord(await payload(context, ref.payload), ref.hash);
  validateRecordIdentity(context.grant.scope, selection, record); return record;
};
