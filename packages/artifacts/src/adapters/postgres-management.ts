import type { FinalizeTxClient } from '../server/commit/types.js';
import type { ArtifactAcl } from '../server/access.js';
import type { ManagementUnit } from '../server/management.js';

/** Parent lock serializes ACL inserts, lifecycle changes and publication FKs. */
export function createPostgresManagementUnit(client: FinalizeTxClient): ManagementUnit {
  return {
    async lock(id) {
      await client.query('SELECT id FROM artifacts.artifacts WHERE id = $1 FOR UPDATE', [id]);
      await client.query('SELECT principal_id FROM artifacts.artifact_access WHERE artifact_id = $1 ORDER BY principal_id FOR UPDATE', [id]);
      await client.query('SELECT release_id FROM artifacts.artifact_current WHERE artifact_id = $1 FOR UPDATE', [id]);
    },
    async read(id) {
      const { rows } = await client.query<{ owner_id: string; storage_scope_id: string; lifecycle_state: string;
        is_public: boolean; terminal_deleted_at: unknown; release_id: string | null }>(
        `SELECT a.owner_id, a.storage_scope_id, a.lifecycle_state, a.is_public, a.terminal_deleted_at, c.release_id
         FROM artifacts.artifacts a LEFT JOIN artifacts.artifact_current c ON c.artifact_id = a.id WHERE a.id = $1`, [id]);
      const row = rows[0];
      if (!row) return undefined;
      const acl: ArtifactAcl = { ownerId: row.owner_id, storageScopeId: row.storage_scope_id,
        isPublic: row.is_public, withdrawn: row.lifecycle_state === 'withdrawn', grants: [] };
      return { acl, state: row.lifecycle_state, terminal: row.terminal_deleted_at !== null,
        currentReleaseId: row.release_id };
    },
    async setAccess(id, principalId, action, updatedAt) {
      if (action === 'grant') await client.query(
        `INSERT INTO artifacts.artifact_access (artifact_id, principal_id, permission) VALUES ($1, $2, 'read')
         ON CONFLICT (artifact_id, principal_id) DO NOTHING`, [id, principalId]);
      else await client.query('DELETE FROM artifacts.artifact_access WHERE artifact_id = $1 AND principal_id = $2', [id, principalId]);
      await client.query('UPDATE artifacts.artifacts SET is_public = false, updated_at = $2 WHERE id = $1', [id, updatedAt]);
      const result = await client.query<{ principal_id: string; permission: string }>(
        'SELECT principal_id, permission FROM artifacts.artifact_access WHERE artifact_id = $1 ORDER BY principal_id', [id]);
      return result.rows.map((row) => ({ principalId: row.principal_id, grant: row.permission }));
    },
    async delete(id, deletedAt) {
      await client.query(`UPDATE artifacts.artifacts SET lifecycle_state = 'deleted', terminal_deleted_at = $2,
        updated_at = $2, is_public = false WHERE id = $1`, [id, deletedAt]);
    },
  };
}
