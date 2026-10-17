import type { ScopeGrant } from '../authority.js';
import type { RootPurgeJob } from '../staged-state.js';
import { StorageCapacityExceededError, StorageInvalidCommandError } from '../errors.js';
import type { PgCore } from './core.js';
import { readPgBoundary, retainPgBoundary } from './queries.js';
import { decodePgCounter } from './codec.js';
export const inspectPgPurge = async (
  core: PgCore,
  grant: ScopeGrant<unknown>,
  intentId: string,
): Promise<RootPurgeJob> =>
  core.tx.run(true, async (session) => {
    await core.check(session, grant, 'maintain');
    const base = await core.roots.capture(session, grant.scope);
    const job = await core.roots.get<RootPurgeJob>(session, base.root, 'purge-job', intentId);
    if (!job) throw new StorageInvalidCommandError('unknown purge job');
    return {
      target: job.target,
      intentId: job.intentId,
      authorizedBy: job.authorizedBy,
      state: job.state,
      outcomeId: job.outcomeId,
      payloadDisposition: job.payloadDisposition,
    };
  });
const sections = { jobs: 'purge-job', outcomes: 'purge-outcome', notifications: 'purge-notification' } as const;
export interface PgMaintenanceRequest {
  readonly limit: number;
  readonly cursor?: string | null;
}
export const readPgMaintenance = async (
  core: PgCore,
  grant: ScopeGrant<unknown>,
  section: keyof typeof sections,
  request: PgMaintenanceRequest,
) => {
  if (
    !Object.hasOwn(sections, section) ||
    !Number.isSafeInteger(request.limit) ||
    request.limit < 1 ||
    request.limit >= 1024 ||
    request.limit > core.work().maxRecords
  )
    throw new StorageInvalidCommandError('invalid maintenance page');
  const kind = sections[section];
  const prefix = `[${JSON.stringify(kind)},`;
  return core.tx.run(false, async (session) => {
    await core.check(session, grant, 'maintain');
    const boundary = request.cursor ? await readPgBoundary(core, session, grant, request.cursor) : undefined;
    if (boundary && (boundary.metadata.kind !== 'maintenance-page' || boundary.metadata.section !== section))
      throw new StorageInvalidCommandError('maintenance cursor binding differs');
    const base = boundary ?? (await core.roots.capture(session, grant.scope));
    const position = boundary
      ? decodePgCounter(boundary.metadata.position)
      : decodePgCounter(
          (
            await session.execute({
              text: `SELECT ${core.roots.schema}.map_lower_bound($1::bigint, $2) AS position`,
              values: [base.root, prefix],
            })
          ).rows[0]?.position,
        );
    const rows = await core.roots.page(session, base.root, position, request.limit + 1);
    const window = rows.filter((row) => row.key.startsWith(prefix));
    const records = window
      .slice(0, request.limit)
      .filter((row) => row.value !== null)
      .map((row) => ({ key: (JSON.parse(row.key) as string[])[1]!, value: row.value }));
    const nextCursor =
      window.length > request.limit
        ? await retainPgBoundary(core, session, grant, base, {
            kind: 'maintenance-page',
            section,
            position: (BigInt(position) + BigInt(request.limit)).toString(),
          })
        : null;
    const page = { records, nextCursor };
    if (Buffer.byteLength(JSON.stringify(page), 'utf8') > core.work().maxEncodedBytes)
      throw new StorageCapacityExceededError('maintenance page exceeds its byte budget');
    return page;
  });
};
