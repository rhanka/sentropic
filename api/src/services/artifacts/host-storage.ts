import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { Pool, PoolClient } from 'pg';
import type { KvPort } from '@sentropic/artifacts/server/ports';

const require = createRequire(import.meta.url);

/** Upstream identities and bytes are pinned independently of package versions. */
export const artifactMigrationAssets = Object.freeze([
  // Own journal: advancing Drizzle's frontier here would skip #677's pending 0012–0019.
  Object.freeze({
    id: '@sentropic/app/control/0020_app_artifact_host.sql',
    sha256: '4f761972850c0cbceee2630c72cd8919483ac525a6f45ce5e7f40dd0aedc128e',
    read: () => readFileSync(resolve('drizzle/control/0020_app_artifact_host.sql'), 'utf8'),
  }),
  ...[
    ['0001_artifacts.sql', '7b12713b949a956ad0b4c370a16e80fb4625a99a5097769ed0653df5973dc533'],
    ['0002_lifecycle.sql', 'fdfbe97f84774b47a207e66915f7426926650e85b6dbb9a4d80272591df624fd'],
    ['0003_coordinator.sql', '852f8d388ac3bd8bfc0b484ca55bba9ff2e3bf34b3339384732ffeda5f8f1420'],
  ].map(([name, sha256]) => {
    const id = `@sentropic/artifacts/migrations/${name}`;
    return Object.freeze({ id, sha256, read: () => readFileSync(require.resolve(id), 'utf8') });
  }),
]);

/** Called only by the API migration runner, after the control stream. */
export async function installArtifactPackageAssets(
  connection: Pool | PoolClient,
  load: (id: string) => string = (id) => artifactMigrationAssets.find((asset) => asset.id === id)!.read(),
): Promise<void> {
  // Validate every file before acquiring a connection or executing any asset.
  const assets = artifactMigrationAssets.map((asset) => {
    const source = load(asset.id);
    if (createHash('sha256').update(source).digest('hex') !== asset.sha256) {
      throw new Error(`Artifact migration asset hash mismatch: ${asset.id}`);
    }
    return { ...asset, source };
  });
  const ownsClient = !('release' in connection);
  const client = 'release' in connection ? connection : await connection.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('sentropic:artifact-package-migrations'))`);
    const journal = await client.query(`SELECT to_regclass('control.artifact_package_migrations') AS relation`);
    const fresh = journal.rows[0].relation === null;
    if (fresh) {
      const schema = await client.query(`SELECT to_regnamespace('artifacts') AS namespace`);
      if (schema.rows[0].namespace !== null) throw new Error('Untracked artifact schema requires migration reconciliation');
      await client.query(assets[0].source);
      await client.query(
        'INSERT INTO control.artifact_package_migrations (asset_id, sha256) VALUES ($1, $2)',
        [assets[0].id, assets[0].sha256],
      );
    }
    const { rows } = await client.query<{ asset_id: string; sha256: string }>(
      'SELECT asset_id, sha256 FROM control.artifact_package_migrations',
    );
    for (const row of rows) {
      if (assets.find((asset) => asset.id === row.asset_id)?.sha256 !== row.sha256) {
        throw new Error(`Artifact migration journal hash mismatch: ${row.asset_id}`);
      }
    }
    const applied = new Set(rows.map((row) => row.asset_id));
    // This frozen batch commits atomically. Partial receipts require restore reconciliation.
    if (!fresh && assets.some((asset) => !applied.has(asset.id))) {
      throw new Error('Missing artifact migration receipt requires migration reconciliation');
    }
    for (const asset of assets) {
      if (applied.has(asset.id)) continue;
      await client.query(asset.source);
      await client.query(
        'INSERT INTO control.artifact_package_migrations (asset_id, sha256) VALUES ($1, $2)',
        [asset.id, asset.sha256],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    if (ownsClient) client.release();
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
