import type { ScopeGrant } from '../authority.js';
import type { JournalFence } from '../staged-core.js';
import type { RootConsumer, RootJournalEvent } from '../staged-state.js';
import { StorageCapacityExceededError, StorageCasConflictError, StorageInvalidCommandError } from '../errors.js';
import type { PgCore } from './core.js';
import type { PgJournalDraft, PgSession } from './protocol.js';
import { decodePgCounter, decodePgJson, decodePgText } from './codec.js';
import { PostgresStorageError } from './errors.js';
import { createHash } from 'node:crypto';
export const currentPgJournalFence = async (core: PgCore, grant: ScopeGrant<unknown>): Promise<JournalFence> =>
  core.tx.run(false, async (session) => {
    await core.check(session, grant, 'maintain', true);
    const lane = `journal:${createHash('sha256').update(grant.principalId, 'utf8').digest('hex')}`;
    await session.execute({
      text: `INSERT INTO ${core.roots.schema}.fences(scope_key, lane, owner, incarnation, epoch) VALUES($1, $2, $3, $4, 1) ON CONFLICT(scope_key, lane) DO NOTHING`,
      values: [core.roots.key(grant.scope), lane, grant.principalId, core.incarnation],
    });
    const result = await session.execute({
      text: `SELECT epoch::text FROM ${core.roots.schema}.fences WHERE scope_key=$1 AND lane=$2`,
      values: [core.roots.key(grant.scope), lane],
    });
    const fence = {
      fenceId: lane,
      epoch: decodePgCounter(result.rows[0]?.epoch),
      incarnation: core.incarnation,
      ownerId: grant.principalId,
    };
    await core.fence(session, grant, fence);
    return fence;
  });
export const pgSafeCounter = (value: unknown): number => {
  const counter = decodePgCounter(value);
  const number = Number(counter);
  if (!Number.isSafeInteger(number))
    throw new StorageCapacityExceededError('counter exceeds the negotiated numeric API');
  return number;
};
const stream = (core: PgCore, grant: ScopeGrant<unknown>) => ({
  moduleId: core.options.moduleId,
  scope: grant.scope,
  incarnation: core.incarnation,
  stream: core.incarnation,
});
export const assertPgJournalFence = async (
  core: PgCore,
  session: PgSession,
  grant: ScopeGrant<unknown>,
  fence: JournalFence,
): Promise<void> => {
  await core.check(session, grant, 'maintain', true);
  if (fence.incarnation !== core.incarnation || fence.ownerId !== grant.principalId)
    throw new StorageInvalidCommandError('journal owner or incarnation differs');
  await core.fence(session, grant, fence);
};
export const pgConsumer = async (
  core: PgCore,
  session: PgSession,
  grant: ScopeGrant<unknown>,
  consumer: string,
  lock = true,
): Promise<RootConsumer> => {
  if (typeof consumer !== 'string' || !consumer || consumer.length > 1024)
    throw new StorageInvalidCommandError('invalid consumer');
  const initial: RootConsumer = {
    cursor: 0,
    scanned: 0,
    status: 'running',
    failedEvent: null,
    failedReason: null,
    failedSeq: null,
    retryAuthorized: false,
    deliveredPoison: false,
    actions: [],
  };
  if (lock)
    await session.execute({
      text: `INSERT INTO ${core.roots.schema}.consumers(scope_key, consumer, state) VALUES($1, $2, $3::jsonb) ON CONFLICT(scope_key, consumer) DO NOTHING`,
      values: [core.roots.key(grant.scope), consumer, JSON.stringify(initial)],
    });
  const result = await session.execute({
    text: `SELECT state::text FROM ${core.roots.schema}.consumers WHERE scope_key=$1 AND consumer=$2${lock ? ' FOR UPDATE' : ''}`,
    values: [core.roots.key(grant.scope), consumer],
  });
  if (!result.rows[0]) return initial;
  const state = decodePgJson<RootConsumer>(decodePgText(result.rows[0].state));
  if (
    !Number.isSafeInteger(state.cursor) ||
    !Number.isSafeInteger(state.scanned) ||
    state.cursor < 0 ||
    state.scanned < state.cursor ||
    !['running', 'paused', 'stalled'].includes(state.status) ||
    !Array.isArray(state.actions)
  )
    throw new PostgresStorageError('corruption');
  return state;
};
export const savePgConsumer = async (
  core: PgCore,
  session: PgSession,
  grant: ScopeGrant<unknown>,
  consumer: string,
  state: RootConsumer,
): Promise<void> => {
  await session.execute({
    text: `UPDATE ${core.roots.schema}.consumers SET state=$1::jsonb WHERE scope_key=$2 AND consumer=$3`,
    values: [JSON.stringify(state), core.roots.key(grant.scope), consumer],
  });
};
export const readPgJournal = async (
  core: PgCore,
  grant: ScopeGrant<unknown>,
  after: number,
  limit: number,
  consumer?: string,
) => {
  if (
    !Number.isSafeInteger(after) ||
    after < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > core.work().maxRecords
  )
    throw new StorageInvalidCommandError('invalid journal window');
  return core.tx.run(consumer === undefined, async (session) => {
    await core.check(session, grant, 'read');
    if (consumer !== undefined) await core.check(session, grant, 'maintain', true);
    const base = await core.roots.capture(session, grant.scope);
    const watermark = pgSafeCounter(base.sequence);
    if (after > watermark) throw new StorageInvalidCommandError('journal position exceeds watermark');
    const state = consumer === undefined ? undefined : await pgConsumer(core, session, grant, consumer);
    const events: RootJournalEvent[] = [];
    if (!state || state.status === 'running') {
      const result = core.options.outbox
        ? {
            rows: (await core.options.outbox.read(session, stream(core, grant), String(after), limit)).map((event) => ({
              sequence: event.seq,
              event: JSON.stringify(event),
            })),
          }
        : await session.execute({
            text: `SELECT j.sequence::text, j.event::text FROM ${core.roots.schema}.journal AS j WHERE j.scope_key=$1 AND j.sequence>$2::bigint ORDER BY j.sequence LIMIT $3`, values: [core.roots.key(grant.scope), String(after), limit] });
      for (const row of result.rows) {
        const seq = pgSafeCounter(row.sequence); const event = decodePgJson<PgJournalDraft>(decodePgText(row.event));
        if (seq !== after + events.length + 1 || String(seq) !== event.seq || typeof event.eventId !== 'string') throw new PostgresStorageError('corruption');
        const value: RootJournalEvent = { ...event, seq, scope: { ...grant.scope }, ...(event.segment ? { segment: { ...event.segment, from: pgSafeCounter(event.segment.from), to: pgSafeCounter(event.segment.to) } } : { segment: undefined }) };
        if (Buffer.byteLength(JSON.stringify({ events: [...events, value], watermark }), 'utf8') > core.work().maxEncodedBytes) break;
        events.push(value);
        if (state) {
          if (after <= state.scanned) state.scanned = Math.max(state.scanned, seq);
          if (state.retryAuthorized && state.failedEvent === value.eventId) state.deliveredPoison = true;
        }
      }
      if (events.length === 0 && after < watermark) throw new StorageCapacityExceededError('journal replay is unavailable or event exceeds its byte budget');
    }
    if (state) await savePgConsumer(core, session, grant, consumer!, state);
    return { events, watermark };
  });
};
export const checkpointPgJournal = async (core: PgCore, grant: ScopeGrant<unknown>, consumer: string, expected: number, next: number, fence: JournalFence): Promise<void> => {
  await core.tx.run(false, async (session) => {
    await assertPgJournalFence(core, session, grant, fence);
    const state = await pgConsumer(core, session, grant, consumer);
    if (state.cursor !== expected) throw new StorageCasConflictError('checkpoint changed');
    if (!Number.isSafeInteger(next) || next < expected || next > state.scanned || state.status !== 'running' || (state.failedSeq !== null && next >= state.failedSeq && (!state.retryAuthorized || !state.deliveredPoison))) throw new StorageInvalidCommandError('checkpoint exceeds delivered progress or unresolved poison');
    state.cursor = next;
    if (state.failedSeq !== null && next >= state.failedSeq) { state.failedSeq = null; state.failedEvent = null; state.failedReason = null; state.retryAuthorized = false; state.deliveredPoison = false; }
    await savePgConsumer(core, session, grant, consumer, state);
  });
};
export const inspectPgConsumer = async (core: PgCore, grant: ScopeGrant<unknown>, consumer: string) => core.tx.run(true, async (session) => {
  await core.check(session, grant, 'read'); const base = await core.roots.capture(session, grant.scope);
  const state = await pgConsumer(core, session, grant, consumer, false);
  return { cursor: state.cursor, status: state.status, failedEvent: state.failedEvent, failedReason: state.failedReason, lag: pgSafeCounter(base.sequence) - state.cursor };
});
export const operatePgConsumer = async (core: PgCore, grant: ScopeGrant<unknown>, consumer: string, operation: 'poison' | 'pause' | 'retry', eventId: string | null, reason?: string, fence?: JournalFence): Promise<void> => {
  await core.tx.run(false, async (session) => {
    await core.check(session, grant, 'maintain', true);
    if (fence) await assertPgJournalFence(core, session, grant, fence);
    const state = await pgConsumer(core, session, grant, consumer);
    if (operation === 'poison') {
      const external = core.options.outbox && eventId ? await core.options.outbox.find(session, stream(core, grant), eventId) : null;
      const rows = core.options.outbox ? { rows: external?.eventId === eventId ? [{ sequence: external.seq }] : [] }
        : await session.execute({ text: `SELECT sequence::text FROM ${core.roots.schema}.journal WHERE scope_key=$1 AND event_id=$2`, values: [core.roots.key(grant.scope), eventId] });
      const seq = rows.rows[0] ? pgSafeCounter(rows.rows[0].sequence) : -1;
      if (seq <= state.cursor || seq > state.scanned || !reason || reason.length > 4096 || (state.failedEvent !== null && state.failedEvent !== eventId)) throw new StorageInvalidCommandError('poison must identify delivered unacknowledged progress');
      state.failedSeq = seq; state.failedEvent = eventId; state.failedReason = reason; state.status = 'stalled'; state.retryAuthorized = false; state.deliveredPoison = false;
    } else if (operation === 'pause') state.status = 'paused';
    else {
      if (state.failedEvent !== eventId) throw new StorageCasConflictError('failed event changed');
      state.status = 'running'; state.retryAuthorized = eventId !== null; state.deliveredPoison = false;
      state.actions.push({ by: grant.principalId, eventId, at: core.now() }); if (state.actions.length > 32) state.actions.shift();
    }
    await savePgConsumer(core, session, grant, consumer, state);
    await session.execute({ text: `INSERT INTO ${core.roots.schema}.consumer_actions(scope_key,consumer,operation,owner,event_id) VALUES($1,$2,$3,$4,$5)`, values: [core.roots.key(grant.scope), consumer, operation, grant.principalId, eventId] });
  });
};
