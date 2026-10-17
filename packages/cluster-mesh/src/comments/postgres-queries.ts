import { isResourceRef } from '@sentropic/comments';
import type { CanonicalReadSelection } from '@sentropic/comments';
import { StorageCapacityExceededError } from '../storage/errors.js';
import { quotePgIdentifier, type PgQueryContext, type PgRegisteredQuery } from '../storage/postgres/protocol.js';
import { decodePgJson, decodePgText, decodePgUtf8 } from '../storage/postgres/codec.js';
import { chainIdentity, commentsResourceKey, invalid, sameScope } from './storage-schema.js';
const mapValue = async <T,>(context: PgQueryContext, kind: string, id: string): Promise<T | null> => {
  const schema = quotePgIdentifier(context.layout.dataSchema);
  const value = (
    await context.session.execute({
      text: `SELECT ${schema}.map_get($1::bigint, $2) AS value`,
      values: [context.currentRoot, JSON.stringify([kind, id])],
    })
  ).rows[0]?.value;
  return value === null ? null : decodePgJson<T>(decodePgUtf8(value));
};
const available = async (context: PgQueryContext, target: string, seen = new Set<string>()): Promise<boolean> => {
  if (seen.has(target) || seen.size >= 128) return false;
  seen.add(target);
  if ((await mapValue(context, 'barrier', target)) || (await mapValue(context, 'disposed', target))) return false;
  for (const parent of (await mapValue<readonly string[]>(context, 'parents', target)) ?? [])
    if (!(await available(context, parent, seen))) return false;
  return true;
};
export const commentsPgQuery =
  (name: 'by-resource' | 'scope-chain-index' | 'retained-headers'): PgRegisteredQuery =>
  async (supplied, context) => {
    const input = supplied as { resource?: unknown; selection?: CanonicalReadSelection };
    let resource: string | null = null;
    let selection: string | null = null;
    if (name === 'by-resource') {
      if (!isResourceRef(input?.resource) || !sameScope(input.resource.scope, context.grant.scope))
        return invalid('resource query scope mismatch');
      resource = commentsResourceKey(input.resource);
    }
    if (name === 'retained-headers') selection = chainIdentity(input?.selection as CanonicalReadSelection).key;
    if (context.cursor !== null && typeof context.cursor !== 'string')
      return invalid('invalid comments query continuation');
    const data = quotePgIdentifier(context.layout.dataSchema);
    const projection = quotePgIdentifier(
      context.layout.projectionSchemas.comments ?? invalid('comments projection schema is required'),
    );
    const scope = JSON.stringify(['comments', context.grant.scope.tenantId, context.grant.scope.workspaceId]);
    const result = await context.session.execute({
      text: `SELECT c.chain_key, h.selection::text, h.links::text, m.metadata::text FROM ${projection}.comments_chains c CROSS JOIN LATERAL (SELECT
        convert_from(${data}.map_get($1::bigint, '["chain",'||to_json(c.chain_key)::text||']'), 'UTF8')::jsonb AS metadata) m JOIN
        ${projection}.comments_headers h ON h.scope_key=c.scope_key AND h.chain_key=c.chain_key AND h.hash=m.metadata->>'head' WHERE c.scope_key=$2
        AND ($3::text IS NULL OR c.chain_key>$3 COLLATE "C") AND ($5::text IS NULL OR c.chain_key=$5) AND ($4::text IS NULL OR EXISTS(SELECT
        1 FROM ${projection}.comments_resources r WHERE r.scope_key=c.scope_key AND r.chain_key=c.chain_key AND r.hash=h.hash AND r.resource_key=$4))
        ORDER BY c.chain_key COLLATE "C" LIMIT $6`,
      values: [context.root, scope, context.cursor as string | null, resource, selection, context.limit + 1],
    });
    const records: unknown[] = [];
    let last: string | null = null;
    for (const row of result.rows.slice(0, context.limit)) {
      const chainId = decodePgText(row.chain_key);
      const metadata = decodePgJson<{ head: string; count: number; allocation: string }>(decodePgText(row.metadata));
      const header = {
        selection: decodePgJson(decodePgText(row.selection)),
        chainId,
        headHash: metadata.head,
        terminalSequence: metadata.count,
        allocation: metadata.allocation,
        links: decodePgJson(decodePgText(row.links)),
        availability: (await available(context, chainId)) ? 'available' : 'inaccessible',
      };
      if (
        Buffer.byteLength(JSON.stringify({ records: [...records, header], nextCursor: chainId }), 'utf8') >
        context.maxEncodedBytes
      ) {
        if (!records.length) throw new StorageCapacityExceededError('a retained header exceeds the query page budget');
        return { records, nextCursor: last };
      }
      records.push(header);
      last = chainId;
    }
    return { records, nextCursor: result.rows.length > context.limit ? last : null };
  };
