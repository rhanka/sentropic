// engram-memory Postgres named queries (binding section 4.1): input
// validation and scope checks for the five registered queries. Query
// execution uses canonical membership at the captured root. Current
// availability and authority still apply to every retained page.

import { StorageCapacityExceededError, StorageInvalidCommandError, StorageUnavailableError } from '../storage/errors.js';
import { quotePgIdentifier, type PgRegisteredQuery, type PgQueryPage, type PgQueryContext } from '../storage/postgres/protocol.js';
import { decodePgJson, decodePgText, decodePgUtf8 } from '../storage/postgres/codec.js';
import { decodeMemoryValue, memoryPgMap, memoryPgSchema, memoryPgScope, readMemoryPgPayload } from './projection.js';
import { MEMORY_QUERY_NAMES } from './manifest.js';
import { isCanonicalU64 } from './codec.js';

export type MemoryQueryName = (typeof MEMORY_QUERY_NAMES)[number];

export const isMemoryQueryName = (value: unknown): value is MemoryQueryName =>
  typeof value === 'string' && (MEMORY_QUERY_NAMES as readonly string[]).includes(value);

/** Strict page input: ascending cursor, 1–2,000 rows, under the byte ceiling. */
export const validateMemoryPageInput = (input: unknown, maxRecords: number): { readonly after: string; readonly limit: number } => {
  if (typeof input !== 'object' || input === null) {
    throw new StorageInvalidCommandError('memory page query requires an object input');
  }
  const candidate = input as Record<string, unknown>;
  const after: unknown = candidate['after'];
  if (!isCanonicalU64(after)) {
    throw new StorageInvalidCommandError('memory page query requires a canonical u64 after cursor');
  }
  const limit: unknown = candidate['limit'];
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > maxRecords) {
    throw new StorageInvalidCommandError(`memory page query limit must be within 1 and ${maxRecords}`);
  }
  return { after, limit };
};

export const validateMemoryRecordByIdInput = (input: unknown): { readonly recordId: string } => {
  if (typeof input !== 'object' || input === null) {
    throw new StorageInvalidCommandError('memory record query requires an object input');
  }
  const recordId: unknown = (input as Record<string, unknown>)['record_id'];
  if (typeof recordId !== 'string' || recordId.length === 0) {
    throw new StorageInvalidCommandError('memory record query requires a record_id');
  }
  return { recordId };
};

export const validateMemorySnapshotInput = (
  input: unknown,
  maxCandidates: number,
): { readonly systemAsOf: string; readonly scopeRef?: string; readonly maxCandidates: number } => {
  if (typeof input !== 'object' || input === null) {
    throw new StorageInvalidCommandError('memory snapshot query requires an object input');
  }
  const candidate = input as Record<string, unknown>;
  const systemAsOf: unknown = candidate['system_as_of'];
  if (!isCanonicalU64(systemAsOf)) {
    throw new StorageInvalidCommandError('memory snapshot query requires a canonical u64 system_as_of');
  }
  const max: unknown = candidate['max_candidates'];
  if (typeof max !== 'number' || !Number.isSafeInteger(max) || max < 1 || max > maxCandidates) {
    throw new StorageInvalidCommandError(`memory snapshot max_candidates must be within 1 and ${maxCandidates}`);
  }
  const scopeRef: unknown = candidate['scope_ref'];
  if (scopeRef !== undefined && (typeof scopeRef !== 'string' || scopeRef.length === 0)) {
    throw new StorageInvalidCommandError('memory snapshot scope_ref must be a non-empty string when present');
  }
  return { systemAsOf, scopeRef: scopeRef as string | undefined, maxCandidates: max };
};

const requireAvailable = async (context: PgQueryContext, target: string, seen = new Set<string>()): Promise<void> => {
  if (seen.has(target) || seen.size >= 128) throw new StorageUnavailableError('memory coverage is unavailable');
  seen.add(target);
  if (await memoryPgMap(context, context.currentRoot, 'barrier', target)
    || await memoryPgMap(context, context.currentRoot, 'disposed', target))
    throw new StorageUnavailableError('memory selection is unavailable');
  for (const parent of await memoryPgMap<readonly string[]>(context, context.currentRoot, 'parents', target) ?? [])
    await requireAvailable(context, parent, new Set(seen));
};

const readProjectedRows = async (context: PgQueryContext, name: MemoryQueryName, supplied: unknown) => {
  const schema = memoryPgSchema(context);
  const data = quotePgIdentifier(context.layout.dataSchema);
  const member = `convert_from(${data}.map_get($1::bigint,'['||to_json(e.map_kind)::text||','||to_json(e.entry_key)::text||']'),'UTF8')::jsonb`;
  if (name === 'memory-accepted-snapshot') {
    const input = validateMemorySnapshotInput(supplied, context.limit);
    return context.session.execute({
      text: `WITH states AS (SELECT DISTINCT ON(e.entry_key) e.entry_key,e.state FROM ${schema}.memory_entries e
        WHERE e.scope_key=$2 AND e.map_kind='aggregate' AND e.entry_key::jsonb->>0='memory-state-v1'
        AND e.entry_key::jsonb->>1='record' AND e.ordinal<=$3::numeric
        AND e.ordinal<=(${member}->>'version')::numeric ORDER BY e.entry_key,e.ordinal DESC)
        SELECT r.payload_id,(s.entry_key::jsonb->>2) AS position,r.entry_key FROM states s
        JOIN ${schema}.memory_entries r ON r.scope_key=$2 AND r.map_kind='record'
        AND r.entry_key='["memory-record-v1",'||to_json(s.entry_key::jsonb->>2)::text||']'
        WHERE s.state='accepted_current' AND ($4::text IS NULL OR r.scope_ref=$4)
        AND ($5::text IS NULL OR (s.entry_key::jsonb->>2)>$5 COLLATE "C")
        AND convert_from(${data}.map_get($1::bigint,'["record",'||to_json(r.entry_key)::text||']'),'UTF8')::jsonb->>'payload'=r.payload_id
        ORDER BY (s.entry_key::jsonb->>2) COLLATE "C" LIMIT $6`,
      values: [context.root, memoryPgScope(context), input.systemAsOf, input.scopeRef ?? null, context.cursor as string | null,
        Math.min(context.limit, input.maxCandidates) + 1],
    });
  }
  const input = validateMemoryPageInput(supplied, context.limit);
  const cursor: unknown = context.cursor === null ? [input.after, ''] : JSON.parse(String(context.cursor));
  if (!Array.isArray(cursor) || cursor.length !== 2 || !isCanonicalU64(cursor[0]) || typeof cursor[1] !== 'string')
    throw new StorageInvalidCommandError('invalid memory page continuation');
  return context.session.execute({
    text: `SELECT e.payload_id,e.ordinal::text,e.entry_key,e.map_kind FROM ${schema}.memory_entries e
      WHERE e.scope_key=$2 AND e.map_kind=$3 AND e.ordinal>$4::numeric
      AND (e.ordinal>$5::numeric OR (e.ordinal=$5::numeric AND e.entry_key>$6 COLLATE "C"))
      AND (${member})->>'payload'=e.payload_id
      ORDER BY e.ordinal,e.entry_key COLLATE "C" LIMIT $7`,
    values: [context.root, memoryPgScope(context), name === 'memory-journal-page' ? 'chain-record' : 'record',
      input.after, cursor[0], cursor[1], Math.min(context.limit, input.limit) + 1],
  });
};

export const memoryPgQuery = (name: MemoryQueryName): PgRegisteredQuery => {
  if (!isMemoryQueryName(name)) {
    throw new StorageInvalidCommandError(`unknown memory query: ${String(name)}`);
  }
  return async (supplied, context): Promise<PgQueryPage> => {
    if (context.cursor !== null && typeof context.cursor !== 'string') {
      throw new StorageInvalidCommandError('invalid memory query continuation');
    }
    memoryPgSchema(context);
    if (name === 'scope-chain-index') {
      await requireAvailable(context, 'memory-journal');
      const chain = await memoryPgMap<{ head: string; allocation: string }>(context, context.root, 'chain', 'memory-journal');
      return { records: chain ? [{ chainId: 'memory-journal', headHash: chain.head, allocation: chain.allocation }] : [], nextCursor: null };
    }
    if (name === 'memory-record-by-id') {
      const input = validateMemoryRecordByIdInput(supplied);
      const key = JSON.stringify(['memory-record-v1', input.recordId]);
      await requireAvailable(context, key);
      const ref = await memoryPgMap<{ payload: string }>(context, context.root, 'record', key);
      return { records: ref ? [decodeMemoryValue(await readMemoryPgPayload(context, ref.payload))] : [], nextCursor: null };
    }
    if (name === 'memory-journal-page') await requireAvailable(context, 'memory-journal');
    const limit = Math.min(context.limit, name === 'memory-accepted-snapshot'
      ? validateMemorySnapshotInput(supplied, context.limit).maxCandidates
      : validateMemoryPageInput(supplied, context.limit).limit);
    const result = await readProjectedRows(context, name, supplied);
    const records: unknown[] = [];
    let position: string | null = null;
    for (const row of result.rows.slice(0, limit)) {
      const key = decodePgText(row.entry_key);
      await requireAvailable(context, name === 'memory-journal-page' ? 'memory-journal' : key);
      let value: Record<string, unknown>;
      if (name === 'memory-journal-page') {
        const data = quotePgIdentifier(context.layout.dataSchema);
        const payload = (await context.session.execute({ text: `SELECT bytes,erased FROM ${data}.payloads WHERE scope_key=$1 AND id=$2`,
          values: [memoryPgScope(context), decodePgText(row.payload_id)],
        })).rows[0];
        if (!payload || payload.erased === true || payload.bytes === null) throw new StorageUnavailableError('memory journal payload is unavailable');
        value = decodePgJson<Record<string, unknown>>(decodePgUtf8(payload.bytes));
      } else value = decodeMemoryValue(await readMemoryPgPayload(context, decodePgText(row.payload_id)));
      const record = name === 'memory-accepted-snapshot' ? lexicalDocument(value) : value;
      const next = name === 'memory-accepted-snapshot' ? decodePgText(row.position) : JSON.stringify([decodePgText(row.ordinal), key]);
      if (Buffer.byteLength(JSON.stringify({ records: [...records, record], nextCursor: next }), 'utf8') > context.maxEncodedBytes) {
        if (!records.length) throw new StorageCapacityExceededError('memory record exceeds query byte budget');
        return { records, nextCursor: position };
      }
      records.push(record);
      position = next;
    }
    return { records, nextCursor: result.rows.length > limit ? position : null };
  };
};

// Same accepted lexical document fields as Engram 0.21.1's derivation.
// Admission, eligibility, ranking and digest computation remain in Engram.
const lexicalDocument = (record: Record<string, unknown>): unknown => {
  const components = record.components as readonly { component_id: string; kind: string; text: string }[];
  const citations = record.citations as readonly { source_ref: string }[];
  const trust = record.trust as { class: string };
  if (!Array.isArray(components) || !Array.isArray(citations) || !trust)
    throw new StorageUnavailableError('accepted memory record cannot be projected');
  const text = (kind: string) => components.filter((component) => component.kind === kind).map((component) => component.text).join('\n');
  return { record_id: record.record_id, record_digest: record.record_digest, valid_time: record.valid_time, trust_class: trust.class,
    fields: { primary: components.find((component) => component.component_id === record.primary_component_id)?.text ?? '',
      context: text('context'), decision: text('decision'), evidence: text('evidence'),
      citations: citations.map((citation) => citation.source_ref).join('\n') } };
};

export const MEMORY_PG_QUERIES = Object.freeze({
  'memory-journal-page': memoryPgQuery('memory-journal-page'),
  'memory-record-by-id': memoryPgQuery('memory-record-by-id'),
  'memory-accepted-snapshot': memoryPgQuery('memory-accepted-snapshot'),
  'memory-outbox-page': memoryPgQuery('memory-outbox-page'),
  'scope-chain-index': memoryPgQuery('scope-chain-index'),
});
