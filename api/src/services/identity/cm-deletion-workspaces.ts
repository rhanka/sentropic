import { IdentityCustodyErrorV1 } from '@sentropic/cluster-mesh';
import { getPublicJobStreamId } from '../public-job-stream';
import type { CmIdentityTransaction } from './cm-transaction';

const identifier = (value: string): string => {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new IdentityCustodyErrorV1('identity_material_invalid');
  return `"${value}"`;
};

/** The plan already authorizes every listed workspace; retain unrelated/shared scopes. */
export async function deleteCmBusinessWorkspaces(workspaceIds: readonly string[], tx: CmIdentityTransaction) {
  const deletedByTable: Record<string, number> = {}, detachedByTable: Record<string, number> = {};
  if (!workspaceIds.length) return { deletedByTable, detachedByTable };
  const execute = async (table: string, statement: string, values: unknown[], detach = false) => {
    const result = await tx.hostTransaction.query(statement, values);
    const counts = detach ? detachedByTable : deletedByTable;
    counts[table] = (counts[table] ?? 0) + (result.rowCount ?? 0);
  };
  const streams = new Set<string>();
  for (const [table, kinds, prefixes] of [
    ['organizations', ['organization'], ['organization']],
    ['folders', ['folder', 'executive_summary'], ['folder', 'matrix']],
    ['initiatives', ['initiative', 'usecase'], ['initiative', 'usecase']],
  ] as const) {
    const result = await tx.hostTransaction.query<{ id: string }>(`SELECT id FROM public.${table} WHERE workspace_id = ANY($1::text[])`, [workspaceIds]);
    const ids = result.rows.map(row => row.id);
    for (const id of ids) for (const prefix of prefixes) streams.add(`${prefix}_${id}`);
    await execute('context_modification_history', `DELETE FROM public.context_modification_history
      WHERE context_type = ANY($1::text[]) AND context_id = ANY($2::text[])`, [kinds, ids]);
  }
  const jobs = await tx.hostTransaction.query<{ id: string; type: string; data: string }>(
    'SELECT id, type, data FROM public.job_queue WHERE workspace_id = ANY($1::text[])', [workspaceIds]);
  for (const job of jobs.rows) {
    let data: unknown;
    try { data = JSON.parse(job.data); } catch { throw new IdentityCustodyErrorV1('identity_material_invalid'); }
    streams.add(getPublicJobStreamId({ ...job, data }));
    streams.add(`job_${job.id}`);
  }
  await execute('chat_stream_events', 'DELETE FROM public.chat_stream_events WHERE stream_id = ANY($1::text[])', [[...streams]]);
  for (const table of ['chat_sessions', 'chat_generation_traces']) {
    await execute(table, `UPDATE public.${table} SET workspace_id = NULL WHERE workspace_id = ANY($1::text[])`, [workspaceIds], true);
  }
  // PostgreSQL supplies the real dependency graph, including business tables added
  // by package assets. Delete child scopes first; restrictive cross-scope FKs refuse.
  const tables = await tx.hostTransaction.query<{ table_name: string }>(`SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND c.column_name = 'workspace_id'
    AND c.table_name NOT IN ('chat_sessions','chat_generation_traces')`);
  const remaining = new Set<string>();
  for (const { table_name: table } of tables.rows) {
    const result = await tx.hostTransaction.query(`SELECT 1 FROM public.${identifier(table)} WHERE workspace_id = ANY($1::text[]) LIMIT 1`, [workspaceIds]);
    if (result.rows.length) remaining.add(table);
  }
  const edges = await tx.hostTransaction.query<{ child: string; parent: string }>(`SELECT child.relname AS child, parent.relname AS parent
    FROM pg_constraint fk JOIN pg_class child ON child.oid = fk.conrelid JOIN pg_class parent ON parent.oid = fk.confrelid
    JOIN pg_namespace cn ON cn.oid = child.relnamespace JOIN pg_namespace pn ON pn.oid = parent.relnamespace
    WHERE fk.contype = 'f' AND cn.nspname = 'public' AND pn.nspname = 'public' AND child.oid <> parent.oid`);
  while (remaining.size) {
    const table = [...remaining].sort().find(candidate => !edges.rows.some(edge => edge.parent === candidate && remaining.has(edge.child)));
    if (!table) throw new IdentityCustodyErrorV1('identity_cascade_participant_missing');
    await execute(table, `DELETE FROM public.${identifier(table)} WHERE workspace_id = ANY($1::text[])`, [workspaceIds]);
    remaining.delete(table);
  }
  await execute('workspaces', 'DELETE FROM public.workspaces WHERE id = ANY($1::text[])', [workspaceIds]);
  for (const table of tables.rows.map(row => row.table_name)) {
    const result = await tx.hostTransaction.query(`SELECT 1 FROM public.${identifier(table)} WHERE workspace_id = ANY($1::text[]) LIMIT 1`, [workspaceIds]);
    if (result.rows.length) throw new IdentityCustodyErrorV1('identity_material_invalid');
  }
  return { deletedByTable, detachedByTable };
}
