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
import type { IntentKind, IntentStore, ObjectIntent } from '../server/object-intents.js';
import type { IdempotencyStore, IdempotentResult } from '../server/idempotency.js';
import type { PublicationStateStore, ReleaseRecord } from '../server/publication.js';

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

export interface PostgresArtifactBasics extends IntentStore {
  ensureArtifact(input: ArtifactBindingInput): Promise<ArtifactBinding>;
}

export interface PostgresArtifactStore
  extends PostgresArtifactBasics,
    PublicationStateStore,
    IdempotencyStore {
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
  };
}
