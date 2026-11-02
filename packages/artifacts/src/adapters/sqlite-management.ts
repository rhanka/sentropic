/**
 * U1 — SQLite management unit, same ManagementUnit port as
 * `createPostgresManagementUnit`. Runs on the caller's finalization client
 * (inside the serialized writer transaction), so the pg FOR UPDATE row locks
 * are unnecessary: the parent lock is the writer mutex itself.
 */
import type { FinalizeTxClient } from '../server/commit/types.js';
import type { ArtifactAcl } from '../server/access.js';
import type { ManagementUnit } from '../server/management.js';

/** Parent lock serializes ACL inserts, lifecycle changes and publication FKs. */
export function createSqliteManagementUnit(client: FinalizeTxClient): ManagementUnit {
  return {
    async lock(id) {
      await client.query('SELECT id FROM artifacts WHERE id = $1', [id]);
      await client.query('SELECT principal_id FROM artifact_access WHERE artifact_id = $1 ORDER BY principal_id', [id]);
      await client.query('SELECT release_id FROM artifact_current WHERE artifact_id = $1', [id]);
    },
    async read(id) {
      const { rows } = await client.query<{ owner_id: string; storage_scope_id: string; lifecycle_state: string;
        is_public: number; terminal_deleted_at: string | null; release_id: string | null }>(
        `SELECT a.owner_id, a.storage_scope_id, a.lifecycle_state, a.is_public, a.terminal_deleted_at, c.release_id
         FROM artifacts a LEFT JOIN artifact_current c ON c.artifact_id = a.id WHERE a.id = $1`, [id]);
      const row = rows[0];
      if (!row) return undefined;
      const acl: ArtifactAcl = { ownerId: row.owner_id, storageScopeId: row.storage_scope_id,
        isPublic: row.is_public === 1, withdrawn: row.lifecycle_state === 'withdrawn', grants: [] };
      return { acl, state: row.lifecycle_state, terminal: row.terminal_deleted_at !== null,
        currentReleaseId: row.release_id };
    },
    async setAccess(id, principalId, action, updatedAt) {
      const changed = action === 'grant' ? await client.query(
        `INSERT INTO artifact_access (artifact_id, principal_id, permission) VALUES ($1, $2, 'read')
         ON CONFLICT (artifact_id, principal_id) DO NOTHING`, [id, principalId])
        : await client.query('DELETE FROM artifact_access WHERE artifact_id = $1 AND principal_id = $2', [id, principalId]);
      await client.query(`UPDATE artifacts SET is_public = 0, updated_at = $2
        WHERE id = $1 AND ($3 <> 0 OR is_public <> 0)`, [id, updatedAt, changed.rowCount > 0 ? 1 : 0]);
      const result = await client.query<{ principal_id: string; permission: string }>(
        'SELECT principal_id, permission FROM artifact_access WHERE artifact_id = $1 ORDER BY principal_id', [id]);
      const stamp = await client.query<{ updated_at: string | null }>('SELECT updated_at FROM artifacts WHERE id = $1', [id]);
      return { grants: result.rows.map((row) => ({ principalId: row.principal_id, grant: row.permission })),
        updatedAt: stamp.rows[0]?.updated_at ?? null };
    },
    async delete(id, deletedAt) {
      await client.query(`UPDATE artifacts SET lifecycle_state = 'deleted', terminal_deleted_at = $2,
        updated_at = $2, is_public = 0 WHERE id = $1`, [id, deletedAt]);
    },
  };
}
