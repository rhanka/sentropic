import type { ScopeGrant } from '../authority.js';
import { StorageIdempotencyConflictError, StorageInvalidCommandError } from '../errors.js';
import type { PgCore } from './core.js';
import { runPgTransaction, pgUnitDigest } from './ordinary-transactions.js';
import { decodePgUtf8 } from './codec.js';
interface PgBlob {
  readonly payload: string;
  readonly owners: string | null;
  readonly count: number;
}
export const sharePgBlob = async (
  core: PgCore,
  grant: ScopeGrant<unknown>,
  id: string,
  owner: string,
  bytes?: string,
): Promise<void> => {
  if (
    !id ||
    !owner ||
    id.length > 4096 ||
    owner.length > 4096 ||
    (bytes !== undefined &&
      (typeof bytes !== 'string' || Buffer.byteLength(bytes, 'utf8') > core.work().maxEncodedBytes))
  )
    throw new StorageInvalidCommandError('invalid shared blob');
  await runPgTransaction(core, grant, {}, async (tx) => {
    const store = core.roots;
    await core.visible(tx.session, tx.root, id);
    const previous = await store.get<PgBlob>(tx.session, tx.root, 'blob', id);
    if (!previous && bytes === undefined) {
      tx.noop = true;
      return;
    }
    const held = previous ? await store.get<boolean>(tx.session, previous.owners, 'owner', owner) : null;
    let payload = previous?.payload;
    if (bytes !== undefined) {
      if (
        previous &&
        previous.count > 0 &&
        decodePgUtf8(await store.readPayload(tx.session, grant.scope, previous.payload)) !== bytes
      )
        throw new StorageIdempotencyConflictError('shared bytes conflict');
      if (!previous || previous.count === 0)
        payload = await store.payload(tx.session, grant.scope, id, Buffer.from(bytes, 'utf8'), pgUnitDigest(bytes));
    }
    const owners = await store.put(
      tx.session,
      previous?.owners ?? null,
      'owner',
      owner,
      bytes === undefined ? null : true,
    );
    const count = (previous?.count ?? 0) + (bytes === undefined ? (held ? -1 : 0) : held ? 0 : 1);
    tx.root = await store.put(tx.session, tx.root, 'blob', id, { payload, owners, count });
    tx.count += 1;
  });
};
export const readPgBlob = async (core: PgCore, grant: ScopeGrant<unknown>, id: string): Promise<string | null> =>
  core.tx.run(true, async (session) => {
    await core.check(session, grant, 'read');
    const current = await core.roots.capture(session, grant.scope);
    await core.visible(session, current.root, id);
    const blob = await core.roots.get<PgBlob>(session, current.root, 'blob', id);
    return blob && blob.count > 0
      ? decodePgUtf8(await core.roots.readPayload(session, grant.scope, blob.payload))
      : null;
  });
