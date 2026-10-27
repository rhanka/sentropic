import type { EncodedValue } from '../storage/contracts.js';
import { createHash } from 'node:crypto';
import type { PgProjectionContext, PgQueryContext, PgRegisteredProjection } from '../storage/postgres/protocol.js';
import { quotePgIdentifier } from '../storage/postgres/protocol.js';
import { decodePgJson, decodePgText, decodePgUtf8 } from '../storage/postgres/codec.js';
import { pgScopeKey } from '../storage/postgres/roots.js';
import { chainRecordKey } from '../storage/postgres/effects.js';
import { StorageIdempotencyConflictError, StorageInvalidCommandError, StorageUnavailableError } from '../storage/errors.js';
import { canonicalizeMemoryJcs, isCanonicalU64 } from './codec.js';
import { validateMemoryEffects } from './postgres.js';
import { validateCommitReplay } from './replay-policy.js';

type Context = PgProjectionContext | PgQueryContext;
// Engram's frozen journal stores event_hash, not an intent_hash field.
// Derive replay metadata without altering the immutable event payload.
const eventIntentHash = (event: Record<string, unknown>): string => {
  const { cursor: _cursor, previous_event_hash: _previous, event_hash: _hash, ...intent } = event;
  return `sha256:${createHash('sha256').update('graphify-memory/memory-journal-intent/v1\0')
    .update(canonicalizeMemoryJcs(intent)).digest('hex')}`;
};
export const memoryPgScope = (context: Context): string => {
  if (context.stream.moduleId !== 'engram-memory' || context.grant.moduleId !== 'engram-memory')
    throw new StorageInvalidCommandError('memory projection requires the memory module');
  return pgScopeKey('engram-memory', context.grant.scope);
};
export const memoryPgSchema = (context: Context): string => {
  memoryPgScope(context);
  const schema = context.layout.projectionSchemas['engram-memory'];
  if (!schema) throw new StorageInvalidCommandError('memory projection schema is required');
  return quotePgIdentifier(schema);
};
export const decodeMemoryValue = (encoded: EncodedValue): Record<string, unknown> => {
  try {
    const value: unknown = JSON.parse(encoded.format === 'base64'
      ? Buffer.from(encoded.data, 'base64').toString('utf8') : encoded.data);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new StorageInvalidCommandError('memory projection requires JSON object bytes'); }
};
export const memoryPgMap = async <T,>(context: Context, root: string | null, kind: string, key: string): Promise<T | null> => {
  const data = quotePgIdentifier(context.layout.dataSchema);
  const row = (await context.session.execute({ text: `SELECT ${data}.map_get($1::bigint,$2) AS value`,
    values: [root, JSON.stringify([kind, key])],
  })).rows[0];
  return row?.value == null ? null : decodePgJson<T>(decodePgUtf8(row.value));
};
export const readMemoryPgPayload = async (context: Context, payload: string): Promise<EncodedValue> => {
  const data = quotePgIdentifier(context.layout.dataSchema);
  const row = (await context.session.execute({ text: `SELECT bytes,erased FROM ${data}.payloads WHERE scope_key=$1 AND id=$2`,
    values: [memoryPgScope(context), payload],
  })).rows[0];
  if (!row || row.erased === true || row.bytes === null) throw new StorageUnavailableError('memory payload is unavailable');
  return decodePgJson<EncodedValue>(decodePgUtf8(row.bytes));
};

// Validation and projection share the kernel session. Earlier contributions
// are visible here, and any refusal poisons/rolls back the entire transaction.
export const validateMemoryPgEffects: PgRegisteredProjection = async (effects, context) => {
  const schema = memoryPgSchema(context);
  const proposed = new Map<string, unknown>();
  const current = async (key: string): Promise<unknown> => {
    if (proposed.has(key)) return proposed.get(key);
    const row = (await context.session.execute({
      text: `SELECT payload_id FROM ${schema}.memory_entries WHERE scope_key=$1 AND map_kind='aggregate' AND entry_key=$2
        ORDER BY ordinal DESC LIMIT 1`, values: [memoryPgScope(context), key],
    })).rows[0];
    return row ? decodeMemoryValue(await readMemoryPgPayload(context, decodePgText(row.payload_id))) : undefined;
  };
  await validateMemoryEffects(effects);
  for (const update of effects.updates) {
    await validateMemoryEffects({ ...effects, updates: [update] }, current);
    proposed.set(update.key, decodeMemoryValue(update.value));
  }
  const events = new Set<string>();
  for (const append of effects.appends) {
    if (append.chainId !== 'memory-journal') throw new StorageInvalidCommandError('unknown memory chain');
    const event = decodeMemoryValue({ format: 'utf8', data: append.record.bytes });
    if (event.event_id !== append.record.id || !isCanonicalU64(event.cursor))
      throw new StorageInvalidCommandError('memory journal identity is invalid');
    if (events.has(append.record.id)) throw new StorageIdempotencyConflictError('memory event repeats within one unit');
    events.add(append.record.id);
    const row = (await context.session.execute({ text: `SELECT intent_hash FROM ${schema}.memory_entries
      WHERE scope_key=$1 AND event_id=$2`, values: [memoryPgScope(context), append.record.id],
    })).rows[0];
    if (row) {
      const validation = validateCommitReplay({ [append.record.id]: decodePgText(row.intent_hash) },
        { eventId: append.record.id, intentHash: eventIntentHash(event) });
      throw new StorageIdempotencyConflictError(validation.ok ? 'memory event requires original commit replay' : validation.errors.join('; '));
    }
  }
};

export const projectMemoryPgEffects: PgRegisteredProjection = async (effects, context) => {
  const schema = memoryPgSchema(context);
  const save = async (kind: string, key: string, ordinal: string, value: Record<string, unknown>, eventId: string | null = null) => {
    if (!isCanonicalU64(ordinal)) throw new StorageInvalidCommandError('memory projection ordinal must be u64');
    const ref = await memoryPgMap<{ payload: string }>(context, context.root, kind, key);
    if (!ref) throw new StorageUnavailableError('memory projection has no canonical membership');
    await context.session.execute({
      text: `INSERT INTO ${schema}.memory_entries(scope_key,map_kind,entry_key,payload_id,ordinal,event_id,intent_hash,scope_ref,state)
        VALUES($1,$2,$3,$4,$5::numeric,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
      values: [memoryPgScope(context), kind, key, ref.payload, ordinal, eventId,
        eventId ? eventIntentHash(value) : null, typeof value.scope_ref === 'string' ? value.scope_ref : null,
        typeof value.state === 'string' ? value.state : null],
    });
  };
  for (const record of effects.records) {
    const key: unknown = JSON.parse(record.key);
    if (!Array.isArray(key) || !['memory-record-v1', 'memory-outbox-v1'].includes(String(key[0])))
      throw new StorageInvalidCommandError('unknown memory record key');
    const value = decodeMemoryValue(record.bytes);
    await save('record', record.key, key[0] === 'memory-outbox-v1' ? String(key[1]) : '0', value);
  }
  for (const update of effects.updates) await save('aggregate', update.key, String(update.version), decodeMemoryValue(update.value));
  for (const append of effects.appends) {
    const head = await memoryPgMap<{ count: number }>(context, context.root, 'chain', append.chainId);
    if (!head) throw new StorageUnavailableError('memory journal head is unavailable');
    const event = decodeMemoryValue({ format: 'utf8', data: append.record.bytes });
    // The immutable map sequence is physical; the event cursor remains exact u64.
    const index = head.count - effects.appends.filter((item) => item.chainId === append.chainId).length
      + effects.appends.indexOf(append);
    await save('chain-record', chainRecordKey(append.chainId, index), String(event.cursor), event, append.record.id);
  }
};
