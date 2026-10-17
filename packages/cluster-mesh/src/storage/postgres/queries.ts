import type { ScopeGrant } from '../authority.js';
import {
  StorageCapacityExceededError,
  StorageDeniedError,
  StorageInvalidCommandError,
  UnsupportedProfileError,
} from '../errors.js';
import type { PgCore } from './core.js';
import type { PgSession } from './protocol.js';
import type { PgRoot } from './roots.js';
import { decodePgCounter, decodePgJson, decodePgText } from './codec.js';
import { ownPgValue, pgUnitDigest } from './ordinary-transactions.js';
export interface PgBoundary extends PgRoot {
  readonly token: string;
  metadata: Record<string, unknown>;
}
export const retainPgBoundary = async (
  core: PgCore,
  session: PgSession,
  grant: ScopeGrant<unknown>,
  base: PgRoot,
  metadata: Record<string, unknown>,
  knownToken?: string,
): Promise<string> => {
  const token = knownToken ?? core.id('boundary');
  if (token.length > 256) throw new StorageInvalidCommandError('opaque identifier exceeds boundary budget');
  await session.execute({
    text: `INSERT INTO ${core.roots.schema}.boundaries(scope_key, token, owner, root, version, sequence, metadata) VALUES($1, $2, $3, $4::bigint, $5::bigint,
        $6::bigint, $7::jsonb)${knownToken ? ' ON CONFLICT(scope_key,token) DO NOTHING' : ''}`,
    values: [
      core.roots.key(grant.scope),
      token,
      grant.principalId,
      base.root,
      base.version,
      base.sequence,
      JSON.stringify({ ...metadata, incarnation: core.incarnation }),
    ],
  });
  return token;
};
export const readPgBoundary = async (
  core: PgCore,
  session: PgSession,
  grant: ScopeGrant<unknown>,
  token: string,
): Promise<PgBoundary> => {
  const result = await session.execute({
    text: `SELECT owner, root::text, version::text, sequence::text, metadata::text FROM ${core.roots.schema}.boundaries WHERE scope_key=$1 AND token=$2 FOR
        UPDATE`,
    values: [core.roots.key(grant.scope), token],
  });
  const row = result.rows[0];
  if (!row) throw new StorageInvalidCommandError('unknown retained boundary');
  if (row.owner !== grant.principalId) throw new StorageDeniedError('boundary belongs to another principal');
  const metadata = decodePgJson<Record<string, unknown>>(decodePgText(row.metadata));
  if (metadata.incarnation !== core.incarnation) throw new StorageInvalidCommandError('boundary incarnation differs');
  return {
    token,
    root: row.root === null ? null : decodePgCounter(row.root),
    version: decodePgCounter(row.version),
    sequence: decodePgCounter(row.sequence),
    metadata,
  };
};
export const executePgQuery = async (
  core: PgCore,
  session: PgSession,
  grant: ScopeGrant<unknown>,
  captured: PgRoot,
  name: string,
  input: unknown,
  position: unknown,
  limit: number,
  budget: number,
) => {
  const descriptor = core.options.descriptor;
  const handler = core.options.queries?.[name];
  if (!descriptor?.queryNames.includes(name) || typeof handler !== 'function') throw new UnsupportedProfileError(name);
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > descriptor.pageLimits.maxRecords ||
    !Number.isSafeInteger(budget) ||
    budget < 256 ||
    budget > descriptor.pageLimits.maxEncodedBytes
  )
    throw new StorageInvalidCommandError('invalid named query bounds');
  const current = await core.roots.capture(session, grant.scope);
  const result = await handler(ownPgValue(input), {
    session,
    root: captured.root,
    currentRoot: current.root,
    layout: core.options.layout,
    grant,
    cursor: position,
    limit,
    maxEncodedBytes: budget - 256,
    stream: {
      moduleId: core.options.moduleId,
      scope: grant.scope,
      incarnation: core.incarnation,
      stream: core.incarnation,
    },
  });
  if (
    !Array.isArray(result.records) ||
    result.records.length > limit ||
    Buffer.byteLength(JSON.stringify(result), 'utf8') > budget - 128
  )
    throw new StorageCapacityExceededError('registered query exceeds its declared envelope');
  await core.check(session, grant, 'read');
  return ownPgValue(result);
};
export interface PgQueryRequest {
  readonly limit: number;
  readonly cursor?: string | null;
  readonly maxEncodedBytes?: number;
}
export const queryPgRoot = async (
  core: PgCore,
  grant: ScopeGrant<unknown>,
  name: string,
  supplied: unknown,
  request: PgQueryRequest,
) => {
  const input = ownPgValue(supplied);
  const hash = pgUnitDigest(input);
  const budget = request.maxEncodedBytes ?? core.options.descriptor?.pageLimits.maxEncodedBytes ?? 1048576;
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > 65536)
    throw new StorageInvalidCommandError('query parameters exceed metadata budget');
  return core.tx.run(false, async (session) => {
    await core.check(session, grant, 'read');
    const boundary = request.cursor ? await readPgBoundary(core, session, grant, request.cursor) : undefined;
    const captured = boundary ?? (await core.roots.capture(session, grant.scope));
    const metadata = boundary?.metadata ?? {
      kind: 'query',
      name,
      hash,
      position: null,
      contract: core.options.descriptor?.contractDigest,
    };
    if (
      metadata.kind !== 'query' || metadata.name !== name || metadata.hash !== hash || metadata.contract !== core.options.descriptor?.contractDigest) throw new StorageInvalidCommandError('query continuation binding differs');
    const result = await executePgQuery(core, session, grant, captured, name, input, metadata.position, request.limit, budget);
    const nextCursor = result.nextCursor === null ? null : await retainPgBoundary(core, session, grant, captured, { ...metadata, position: result.nextCursor });
    const page = { records: result.records, nextCursor, rootVersion: captured.version };
    if (Buffer.byteLength(JSON.stringify(page), 'utf8') > budget) throw new StorageCapacityExceededError('query envelope exceeds its byte budget');
    return page;
  });
};
