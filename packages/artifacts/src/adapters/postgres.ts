/**
 * L-5b — Postgres adapter, part 1: stable bindings (spec-v8 §9).
 *
 * Over an injected pg Pool: no eager connections, no api/src imports, no DDL at
 * runtime (the host applies `migrations/0001_artifacts.sql`). Concurrent ensures
 * converge via INSERT ... ON CONFLICT DO NOTHING + reread. Parts 2-3 add
 * intents, state promotion, idempotency and blob registration.
 */
import type { Pool } from 'pg';
import type { JsonValue } from '../contracts.js';
import type { AccessGrant, AclStore, ArtifactAcl } from '../server/access.js';
import type { RefcountStore } from '../server/gc.js';
import type { ArtifactState, LifecycleStore, ReleaseState } from '../server/lifecycle.js';
import type { SourceRef, SourceStore } from '../server/sources.js';
import type { IntentKind, PreparationIntentStore, ObjectIntent } from '../server/object-intents.js';
import type { IdempotencyStore, IdempotentResult } from '../server/idempotency.js';
import type { PublicationStateStore, ReleaseRecord } from '../server/publication.js';
import type { KvPort } from '../server/ports.js';

/** Read-only migration inventory. Never promotes a legacy success into an authorized receipt. */
export function createPostgresLegacyArtifactRecords(pool: Pool): Pick<KvPort, 'get'> {
  return {
    async get(key) {
      const { rows } = await pool.query<{ params_hash: string; result: unknown }>(
        'SELECT params_hash, result FROM artifacts.idempotency_keys WHERE key = $1', [key],
      );
      return rows[0] === undefined ? undefined : JSON.stringify(rows[0]);
    },
  };
}

export interface ArtifactBindingInput {
  storageScopeId: string;
  ownerId: string;
  bindingName: string;
  profile: Record<string, JsonValue | undefined>;
}

export interface ArtifactBinding {
  artifactId: string;
  created: boolean;
}

export interface PostgresArtifactBasics extends PreparationIntentStore {
  ensureArtifact(input: ArtifactBindingInput): Promise<ArtifactBinding>;
}

export interface PostgresArtifactStore
  extends PostgresArtifactBasics,
    PublicationStateStore,
    IdempotencyStore,
    AclStore,
    SourceStore,
    LifecycleStore,
    RefcountStore {
  listRegisteredBlobs(storageScopeId: string): Promise<string[]>;
}

interface IntentRow {
  id: string;
  kind: IntentKind;
  state: 'pending' | 'done' | 'failed';
  payload: Record<string, JsonValue | undefined>;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}

function toIntent(row: IntentRow): ObjectIntent {
  return {
    intentId: row.id,
    kind: row.kind,
    state: row.state,
    payload: row.payload,
    error: row.error ?? undefined,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

interface ReleaseRow {
  id: string;
  artifact_id: string;
  manifest_digest: string;
  manifest: string;
  state: 'ready';
  created_at: Date;
}

function toRelease(row: ReleaseRow): ReleaseRecord {
  return {
    releaseId: row.id,
    artifactId: row.artifact_id,
    manifestDigest: row.manifest_digest,
    manifest: row.manifest,
    state: row.state,
    createdAt: row.created_at.toISOString(),
  };
}

/** Create the Postgres-backed store over an injected pool (no DDL). */
export function createPostgresArtifactStore(pool: Pool): PostgresArtifactStore {
  return {
    async ensureArtifact(input: ArtifactBindingInput): Promise<ArtifactBinding> {
      const where = `WHERE storage_scope_id = $1 AND owner_id = $2 AND binding_name = $3`;
      const args = [input.storageScopeId, input.ownerId, input.bindingName];
      const found = await pool.query<{ id: string }>(
        `SELECT id FROM artifacts.artifacts ${where}`,
        args,
      );
      if (found.rowCount !== 0 && found.rows[0] !== undefined) {
        return { artifactId: found.rows[0].id, created: false };
      }
      const inserted = await pool.query<{ id: string }>(
        `INSERT INTO artifacts.artifacts (id, storage_scope_id, owner_id, binding_name, profile)
         VALUES (gen_random_uuid(), $1, $2, $3, $4)
         ON CONFLICT (storage_scope_id, owner_id, binding_name) DO NOTHING RETURNING id`,
        [...args, input.profile],
      );
      if (inserted.rowCount !== 0 && inserted.rows[0] !== undefined) {
        return { artifactId: inserted.rows[0].id, created: true };
      }
      const raced = await pool.query<{ id: string }>(
        `SELECT id FROM artifacts.artifacts ${where}`,
        args,
      );
      const row = raced.rows[0];
      if (row === undefined) throw new Error(`artifact binding lost for ${input.bindingName}`);
      return { artifactId: row.id, created: false };
    },
    async record(
      kind: IntentKind,
      payload: Record<string, JsonValue | undefined>,
    ): Promise<ObjectIntent> {
      const { rows } = await pool.query<IntentRow>(
        `INSERT INTO artifacts.object_intents (id, kind, payload)
         VALUES (gen_random_uuid(), $1, $2)
         RETURNING id, kind, state, payload, error, created_at, updated_at`,
        [kind, payload],
      );
      const row = rows[0];
      if (row === undefined) throw new Error('intent insert failed');
      return toIntent(row);
    },
    async complete(intentId: string): Promise<void> {
      const done = await pool.query(
        `UPDATE artifacts.object_intents SET state = 'done', updated_at = now() WHERE id = $1`,
        [intentId],
      );
      if (done.rowCount === 0) throw new Error(`unknown intent: ${intentId}`);
    },
    async markFailed(intentId: string, error: string): Promise<void> {
      const failed = await pool.query(
        `UPDATE artifacts.object_intents SET state = 'failed', error = $2, updated_at = now() WHERE id = $1`,
        [intentId, error],
      );
      if (failed.rowCount === 0) throw new Error(`unknown intent: ${intentId}`);
    },
    async get(intentId: string): Promise<ObjectIntent | undefined> {
      const { rows } = await pool.query<IntentRow>(
        `SELECT id, kind, state, payload, error, created_at, updated_at
         FROM artifacts.object_intents WHERE id = $1`,
        [intentId],
      );
      const row = rows[0];
      return row === undefined ? undefined : toIntent(row);
    },
    async listPending(): Promise<ObjectIntent[]> {
      const { rows } = await pool.query<IntentRow>(
        `SELECT id, kind, state, payload, error, created_at, updated_at
         FROM artifacts.object_intents WHERE state = 'pending' ORDER BY created_at`,
      );
      return rows.map(toIntent);
    },
    async listPreparationIntents() {
      const { rows } = await pool.query<IntentRow>(
        `SELECT * FROM artifacts.object_intents WHERE kind = 'commit-release'
         AND payload ? 'cleanupDeadlineMs' ORDER BY created_at, id`);
      return rows.map(toIntent);
    },
    async claimPreparationCleanup(intentId, throughMs) {
      // This UPDATE serializes with finalization's intent completion on the same row.
      const { rows } = await pool.query<IntentRow>(
        `UPDATE artifacts.object_intents SET state = 'failed',
           error = COALESCE(error, 'preparation expired; explicit retry required'), updated_at = now()
         WHERE id = $1 AND kind = 'commit-release' AND state <> 'done'
           AND (payload->>'cleanupDeadlineMs')::numeric <= $2 RETURNING *`,
        [intentId, throughMs]);
      return rows[0] === undefined ? undefined : toIntent(rows[0]);
    },
    async settlePreparationCleanup(intentId) {
      const { rowCount } = await pool.query(
        `UPDATE artifacts.object_intents SET payload = payload || '{"cleanupState":"failed-cleaned"}'::jsonb,
           updated_at = now() WHERE id = $1 AND state = 'failed'`, [intentId]);
      if (rowCount === 0) throw new Error('cleanup needs a failed preparation');
    },
    async putRelease(release: ReleaseRecord): Promise<void> {
      const parsed = JSON.parse(release.manifest) as {
        files?: { digest?: unknown; size?: unknown }[];
      };
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO artifacts.releases (id, artifact_id, manifest_digest, manifest, state, created_at)
           VALUES ($1, $2, $3, $4, 'ready', $5)`,
          [release.releaseId, release.artifactId, release.manifestDigest, release.manifest, release.createdAt],
        );
        const scope = await client.query<{ storage_scope_id: string }>(
          `SELECT storage_scope_id FROM artifacts.artifacts WHERE id = $1`,
          [release.artifactId],
        );
        const scopeId = scope.rows[0]?.storage_scope_id;
        if (scopeId === undefined) throw new Error(`unknown artifact: ${release.artifactId}`);
        for (const file of parsed.files ?? []) {
          if (typeof file.digest !== 'string' || typeof file.size !== 'number') continue;
          await client.query(
            `INSERT INTO artifacts.blobs (storage_scope_id, digest, size)
             VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
            [scopeId, file.digest, file.size],
          );
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async getRelease(releaseId: string): Promise<ReleaseRecord | undefined> {
      const { rows } = await pool.query<ReleaseRow>(
        `SELECT id, artifact_id, manifest_digest, manifest, state, created_at
         FROM artifacts.releases WHERE id = $1`,
        [releaseId],
      );
      const row = rows[0];
      return row === undefined ? undefined : toRelease(row);
    },
    async getCurrentReleaseId(artifactId: string): Promise<string | undefined> {
      const { rows } = await pool.query<{ release_id: string }>(
        `SELECT release_id FROM artifacts.artifact_current WHERE artifact_id = $1`,
        [artifactId],
      );
      return rows[0]?.release_id;
    },
    async compareAndSwapCurrent(
      artifactId: string,
      expected: string | null,
      next: string,
    ): Promise<boolean> {
      if (expected === null) {
        const inserted = await pool.query(
          `INSERT INTO artifacts.artifact_current (artifact_id, release_id)
           VALUES ($1, $2) ON CONFLICT (artifact_id) DO NOTHING`,
          [artifactId, next],
        );
        return (inserted.rowCount ?? 0) !== 0;
      }
      const updated = await pool.query(
        `UPDATE artifacts.artifact_current SET release_id = $3
         WHERE artifact_id = $1 AND release_id = $2`,
        [artifactId, expected, next],
      );
      return (updated.rowCount ?? 0) !== 0;
    },
    async execute<T>(
      key: string,
      paramsHash: string,
      work: () => Promise<T>,
    ): Promise<IdempotentResult<T>> {
      const found = await pool.query<{ params_hash: string; result: T }>(
        `SELECT params_hash, result FROM artifacts.idempotency_keys WHERE key = $1`,
        [`idempotency:${key}`],
      );
      const stored = found.rows[0];
      if (stored !== undefined) {
        if (stored.params_hash !== paramsHash) {
          throw new Error(`idempotency conflict: key ${key} already used with different parameters`);
        }
        return { result: stored.result, replayed: true };
      }
      const result = await work();
      const inserted = await pool.query(
        `INSERT INTO artifacts.idempotency_keys (key, params_hash, result)
         VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING RETURNING key`,
        [`idempotency:${key}`, paramsHash, JSON.stringify(result)],
      );
      if ((inserted.rowCount ?? 0) !== 0) return { result, replayed: false };
      const raced = await pool.query<{ params_hash: string; result: T }>(
        `SELECT params_hash, result FROM artifacts.idempotency_keys WHERE key = $1`,
        [`idempotency:${key}`],
      );
      const winner = raced.rows[0];
      if (winner === undefined) throw new Error(`idempotency record lost for ${key}`);
      if (winner.params_hash !== paramsHash) {
        throw new Error(`idempotency conflict: key ${key} already used with different parameters`);
      }
      return { result: winner.result, replayed: true };
    },
    async listRegisteredBlobs(storageScopeId: string): Promise<string[]> {
      const { rows } = await pool.query<{ digest: string }>(
        `SELECT digest FROM artifacts.blobs WHERE storage_scope_id = $1 ORDER BY digest`,
        [storageScopeId],
      );
      return rows.map((row) => row.digest);
    },
    async getArtifactAcl(artifactId: string): Promise<ArtifactAcl | undefined> {
      const { rows } = await pool.query<{
        owner_id: string;
        storage_scope_id: string;
        is_public: boolean;
        lifecycle_state: ArtifactState;
      }>(
        `SELECT owner_id, storage_scope_id, is_public, lifecycle_state
         FROM artifacts.artifacts WHERE id = $1`,
        [artifactId],
      );
      const row = rows[0];
      if (row === undefined) return undefined;
      const grants = await pool.query<{ principal_id: string; permission: AccessGrant }>(
        `SELECT principal_id, permission FROM artifacts.artifact_access
         WHERE artifact_id = $1 ORDER BY principal_id`,
        [artifactId],
      );
      return {
        ownerId: row.owner_id,
        storageScopeId: row.storage_scope_id,
        isPublic: row.is_public,
        withdrawn: row.lifecycle_state === 'withdrawn',
        grants: grants.rows.map((grant) => ({
          principalId: grant.principal_id,
          grant: grant.permission,
        })),
      };
    },
    async putArtifactAcl(artifactId: string, acl: ArtifactAcl): Promise<void> {
      await pool.query(
        `UPDATE artifacts.artifacts SET is_public = $2,
         lifecycle_state = CASE WHEN $3 THEN 'withdrawn'
           WHEN lifecycle_state = 'withdrawn' THEN 'active'
           ELSE lifecycle_state END
         WHERE id = $1`,
        [artifactId, acl.isPublic, acl.withdrawn],
      );
      await pool.query(`DELETE FROM artifacts.artifact_access WHERE artifact_id = $1`, [
        artifactId,
      ]);
      for (const grant of acl.grants) {
        await pool.query(
          `INSERT INTO artifacts.artifact_access (artifact_id, principal_id, permission)
           VALUES ($1, $2, $3)`,
          [artifactId, grant.principalId, grant.grant],
        );
      }
    },
    async listArtifactIds(): Promise<string[]> {
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM artifacts.artifacts ORDER BY created_at ASC, id ASC`,
      );
      return rows.map((row) => row.id);
    },
    async getSource(artifactId: string): Promise<SourceRef | undefined> {
      const { rows } = await pool.query<{
        kind: string;
        commit_tx: string | null;
        steps: unknown;
      }>(
        `SELECT kind, commit_tx, steps FROM artifacts.artifact_sources WHERE artifact_id = $1`,
        [artifactId],
      );
      const row = rows[0];
      if (row === undefined) return undefined;
      if (row.kind === 'inline-original') return { kind: 'inline-original' };
      if (row.kind === 'base-commit') {
        return { kind: 'base-commit', commit: row.commit_tx ?? '' };
      }
      if (row.kind === 'recipe') {
        return {
          kind: 'recipe',
          steps: Array.isArray(row.steps) ? row.steps.map((step) => String(step)) : [],
        };
      }
      throw new Error(`unknown source kind: ${row.kind}`);
    },
    async putSource(artifactId: string, source: SourceRef): Promise<void> {
      const commit = source.kind === 'base-commit' ? source.commit : null;
      const steps = source.kind === 'recipe' ? JSON.stringify(source.steps) : null;
      await pool.query(
        `INSERT INTO artifacts.artifact_sources (artifact_id, kind, commit_tx, steps)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (artifact_id) DO UPDATE
         SET kind = EXCLUDED.kind, commit_tx = EXCLUDED.commit_tx, steps = EXCLUDED.steps`,
        [artifactId, source.kind, commit, steps],
      );
    },
    async register(artifactId: string, ownerId: string): Promise<void> {
      const { rows } = await pool.query<{ owner_id: string }>(
        `SELECT owner_id FROM artifacts.artifacts WHERE id = $1`,
        [artifactId],
      );
      const row = rows[0];
      if (row === undefined) throw new Error(`unknown artifact: ${artifactId}`);
      if (row.owner_id !== ownerId) throw new Error(`owner mismatch for ${artifactId}`);
    },
    async getOwner(artifactId: string): Promise<string | undefined> {
      const { rows } = await pool.query<{ owner_id: string }>(
        `SELECT owner_id FROM artifacts.artifacts WHERE id = $1`,
        [artifactId],
      );
      return rows[0]?.owner_id;
    },
    async getArtifactState(artifactId: string): Promise<ArtifactState> {
      const { rows } = await pool.query<{ lifecycle_state: ArtifactState }>(
        `SELECT lifecycle_state FROM artifacts.artifacts WHERE id = $1`,
        [artifactId],
      );
      return rows[0]?.lifecycle_state ?? 'active';
    },
    async setArtifactState(artifactId: string, state: ArtifactState): Promise<void> {
      const updated = await pool.query(
        `UPDATE artifacts.artifacts SET lifecycle_state = $2 WHERE id = $1`,
        [artifactId, state],
      );
      if ((updated.rowCount ?? 0) === 0) throw new Error(`unknown artifact: ${artifactId}`);
    },
    async getRenewedAt(artifactId: string): Promise<string | undefined> {
      const { rows } = await pool.query<{ renewed_at: Date | null }>(
        `SELECT renewed_at FROM artifacts.artifacts WHERE id = $1`,
        [artifactId],
      );
      return rows[0]?.renewed_at?.toISOString();
    },
    async setRenewedAt(artifactId: string, renewedAt: string): Promise<void> {
      const updated = await pool.query(
        `UPDATE artifacts.artifacts SET renewed_at = $2 WHERE id = $1`,
        [artifactId, renewedAt],
      );
      if ((updated.rowCount ?? 0) === 0) throw new Error(`unknown artifact: ${artifactId}`);
    },
    async addRelease(artifactId: string, releaseId: string): Promise<void> {
      const artifact = await pool.query(`SELECT id FROM artifacts.artifacts WHERE id = $1`, [
        artifactId,
      ]);
      if ((artifact.rowCount ?? 0) === 0) throw new Error(`unknown artifact: ${artifactId}`);
      const release = await pool.query(`SELECT id FROM artifacts.releases WHERE id = $1`, [
        releaseId,
      ]);
      if ((release.rowCount ?? 0) === 0) throw new Error(`unknown release: ${releaseId}`);
    },
    async listArtifactReleases(artifactId: string): Promise<string[]> {
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM artifacts.releases WHERE artifact_id = $1 ORDER BY created_at, id`,
        [artifactId],
      );
      return rows.map((row) => row.id);
    },
    async getReleaseState(releaseId: string): Promise<ReleaseState> {
      const { rows } = await pool.query<{ state: ReleaseState }>(
        `SELECT state FROM artifacts.releases WHERE id = $1`,
        [releaseId],
      );
      return rows[0]?.state ?? 'ready';
    },
    async setReleaseState(releaseId: string, state: ReleaseState): Promise<void> {
      const updated = await pool.query(`UPDATE artifacts.releases SET state = $2 WHERE id = $1`, [
        releaseId,
        state,
      ]);
      if ((updated.rowCount ?? 0) === 0) throw new Error(`unknown release: ${releaseId}`);
    },
    async addRef(digest: string, holder: string): Promise<void> {
      await pool.query(
        `INSERT INTO artifacts.blob_ref_holders (digest, holder) VALUES ($1, $2)
         ON CONFLICT (digest, holder) DO NOTHING`,
        [digest, holder],
      );
    },
    async releaseRef(digest: string, holder: string): Promise<void> {
      const deleted = await pool.query(
        `DELETE FROM artifacts.blob_ref_holders WHERE digest = $1 AND holder = $2`,
        [digest, holder],
      );
      if ((deleted.rowCount ?? 0) === 0) {
        throw new Error(`refcount not held: ${digest} by ${holder}`);
      }
    },
    async pin(digest: string, reason: string): Promise<void> {
      const inserted = await pool.query(
        `INSERT INTO artifacts.blob_pins (digest, reason) VALUES ($1, $2)
         ON CONFLICT (digest, reason) DO NOTHING RETURNING digest`,
        [digest, reason],
      );
      if ((inserted.rowCount ?? 0) === 0) {
        throw new Error(`duplicate pin: ${digest} (${reason})`);
      }
    },
    async unpin(digest: string, reason: string): Promise<void> {
      const deleted = await pool.query(
        `DELETE FROM artifacts.blob_pins WHERE digest = $1 AND reason = $2`,
        [digest, reason],
      );
      if ((deleted.rowCount ?? 0) === 0) {
        throw new Error(`not pinned: ${digest} (${reason})`);
      }
    },
    async count(digest: string): Promise<number> {
      const { rows } = await pool.query<{ total: string }>(
        `SELECT COUNT(*) AS total FROM artifacts.blob_ref_holders WHERE digest = $1`,
        [digest],
      );
      return Number(rows[0]?.total ?? 0);
    },
    async isPinned(digest: string): Promise<boolean> {
      const { rows } = await pool.query<{ found: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM artifacts.blob_pins WHERE digest = $1) AS found`,
        [digest],
      );
      return rows[0]?.found ?? false;
    },
  };
}
