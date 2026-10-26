// PostgreSQL installed ownership guards (lot E4).
// G-P0a feeds the open path: the deprecated asset-name scan runs before any
// migration, and the module record is ensured with a readback. G-P0b is the
// commit-point guard chained before the caller hook. No transaction rewiring:
// the guard reuses the existing onCommitPossession seam through its own
// read-only transaction.
import { decodePgText } from './codec.js';
import { PostgresStorageError } from './errors.js';
import type { PgSession } from './protocol.js';

const DEPRECATED_ASSET_NAME = /(?:legacy|deprecated|backup|tmp|temp|old|bak|copy)(?:[^a-z]|$)/i;

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

/** G-P0b: durable possession first, caller hook second; a refusal rolls back. */
export const chainPossessionGuard = (
  verify: (session: PgSession) => Promise<void>,
  read: <T>(operation: (session: PgSession) => Promise<T>) => Promise<T>,
  caller?: () => void | Promise<void>,
): (() => Promise<void>) => async () => {
  await read((session) => verify(session));
  await caller?.();
};
