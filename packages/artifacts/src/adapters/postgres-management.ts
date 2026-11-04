import type { FinalizeTxClient } from '../server/commit/types.js';
import { applyModeTransition, PLATFORM_PRINCIPAL, PUBLIC_PRINCIPAL,
  type AccessEvent, type AccessMode, type ArtifactAcl, type GrantRecord } from '../server/access.js';
import type { ManagementUnit, SetAccessOutput } from '../server/management.js';

/** Parent lock serializes ACL inserts, lifecycle changes and publication FKs. */
export function createPostgresManagementUnit(client: FinalizeTxClient): ManagementUnit {
  const listGrants = async (id: string): Promise<GrantRecord[]> => {
    const { rows } = await client.query<{ principal_id: string; permission: GrantRecord['grant']; created_at: Date }>(
      'SELECT principal_id, permission, created_at FROM artifacts.artifact_access WHERE artifact_id = $1 ORDER BY principal_id', [id]);
    return rows.map((row) => ({ principalId: row.principal_id, grant: row.permission,
      createdAt: row.created_at.toISOString() }));
  };
  return {
    async lock(id) {
      await client.query('SELECT id FROM artifacts.artifacts WHERE id = $1 FOR UPDATE', [id]);
      await client.query('SELECT principal_id FROM artifacts.artifact_access WHERE artifact_id = $1 ORDER BY principal_id FOR UPDATE', [id]);
      await client.query('SELECT release_id FROM artifacts.artifact_current WHERE artifact_id = $1 FOR UPDATE', [id]);
    },
    async read(id) {
      const { rows } = await client.query<{ owner_id: string; storage_scope_id: string; lifecycle_state: string;
        is_public: boolean; access_mode: string | null; terminal_deleted_at: unknown; release_id: string | null }>(
        `SELECT a.owner_id, a.storage_scope_id, a.lifecycle_state, a.is_public, a.access_mode, a.terminal_deleted_at, c.release_id
         FROM artifacts.artifacts a LEFT JOIN artifacts.artifact_current c ON c.artifact_id = a.id WHERE a.id = $1`, [id]);
      const row = rows[0];
      if (!row) return undefined;
      // G1: access_mode is authoritative; is_public is its legacy projection.
      const accessMode = (row.access_mode ?? (row.is_public ? 'platform' : 'restricted')) as AccessMode;
      const acl: ArtifactAcl = { ownerId: row.owner_id, storageScopeId: row.storage_scope_id,
        isPublic: accessMode !== 'restricted', accessMode, withdrawn: row.lifecycle_state === 'withdrawn', grants: [] };
      return { acl, state: row.lifecycle_state, terminal: row.terminal_deleted_at !== null,
        currentReleaseId: row.release_id };
    },
    async setAccess(id, principalId, action, updatedAt): Promise<SetAccessOutput> {
      const modeRow = await client.query<{ access_mode: string | null; is_public: boolean }>(
        'SELECT access_mode, is_public FROM artifacts.artifacts WHERE id = $1', [id]);
      const current = (modeRow.rows[0] === undefined ? 'restricted'
        : (modeRow.rows[0].access_mode ?? (modeRow.rows[0].is_public ? 'platform' : 'restricted'))) as AccessMode;
      if (principalId === PLATFORM_PRINCIPAL || principalId === PUBLIC_PRINCIPAL) {
        // Wide-audience sentinels move the mode through the normative transitions;
        // is_public follows as projection (never forced to false).
        const transition = applyModeTransition(current, action, principalId);
        if (transition.changed) {
          await client.query(
            `UPDATE artifacts.artifacts SET access_mode = $2, is_public = ($2 <> 'restricted'), updated_at = $3 WHERE id = $1`,
            [id, transition.mode, updatedAt]);
        }
        return { grants: await listGrants(id), updatedAt, accessMode: transition.mode, changed: transition.changed };
      }
      const changed = action === 'grant' ? await client.query(
        `INSERT INTO artifacts.artifact_access (artifact_id, principal_id, permission) VALUES ($1, $2, 'read')
         ON CONFLICT (artifact_id, principal_id) DO NOTHING`, [id, principalId])
        : await client.query('DELETE FROM artifacts.artifact_access WHERE artifact_id = $1 AND principal_id = $2', [id, principalId]);
      if (changed.rowCount > 0) {
        await client.query('UPDATE artifacts.artifacts SET updated_at = $2 WHERE id = $1', [id, updatedAt]);
      }
      const stamp = await client.query<{ updated_at: Date | null }>('SELECT updated_at FROM artifacts.artifacts WHERE id = $1', [id]);
      return { grants: await listGrants(id), updatedAt: stamp.rows[0]?.updated_at?.toISOString() ?? null,
        accessMode: current, changed: changed.rowCount > 0 };
    },
    async recordEvent(event: AccessEvent) {
      await client.query(
        `INSERT INTO artifacts.artifact_access_events (artifact_id, actor_id, action, audience, principal_id, policy_revision)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [event.artifactId, event.actorId, event.action, event.audience, event.principalId, event.policyRevision]);
    },
    async delete(id, deletedAt) {
      await client.query(`UPDATE artifacts.artifacts SET lifecycle_state = 'deleted', terminal_deleted_at = $2,
        updated_at = $2 WHERE id = $1`, [id, deletedAt]);
    },
  };
}
