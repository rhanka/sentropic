import type { PoolClient } from 'pg';
import { identityCustodySchemaAssetV1 } from '@sentropic/cluster-mesh';
import { connectorCustodyAssetSha256 } from '../services/identity/cm-connector-custody-values';
import { a4MappingAssetSha256 } from '../services/identity/cm-import-manifest';
import { mapA4IdentitySource, readA4IdentitySource } from '../services/identity/cm-import-source';
import { loadA4RemoteSnapshot, reconcileA4RemoteSnapshot } from '../services/identity/cm-import-remote-snapshot';
import { getWebAuthnConfig } from '../services/webauthn-config';
import { canonical, custody, protectedBytes, sha256, type PreprodRequest } from './cm-preprod-contract';

/** No DDL, journal writes, receipt payloads, or SQL identity rows leave this connection. */
export async function inspectPreprod(client: PoolClient, request: PreprodRequest) {
  const remotePath = `${custody}/remote.json`;
  const remoteBytes = await protectedBytes(remotePath, 64 * 1024 * 1024);
  if (sha256(remoteBytes) !== request.remoteSnapshotDigest) throw new Error('remote_digest_mismatch');
  const remote = await loadA4RemoteSnapshot(remotePath);
  const rp = getWebAuthnConfig();
  const verifier = { rpId: rp.rpID, origins: typeof rp.origin === 'string' ? [rp.origin] : [...rp.origin] };
  if (verifier.rpId !== 'preprod.sentropic.sent-tech.ca'
    || canonical(verifier.origins) !== '["https://preprod.sentropic.sent-tech.ca"]') throw new Error('wrong_verifier');
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    await client.query("SET LOCAL statement_timeout = '30000'");
    await client.query("SET LOCAL lock_timeout = '5000'");
    const journals: Record<string, unknown> = {};
    for (const table of ['drizzle.__drizzle_migrations', 'public.__drizzle_control_migrations',
      'control.app_cm_identity_cutover', 'cm_identity.identity_import_receipts']) {
      const relation = await client.query('SELECT to_regclass($1) AS relation', [table]);
      if (!relation.rows[0]?.relation) { journals[table] = null; continue; }
      if (table.endsWith('migrations')) {
        const result = await client.query(`SELECT hash, created_at::text FROM ${table} ORDER BY created_at, hash`);
        journals[table] = result.rows;
        if (table === 'public.__drizzle_control_migrations'
          && result.rows.some(row => row.created_at === '1793577600000')) throw new Error('already_cut_over');
      } else {
        const result = await client.query(`SELECT count(*)::int AS count FROM ${table}`);
        if (result.rows[0]?.count !== 0) throw new Error('prior_cutover_evidence');
        journals[table] = { count: 0 };
      }
    }
    const schema = await client.query(`SELECT table_schema, table_name, column_name, ordinal_position,
      data_type, udt_name, is_nullable, column_default FROM information_schema.columns
      WHERE table_schema IN ('public', 'control', 'cm_identity', 'drizzle')
      ORDER BY table_schema, table_name, ordinal_position`);
    const constraints = await client.query(`SELECT n.nspname, c.relname, x.conname, pg_get_constraintdef(x.oid) AS definition
      FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('public','control','cm_identity') ORDER BY n.nspname,c.relname,x.conname`);
    const source = await readA4IdentitySource(client, true);
    const importedAt = new Date().toISOString();
    await mapA4IdentitySource(source, { ...verifier, importedAt });
    reconcileA4RemoteSnapshot(source.rows.get('user_sessions') ?? [], remote, importedAt);
    const rows = Object.fromEntries([...source.rows].map(([table, values]) => [table,
      values.map(value => canonical(value)).sort()]));
    return {
      sourceContentSha256: sha256(canonical({ rows, inventory: source.inventory })),
      schemaSha256: sha256(canonical({ columns: schema.rows, constraints: constraints.rows })),
      journalSha256: sha256(canonical(journals)), remoteSnapshotDigest: sha256(remoteBytes),
      mappingSha256: a4MappingAssetSha256(verifier),
      identityAssetSha256: identityCustodySchemaAssetV1('postgres').assetSha256,
      connectorAssetSha256: connectorCustodyAssetSha256,
    };
  } finally { await client.query('ROLLBACK'); }
}
