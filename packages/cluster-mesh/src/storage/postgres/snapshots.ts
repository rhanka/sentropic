import type { ScopeGrant } from '../authority.js';
import type { JournalFence } from '../staged-core.js';
import { StorageInvalidCommandError } from '../errors.js';
import type { PgCore } from './core.js';
import { assertPgJournalFence, pgConsumer, pgSafeCounter, savePgConsumer } from './journal.js';
import { executePgQuery, readPgBoundary, retainPgBoundary } from './queries.js';
export const capturePgSnapshot = async (core: PgCore, grant: ScopeGrant<unknown>, consumer: string, fence: JournalFence) => core.tx.run(false, async (session) => {
  await assertPgJournalFence(core, session, grant, fence);
  await pgConsumer(core, session, grant, consumer);
  if (!core.options.descriptor?.queryNames.includes('scope-chain-index')) throw new StorageInvalidCommandError('resync requires a registered scope-chain-index query');
  const base = await core.roots.capture(session, grant.scope);
  const snapshotRoot = await retainPgBoundary(core, session, grant, base, { kind: 'snapshot', consumer, pages: null, ordinal: 0, complete: false, contract: core.options.descriptor.contractDigest });
  return { snapshotRoot, journalSeq: pgSafeCounter(base.sequence) };
});
export const readPgSnapshot = async (core: PgCore, grant: ScopeGrant<unknown>, token: string, after: number, limit: number) => core.tx.run(false, async (session) => {
  await core.check(session, grant, 'read'); await core.check(session, grant, 'maintain', true);
  const captured = await readPgBoundary(core, session, grant, token); const metadata = captured.metadata;
  if (metadata.kind !== 'snapshot' || metadata.contract !== core.options.descriptor?.contractDigest || !Number.isSafeInteger(after) || after < 0 || after > Number(metadata.ordinal)) throw new StorageInvalidCommandError('invalid snapshot consumption or query contract');
  const pages = metadata.pages as string | null;
  const previous = await core.roots.get<{ position: unknown; next: number | null }>(session, pages, 'page', String(after));
  if (!previous && metadata.complete) throw new StorageInvalidCommandError('snapshot is exhausted');
  const position = previous ? previous.position : metadata.position ?? null;
  const page = await executePgQuery(core, session, grant, captured, 'scope-chain-index', {}, position, limit, core.options.descriptor!.pageLimits.maxEncodedBytes);
  const next = page.nextCursor === null ? null : after + 1;
  if (!previous) {
    metadata.pages = await core.roots.put(session, pages, 'page', String(after), { position, next });
    metadata.position = page.nextCursor; metadata.ordinal = after + 1; metadata.complete = next === null;
    await session.execute({ text: `UPDATE ${core.roots.schema}.boundaries SET metadata=$1::jsonb WHERE scope_key=$2 AND token=$3`, values: [JSON.stringify(metadata), core.roots.key(grant.scope), token] });
  }
  if (next === null) {
    const state = await pgConsumer(core, session, grant, String(metadata.consumer));
    state.scanned = Math.max(state.scanned, pgSafeCounter(captured.sequence));
    await savePgConsumer(core, session, grant, String(metadata.consumer), state);
  }
  return { rows: page.records, watermark: pgSafeCounter(captured.sequence), next };
});
