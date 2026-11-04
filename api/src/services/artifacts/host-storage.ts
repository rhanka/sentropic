import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Pool, PoolClient } from 'pg';
import type { KvPort } from '@sentropic/artifacts/server/ports';
import { ACTIVATION_SQL_ASSET, ACTIVATION_SQL_ASSET_SHA256 } from '@sentropic/artifacts/adapters/postgres-activation';

const require = createRequire(import.meta.url);
const requiredRelations = [
  'control.artifact_host_kv', 'public.__drizzle_control_migrations',
  'artifact_host.activation_namespaces', 'artifact_host.activation_tickets', 'artifact_host.browser_flows',
  ...['storage_scopes', 'artifacts', 'releases', 'artifact_current', 'blobs', 'uploads',
    'object_intents', 'idempotency_keys', 'artifact_access', 'artifact_access_events', 'artifact_sources',
    'blob_ref_holders', 'blob_pins', 'operation_keys', 'operation_receipts', 'staged_files',
    'reader_consents', 'reader_consent_events'].map((name) => `artifacts.${name}`),
];

/** Upstream identities and bytes are pinned independently of package versions. */
export const artifactMigrationAssets = Object.freeze([
  ...[
    ['0001_artifacts.sql', '7b12713b949a956ad0b4c370a16e80fb4625a99a5097769ed0653df5973dc533'],
    ['0002_lifecycle.sql', 'fdfbe97f84774b47a207e66915f7426926650e85b6dbb9a4d80272591df624fd'],
    ['0003_coordinator.sql', '852f8d388ac3bd8bfc0b484ca55bba9ff2e3bf34b3339384732ffeda5f8f1420'],
  ].map(([name, sha256]) => {
    const id = `@sentropic/artifacts/migrations/${name}`;
    return Object.freeze({ id, sha256, read: () => readFileSync(require.resolve(id), 'utf8') });
  }),
  Object.freeze({ id: ACTIVATION_SQL_ASSET, sha256: ACTIVATION_SQL_ASSET_SHA256,
    read: () => readFileSync(require.resolve(ACTIVATION_SQL_ASSET), 'utf8') }),
  Object.freeze({ id: '@sentropic/artifacts/migrations/0004_terminal_controls.sql',
    sha256: '209d0a13fe83fab97d0407bc84a17d6b220dcc2ecdf3cef5d6b80a9885ec3555',
    read: () => readFileSync(require.resolve('@sentropic/artifacts/migrations/0004_terminal_controls.sql'), 'utf8') }),
  Object.freeze({ id: '@sentropic/artifacts/migrations/0005_metadata.sql',
    sha256: '6acd727e2c8b13a13731e190623cc0dab640fa2ed7493f0ccaa37da5b3d93e25',
    read: () => readFileSync(require.resolve('@sentropic/artifacts/migrations/0005_metadata.sql'), 'utf8') }),
  Object.freeze({ id: '@sentropic/artifacts/migrations/0006_sharing.sql',
    sha256: '038d94000a78d0bc8f47788c99763e7765f75feac6c2265963d2a8ee17a8bfba',
    read: () => readFileSync(require.resolve('@sentropic/artifacts/migrations/0006_sharing.sql'), 'utf8') }),
  Object.freeze({ id: '@sentropic/artifacts/migrations/0007_uploads.sql',
    sha256: '22c0668cd2bcc13650f733978135087e8a04c64c16f9ff307c1d6ceb88fe15b1',
    read: () => readFileSync(require.resolve('@sentropic/artifacts/migrations/0007_uploads.sql'), 'utf8') }),
  Object.freeze({ id: '@sentropic/artifacts/migrations/0008_reader_consent.sql',
    sha256: 'd6924409d318066fef028acde1566f6098d5ae8045bba89dd341bd7894c08cad',
    read: () => readFileSync(require.resolve('@sentropic/artifacts/migrations/0008_reader_consent.sql'), 'utf8') }),
]);

/** Called only by the API migration runner, after the control stream. */
export async function installArtifactPackageAssets(
  connection: Pool | PoolClient,
  load: (id: string) => string = (id) => migrations.find((asset) => asset.id === id)!.read(),
  migrations: readonly { id: string; sha256: string; read: () => string }[] = artifactMigrationAssets,
): Promise<void> {
  // Validate every file before acquiring a connection or executing any asset.
  const assets = migrations.map((asset) => {
    const source = load(asset.id);
    if (createHash('sha256').update(source).digest('hex') !== asset.sha256) {
      throw new Error(`Artifact migration asset hash mismatch: ${asset.id}`);
    }
    return { ...asset, source };
  });
  const ownsClient = !('release' in connection);
  const client = 'release' in connection ? connection : await connection.connect();
  let discard: Error | undefined;
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('sentropic:artifact-package-migrations'))`);
    const { rows } = await client.query<{ asset_id: string; sha256: string }>(
      'SELECT asset_id, hash AS sha256 FROM public.__drizzle_control_migrations WHERE asset_id IS NOT NULL',
    );
    if (!rows.length) {
      const schema = await client.query(`SELECT to_regnamespace('artifacts') AS namespace`);
      if (schema.rows[0].namespace !== null) throw new Error('Untracked artifact schema requires migration reconciliation');
    }
    for (const row of rows) {
      if (assets.find((asset) => asset.id === row.asset_id)?.sha256 !== row.sha256) {
        throw new Error(`Artifact migration journal hash mismatch: ${row.asset_id}`);
      }
    }
    const applied = new Set(rows.map((row) => row.asset_id));
    // Receipts must form a prefix: trailing assets are upgrades, interior gaps are restore damage.
    const firstPending = assets.findIndex((asset) => !applied.has(asset.id));
    if (firstPending !== -1 && assets.slice(firstPending).some((asset) => applied.has(asset.id))) {
      throw new Error('Missing artifact migration receipt requires migration reconciliation');
    }
    for (const [index, asset] of assets.entries()) {
      if (applied.has(asset.id)) continue;
      await client.query(asset.source);
      await client.query(
        // Negative positions cannot advance Drizzle's positive timestamp frontier.
        'INSERT INTO public.__drizzle_control_migrations (asset_id, hash, created_at) VALUES ($1, $2, $3)',
        [asset.id, asset.sha256, -(index + 1)],
      );
    }
    const missing = await client.query<{ name: string }>(
      'SELECT name FROM unnest($1::text[]) AS name WHERE to_regclass(name) IS NULL',
      [requiredRelations],
    );
    if (missing.rows.length) throw new Error(`Missing artifact relation: ${missing.rows.map((row) => row.name).join(', ')}`);
    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollback) {
      discard = rollback instanceof Error ? rollback : new Error(String(rollback));
      throw new AggregateError([error, rollback], 'Artifact migration and rollback failed');
    }
    throw error;
  } finally {
    if (ownsClient) client.release(discard);
  }
}

/** The host supplies a trusted opaque scope; caller keys cannot cross it. */
export function createArtifactHostKv(pool: Pool, storageScopeId: string): KvPort {
  if (!storageScopeId) throw new Error('Artifact host KV requires a storage scope');
  return {
    async get(key) {
      const { rows } = await pool.query<{ value: string }>(
        'SELECT value FROM control.artifact_host_kv WHERE storage_scope_id = $1 AND key = $2',
        [storageScopeId, key],
      );
      return rows[0]?.value;
    },
    async putIfAbsent(key, value) {
      const result = await pool.query(
        `INSERT INTO control.artifact_host_kv (storage_scope_id, key, value) VALUES ($1, $2, $3)
         ON CONFLICT (storage_scope_id, key) DO NOTHING RETURNING key`,
        [storageScopeId, key, value],
      );
      return result.rowCount === 1;
    },
  };
}
