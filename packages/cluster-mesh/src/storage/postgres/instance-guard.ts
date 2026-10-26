// PostgreSQL installed ownership guards (lot E4, R1).
// G-P0a feeds the open path: the deprecated asset-name scan, the module
// record readback and the ownership catalog verification run before any
// acquisition. G-P0b is the commit-point guard running INSIDE the commit
// transaction: the per-kernel driver wrapper below carries the commit session
// through AsyncLocalStorage, so the guard verifies and renews on the very
// session that commits (no second transaction, no pool deadlock, no TOCTOU
// window). No transaction rewiring: the existing onCommitPossession seam is
// reused, chained only for opt-in canonical kernels.
import { AsyncLocalStorage } from 'node:async_hooks';
import { CanonicalOwnershipError } from '../instance-ownership.js';
import { decodePgText } from './codec.js';
import { PostgresStorageError } from './errors.js';
import {
  renewPgInstanceLease,
  verifyPgInstanceOwnership,
  type CanonicalInstanceHandle,
} from './instance-ownership.js';
import type { InjectedPgDriver, PgSession, PgTransactionOptions } from './protocol.js';

const DEPRECATED_ASSET_NAME = /(?:^|[^a-z])(?:legacy|deprecated|backup|tmp|temp|old|bak|copy)(?:[^a-z]|$)/i;

export const assertNoDeprecatedAssetNames = (assets: readonly { readonly file: string }[]): void => {
  for (const asset of assets) {
    if (DEPRECATED_ASSET_NAME.test(asset.file)) throw new PostgresStorageError('configuration');
  }
};

export interface PgModuleRecordInput {
  readonly moduleId: string;
  /** Expected incarnation; undefined adopts whatever is stored. */
  readonly incarnation?: string;
  /** Actually inserted when the row is absent; never undefined. */
  readonly effectiveIncarnation: string;
  readonly wantedDescriptorDigest?: string | null;
}

export const ensurePgModuleRecord = async (
  session: PgSession,
  schema: string,
  record: PgModuleRecordInput,
): Promise<string> => {
  await session.execute({
    text: `INSERT INTO ${schema}.modules(module, incarnation) VALUES($1, $2) ON CONFLICT(module) DO NOTHING`,
    values: [record.moduleId, record.effectiveIncarnation],
  });
  const result = await session.execute({
    text: `SELECT incarnation, descriptor_digest FROM ${schema}.modules WHERE module=$1`,
    values: [record.moduleId],
  });
  if (result.rows[0] === undefined) throw new PostgresStorageError('configuration');
  const stored = decodePgText(result.rows[0]?.incarnation);
  if (record.incarnation !== undefined && record.incarnation !== stored) {
    throw new PostgresStorageError('configuration');
  }
  const registered = result.rows[0]?.descriptor_digest;
  const digest = registered === null || registered === undefined ? null : decodePgText(registered);
  const wanted = record.wantedDescriptorDigest ?? null;
  if (digest !== null && digest !== wanted) throw new PostgresStorageError('configuration');
  if (wanted && digest === null) {
    const pinned = await session.execute({
      text: `UPDATE ${schema}.modules SET descriptor_digest=$1
        WHERE module=$2 AND descriptor_digest IS NULL
        AND NOT EXISTS(SELECT 1 FROM ${schema}.scopes
        WHERE module=$2 AND version>0) RETURNING module`,
      values: [wanted, record.moduleId],
    });
    if (pinned.rows.length !== 1) throw new PostgresStorageError('configuration');
  }
  return stored;
};

/** Retained session cell: schema and handle are filled at open, before any
 * transaction runs through the wrapped driver. */
export interface PgOwnershipCell {
  handle: CanonicalInstanceHandle | null;
  released: boolean;
  schema: string;
  readonly moduleId: string;
  readonly leaseMs: number;
}

export const createOwnershipCell = (schema: string, moduleId: string, leaseMs: number): PgOwnershipCell => ({
  handle: null,
  released: false,
  schema,
  moduleId,
  leaseMs,
});

/**
 * Per-kernel driver wrapper. Every transaction of an opted-in kernel first
 * verifies the retained session on its own session (reads) or verifies and
 * renews the lease (read-write); released kernels are refused without SQL.
 * Non-opt-in kernels (cell handle unset) pass through untouched. The commit
 * session is exposed for the G-P0b hook through AsyncLocalStorage, so the
 * decision guard runs inside the real COMMIT transaction.
 */
export const wrapDriverWithOwnership = (
  driver: InjectedPgDriver,
  cell: PgOwnershipCell,
): { driver: InjectedPgDriver; useSession: () => PgSession | undefined } => {
  const current = new AsyncLocalStorage<PgSession>();
  return {
    driver: {
      transaction: async <T>(options: PgTransactionOptions, operation: (session: PgSession) => Promise<T>): Promise<T> =>
        driver.transaction(options, async (session) => {
          if (cell.handle !== null) {
            if (cell.released) throw new CanonicalOwnershipError('stale-epoch', 'released ownership handle');
            if (options.readOnly) {
              await verifyPgInstanceOwnership(session, cell.schema, cell.moduleId, cell.handle, false);
            } else {
              await renewPgInstanceLease(session, cell.schema, cell.moduleId, cell.handle, false, cell.leaseMs);
            }
          }
          return current.run(session, () => operation(session));
        }),
    },
    useSession: () => current.getStore(),
  };
};

/** G-P0b: durable re-validation and renewal on the committing session itself,
 * before the caller hook; any refusal rolls back with the commit. */
export const chainPossessionGuard = (
  useSession: () => PgSession | undefined,
  cell: PgOwnershipCell,
  caller?: () => void | Promise<void>,
): (() => Promise<void>) => async () => {
  const session = useSession();
  const handle = cell.handle;
  if (!session || !handle || cell.released) {
    throw new CanonicalOwnershipError('terminal-loss', 'commit without retained session');
  }
  await renewPgInstanceLease(session, cell.schema, cell.moduleId, handle, false, cell.leaseMs);
  await caller?.();
};

/** G-P0a installed catalog check: the 008 table, the deferred lease trigger
 * and its guard function must exist with the contracted binding (enabled,
 * deferred, AFTER UPDATE ROW) — a fingerprint cannot see trigger state.
 * Refusal is `open-refused` (registry/SQLite parity for opt-in opens), never
 * a storage configuration error. The trigger is born `tgenabled='O'`
 * (origin+local, the PostgreSQL default for constraint triggers); `'A'`
 * (always) is accepted too. */
export const assertPgOwnershipCatalog = async (session: PgSession, dataSchema: string): Promise<void> => {
  const refuse = (): never => {
    throw new CanonicalOwnershipError('open-refused', 'instance ownership catalog is not installed or was tampered with');
  };
  const columns = await session.execute({
    text: `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema=$1 AND table_name='instance_ownership'`,
    values: [dataSchema],
  });
  const byName = new Map(columns.rows.map((row) => [decodePgText(row.column_name), decodePgText(row.data_type)]));
  if (byName.get('module') !== 'text' || byName.get('instance') !== 'text' || byName.get('epoch') !== 'text') refuse();
  if (byName.get('holder_until') !== 'timestamp with time zone') refuse();
  const checks = await session.execute({
    text: `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid=$1::regclass AND contype='c'`,
    values: [`"${dataSchema}".instance_ownership`],
  });
  if (!checks.rows.some((row) => typeof row.definition === 'string' && row.definition.includes('18446744073709551615'))) refuse();
  const triggers = await session.execute({
    text: `SELECT t.tgname, t.tgenabled, t.tgdeferrable, t.tginitdeferred, t.tgtype, p.proname, l.lanname, p.prosrc
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_proc p ON p.oid = t.tgfoid JOIN pg_language l ON l.oid = p.prolang
      WHERE n.nspname=$1 AND c.relname='instance_ownership' AND NOT t.tgisinternal`,
    values: [dataSchema],
  });
  const trigger = triggers.rows.find((row) => row.tgname === 'instance_ownership_lease');
  if (!trigger) refuse();
  if ((trigger.tgenabled !== 'O' && trigger.tgenabled !== 'A') || trigger.tgdeferrable !== true || trigger.tginitdeferred !== true) refuse();
  if (trigger.tgtype !== 17) refuse();
  if (trigger.proname !== 'instance_ownership_guard' || trigger.lanname !== 'plpgsql') refuse();
  const prosrc = typeof trigger.prosrc === 'string' ? trigger.prosrc : '';
  if (!prosrc.includes('holder_until') || !prosrc.includes('clock_timestamp')) refuse();
};
