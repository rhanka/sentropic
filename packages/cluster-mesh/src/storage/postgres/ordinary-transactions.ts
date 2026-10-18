import { createHash } from 'node:crypto';
import {
  validateAtomicUnit,
  validateCommitOptions,
  type AtomicUnit,
  type CommitOptions,
  type CommitReceipt,
} from '../atomic.js';
import type { ScopeGrant } from '../authority.js';
import { StorageIdempotencyConflictError, StorageInvalidCommandError, isStorageError } from '../errors.js';
import type { PgCore, PgTx } from './core.js';
import { applyPgEffects } from './effects.js';
import { validatePgPurgePolicy } from './module-effects.js';
import { classifyPgFailure } from './errors.js';
import { REGISTERED_PG_EFFECTS } from './registered-effects.js';

export const ownPgValue = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export const pgUnitDigest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
export const pgReceipt = (core: PgCore, grant: ScopeGrant<unknown>, sequence: string): CommitReceipt => ({
  commitId: core.id('commit'),
  moduleId: core.options.moduleId,
  scope: { ...grant.scope },
  committedAt: core.now(),
  effectiveRecords: 0,
  effectiveAppends: 0,
  journalCursor: sequence,
});
export const applyPgTransaction = async (
  core: PgCore,
  grant: ScopeGrant<unknown>,
  tx: PgTx,
  input: AtomicUnit,
  options: CommitOptions,
  installed?: symbol,
): Promise<void> => {
  if (tx.closed) throw new StorageInvalidCommandError('transaction is closed');
  try {
    const unit = ownPgValue(input);
    const limits = core.work(options.limits);
    if (!validateAtomicUnit(unit, limits).ok || !validateCommitOptions(options).ok)
      throw new StorageInvalidCommandError('invalid atomic input');
    const bytes = Buffer.byteLength(JSON.stringify(unit), 'utf8');
    if (
      tx.encodedBytes + bytes > limits.maxEncodedBytes ||
      tx.appends + unit.appends.length > limits.maxAppends ||
      tx.recordWrites + unit.records.length > limits.maxRecords
    )
      throw new StorageInvalidCommandError('transaction exceeds work limits');
    await core.check(tx.session, grant, 'write');
    const result = await applyPgEffects(core, tx.session, grant, tx.root, unit, tx.base.root, installed);
    tx.root = result.root;
    tx.records += result.records;
    tx.recordWrites += unit.records.length;
    tx.appends += result.appends;
    tx.count += 1;
    tx.encodedBytes += bytes;
    // Installed operational services enforce their domain policy/authority
    // coherence; generic callers retain the unconditional barrier rule.
    tx.barriers += installed === REGISTERED_PG_EFFECTS ? 0 : unit.barriers.length;
    tx.purges += unit.purgeIntents.length;
    if (unit.moduleResult !== undefined) tx.moduleResult = unit.moduleResult;
    tx.digests.push(pgUnitDigest(unit));
    tx.contributors.set(grant.token, grant);
  } catch (error) {
    tx.failed = classifyPgFailure(error);
    if (tx.failed !== error) Object.defineProperty(tx.failed, 'cause', { value: error });
    throw tx.failed;
  }
};
export const runPgTransaction = async <T,>(
  core: PgCore,
  grant: ScopeGrant<unknown>,
  supplied: CommitOptions,
  operation: (tx: PgTx) => Promise<T>,
  immutableFlush = false,
): Promise<{ readonly value: T; readonly receipt: CommitReceipt }> => {
  const options = ownPgValue(supplied);
  if (!validateCommitOptions(options).ok) throw new StorageInvalidCommandError('invalid transaction options');
  core.work(options.limits);
  const current = core.ambient.getStore();
  if (current) {
    if (current.closed || core.roots.key(current.scope) !== core.roots.key(grant.scope))
      throw new StorageInvalidCommandError('transaction scope differs or is closed');
    current.contributors.set(grant.token, grant);
    try {
      return {
        value: await operation(current),
        receipt: Object.freeze({ ...current.receipt, scope: Object.freeze({ ...current.scope }) }),
      };
    } catch (error) {
      current.failed = error;
      throw error;
    }
  }
  let callbackError: unknown;
  let callbackFailed = false;
  try {
    return await core.tx.run(
      false,
      async (session) => {
        await core.check(session, grant, 'write', true);
        if (options.fence) await core.fence(session, grant, options.fence);
        const base = await core.roots.capture(session, grant.scope, true);
        const receipt = pgReceipt(core, grant, (BigInt(base.sequence) + 1n).toString());
        const tx: PgTx = {
          session,
          scope: grant.scope,
          base,
          root: base.root,
          receipt,
          closed: false,
          failed: null,
          records: 0,
          recordWrites: 0,
          appends: 0,
          count: 0,
          encodedBytes: 0,
          barriers: 0,
          purges: 0,
          digests: [],
          contributors: new Map([[grant.token, grant]]),
          revalidators: new Set(),
        };
        await session.execute({ text: 'SAVEPOINT immutable_command', values: [] });
        try {
          let value: T;
          try {
            value = await core.ambient.run(tx, () => operation(tx));
          } catch (error) {
            callbackError = error;
            callbackFailed = true;
            throw error;
          }
          if (tx.failed) throw tx.failed;
          if (tx.count === 0) {
            if (tx.noop) {
              for (const check of tx.revalidators) await check();
              return { value, receipt };
            }
            throw new StorageInvalidCommandError('empty transaction');
          }
          const digest = pgUnitDigest(tx.digests);
          const previous = options.idempotencyKey
            ? await core.roots.get<{ digest: string; receipt: CommitReceipt }>(
                session,
                base.root,
                'commit',
                options.idempotencyKey,
              )
            : null;
          if (previous) {
            if (previous.digest !== digest)
              throw new StorageIdempotencyConflictError('atomic command identity conflict');
            await session.execute({ text: 'ROLLBACK TO SAVEPOINT immutable_command', values: [] });
            return { value, receipt: ownPgValue(previous.receipt) };
          }
          await validatePgPurgePolicy(core, session, grant, tx.root, tx.barriers, tx.purges);
          const final: CommitReceipt = {
            ...receipt,
            effectiveRecords: tx.records,
            effectiveAppends: tx.appends,
            ...(tx.moduleResult === undefined ? {} : { moduleResult: tx.moduleResult }),
          };
          if (options.idempotencyKey)
            tx.root = await core.roots.put(session, tx.root, 'commit', options.idempotencyKey, {
              digest,
              receipt: final,
            });
          for (const contributor of tx.contributors.values()) await core.check(session, contributor, 'write', true);
          if (options.fence) await core.fence(session, grant, options.fence);
          for (const check of tx.revalidators) await check();
          await core.roots.publish(session, grant.scope, base, tx.root, final, options.idempotencyKey);
          return { value, receipt: ownPgValue(final) };
        } finally {
          tx.closed = true;
        }
      },
      immutableFlush,
    );
  } catch (error) {
    if (callbackFailed && !isStorageError(callbackError)) throw callbackError;
    throw error;
  }
};
