/**
 * U1 — SQLite artifact store: the same port interfaces as
 * `createPostgresArtifactStore` (bindings, intents, preparation-cleanup reads,
 * idempotency, ACL, sources, lifecycle, publication state + CAS, refcounts),
 * over one serialized writer. Multi-statement units (ensureArtifact race
 * path, putRelease, terminal-guarded updates) run in one BEGIN IMMEDIATE
 * transaction; single statements are atomic on the single connection. The
 * 0004 terminal guards are enforced here (check-then-write is atomic under
 * the writer) with the same 'terminal artifact' error text as the pg triggers.
 */
import { randomUUID } from 'node:crypto';
import type { JsonValue } from '../contracts.js';
import type { AccessGrant, ArtifactAcl, ArtifactMetadata } from '../server/access.js';
import type { RefcountStore } from '../server/gc.js';
import type { ArtifactState, LifecycleStore, ReleaseState } from '../server/lifecycle.js';
import type { SourceRef, SourceStore } from '../server/sources.js';
import type { IntentKind, ObjectIntent, PreparationIntentStore } from '../server/object-intents.js';
import type { IdempotencyStore, IdempotentResult } from '../server/idempotency.js';
import type { PublicationStateStore, ReleaseRecord } from '../server/publication.js';
import { ArtifactOperationError } from '../server/failures.js';
import type { PostgresArtifactStore, ArtifactBindingInput } from './postgres.js';
import { runQuery, type SqliteDatabase } from './sqlite-sql.js';
import type { SqliteWriter } from './sqlite.js';

interface IntentRow {
  id: string;
  kind: IntentKind;
  state: 'pending' | 'done' | 'failed';
  payload: string;
  error: string | null;
  created_at: string;
  updated_at: string;
}

function toIntent(row: IntentRow): ObjectIntent {
  return {
    intentId: row.id,
    kind: row.kind,
    state: row.state,
    payload: JSON.parse(row.payload) as Record<string, JsonValue | undefined>,
    error: row.error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface ReleaseRow {
  author_principal_id: string | null;
  parent_release_id: string | null;
  reverted_from_release_id: string | null;
  id: string;
  artifact_id: string;
  manifest_digest: string;
  manifest: string;
  state: ReleaseState;
  created_at: string;
}

function toRelease(row: ReleaseRow): ReleaseRecord {
  return {
    authorPrincipalId: row.author_principal_id,
    parentReleaseId: row.parent_release_id,
    revertedFromReleaseId: row.reverted_from_release_id,
    releaseId: row.id,
    artifactId: row.artifact_id,
    manifestDigest: row.manifest_digest,
    manifest: row.manifest,
    state: row.state,
    createdAt: row.created_at,
  };
}

const nowIso = (): string => new Date().toISOString();

/** Terminal guard (pg 0004 reject_terminal_restore): returns the row or throws. */
function artifactRow(db: SqliteDatabase, artifactId: string): { lifecycle_state: ArtifactState; renewed_at: string | null; terminal_deleted_at: string | null } {
  const { rows } = runQuery<{ lifecycle_state: ArtifactState; renewed_at: string | null; terminal_deleted_at: string | null }>(
    db, 'SELECT lifecycle_state, renewed_at, terminal_deleted_at FROM artifacts WHERE id = $1', [artifactId],
  );
  const row = rows[0];
  if (row === undefined) throw new Error(`unknown artifact: ${artifactId}`);
  return row;
}

function assertRestorable(row: { lifecycle_state: ArtifactState; renewed_at: string | null; terminal_deleted_at: string | null }, newState: ArtifactState, newRenewedAt: string | null): void {
  if (row.terminal_deleted_at !== null && (newState !== 'deleted' && newState !== 'purged' || newRenewedAt !== row.renewed_at)) {
    throw new Error('terminal artifact');
  }
}

/** Create the SQLite-backed store implementing the same ports as the pg store. */
export function createSqliteArtifactStore(db: SqliteDatabase, writer: SqliteWriter): PostgresArtifactStore {
  const store: PostgresArtifactStore = {
    async ensureArtifact(input: ArtifactBindingInput): Promise<{ artifactId: string; created: boolean }> {
      return writer.tx(() => {
        const where = 'WHERE storage_scope_id = $1 AND owner_id = $2 AND binding_name = $3';
        const args = [input.storageScopeId, input.ownerId, input.bindingName];
        const found = runQuery<{ id: string; terminal: number }>(
          db, `SELECT id, terminal_deleted_at IS NOT NULL AS terminal FROM artifacts ${where}`, args,
        );
        if (found.rows[0] !== undefined) {
          if (found.rows[0].terminal) throw new ArtifactOperationError('gone');
          return { artifactId: found.rows[0].id, created: false };
        }
        const inserted = runQuery<{ id: string }>(
          db, `INSERT INTO artifacts (id, storage_scope_id, owner_id, binding_name, profile)
            VALUES ($4, $1, $2, $3, $5)
            ON CONFLICT (storage_scope_id, owner_id, binding_name) DO NOTHING RETURNING id`,
          [...args, randomUUID(), JSON.stringify(input.profile)],
        );
        if (inserted.rows[0] !== undefined) return { artifactId: inserted.rows[0].id, created: true };
        const raced = runQuery<{ id: string; terminal: number }>(
          db, `SELECT id, terminal_deleted_at IS NOT NULL AS terminal FROM artifacts ${where}`, args,
        );
        const row = raced.rows[0];
        if (row === undefined) throw new Error(`artifact binding lost for ${input.bindingName}`);
        if (row.terminal) throw new ArtifactOperationError('gone');
        return { artifactId: row.id, created: false };
      });
    },
    async record(kind: IntentKind, payload: Record<string, JsonValue | undefined>): Promise<ObjectIntent> {
      return writer.run(() => {
        const { rows } = runQuery<IntentRow>(
          db, `INSERT INTO object_intents (id, kind, payload) VALUES ($1, $2, $3)
            RETURNING id, kind, state, payload, error, created_at, updated_at`,
          [randomUUID(), kind, JSON.stringify(payload)],
        );
        const row = rows[0];
        if (row === undefined) throw new Error('intent insert failed');
        return toIntent(row);
      });
    },
    async complete(intentId: string): Promise<void> {
      await writer.run(() => {
        const { rowCount } = runQuery(db, `UPDATE object_intents SET state = 'done', updated_at = $2 WHERE id = $1`, [intentId, nowIso()]);
        if (rowCount === 0) throw new Error(`unknown intent: ${intentId}`);
      });
    },
    async markFailed(intentId: string, error: string): Promise<void> {
      await writer.run(() => {
        const { rowCount } = runQuery(db, `UPDATE object_intents SET state = 'failed', error = $2, updated_at = $3 WHERE id = $1`, [intentId, error, nowIso()]);
        if (rowCount === 0) throw new Error(`unknown intent: ${intentId}`);
      });
    },
    async get(intentId: string): Promise<ObjectIntent | undefined> {
      const { rows } = runQuery<IntentRow>(
        db, 'SELECT id, kind, state, payload, error, created_at, updated_at FROM object_intents WHERE id = $1', [intentId],
      );
      return rows[0] === undefined ? undefined : toIntent(rows[0]);
    },
    async listPending(): Promise<ObjectIntent[]> {
      const { rows } = runQuery<IntentRow>(
        db, `SELECT id, kind, state, payload, error, created_at, updated_at FROM object_intents
          WHERE state = 'pending' ORDER BY created_at`,
      );
      return rows.map(toIntent);
    },
    async listPreparationIntents(query = {}) {
      const { rows } = runQuery<IntentRow>(
        db, `SELECT id, kind, state, payload, error, created_at, updated_at FROM object_intents
          WHERE kind = 'commit-release' AND state <> 'done'
            AND json_type(payload, '$.cleanupDeadlineMs') IS NOT NULL
            AND ($1 IS NULL OR json_extract(payload, '$.artifactId') = $1)
            AND ($2 IS NULL OR (
              COALESCE(error, '') NOT LIKE 'invalid preparation metadata%'
              AND CASE WHEN json_type(payload, '$.cleanupDeadlineMs') IN ('integer', 'real')
                   THEN json_extract(payload, '$.cleanupDeadlineMs') ELSE 0 END <= $2
              AND (json_extract(payload, '$.cleanupState') IS NOT 'failed-cleaned'
                   OR json_extract(payload, '$.cleanupDeadlineMs') >= $2 - 60000)))
          ORDER BY COALESCE(json_extract(payload, '$.cleanupState') = 'failed-cleaned', 0),
            CASE WHEN json_type(payload, '$.cleanupDeadlineMs') IN ('integer', 'real')
              THEN json_extract(payload, '$.cleanupDeadlineMs') ELSE 0 END, id
          LIMIT $3`,
        [query.artifactId ?? null, query.throughMs ?? null, query.limit ?? -1],
      );
      return rows.map(toIntent);
    },
    async claimPreparationCleanup(intentId, throughMs) {
      return writer.run(() => {
        // Serialized with finalization's intent completion on the same row.
        const { rows } = runQuery<IntentRow>(
          db, `UPDATE object_intents SET state = 'failed',
              error = COALESCE(error, 'preparation expired; explicit retry required'), updated_at = $3
            WHERE id = $1 AND kind = 'commit-release' AND state <> 'done'
              AND json_type(payload, '$.cleanupDeadlineMs') IN ('integer', 'real')
              AND json_extract(payload, '$.cleanupDeadlineMs') <= $2
            RETURNING id, kind, state, payload, error, created_at, updated_at`,
          [intentId, throughMs, nowIso()],
        );
        return rows[0] === undefined ? undefined : toIntent(rows[0]);
      });
    },
    async settlePreparationCleanup(intentId) {
      await writer.run(() => {
        const { rowCount } = runQuery(
          db, `UPDATE object_intents SET payload = json_set(payload, '$.cleanupState', 'failed-cleaned'), updated_at = $2
            WHERE id = $1 AND state = 'failed'`, [intentId, nowIso()],
        );
        if (rowCount === 0) throw new Error('cleanup needs a failed preparation');
      });
    },
    async putRelease(release: ReleaseRecord): Promise<void> {
      await writer.tx(() => {
        const parsed = JSON.parse(release.manifest) as { files?: { digest?: unknown; size?: unknown }[] };
        // 0004 terminal_release_guard: the artifact must exist and not be terminal.
        const artifact = runQuery<{ terminal: number }>(
          db, 'SELECT terminal_deleted_at IS NOT NULL AS terminal FROM artifacts WHERE id = $1', [release.artifactId],
        );
        if (artifact.rows[0] === undefined || artifact.rows[0].terminal) throw new Error('terminal artifact');
        runQuery(
          db, `INSERT INTO releases (id, artifact_id, manifest_digest, manifest, state, created_at)
            VALUES ($1, $2, $3, $4, 'ready', $5)`,
          [release.releaseId, release.artifactId, release.manifestDigest, release.manifest, release.createdAt],
        );
        const scope = runQuery<{ storage_scope_id: string }>(
          db, 'SELECT storage_scope_id FROM artifacts WHERE id = $1', [release.artifactId],
        );
        const scopeId = scope.rows[0]?.storage_scope_id;
        if (scopeId === undefined) throw new Error(`unknown artifact: ${release.artifactId}`);
        for (const file of parsed.files ?? []) {
          if (typeof file.digest !== 'string' || typeof file.size !== 'number') continue;
          runQuery(db, 'INSERT INTO blobs (storage_scope_id, digest, size) VALUES ($1, $2, $3) ON CONFLICT (storage_scope_id, digest) DO NOTHING', [scopeId, file.digest, file.size]);
        }
        // 0004 publication_updated_at side effect.
        runQuery(db, 'UPDATE artifacts SET updated_at = $2 WHERE id = $1', [release.artifactId, release.createdAt]);
      });
    },
    async getRelease(releaseId: string): Promise<ReleaseRecord | undefined> {
      const { rows } = runQuery<ReleaseRow>(db, 'SELECT * FROM releases WHERE id = $1', [releaseId]);
      return rows[0] === undefined ? undefined : toRelease(rows[0]);
    },
    async listReleases(artifactId: string): Promise<ReleaseRecord[]> {
      const { rows } = runQuery<ReleaseRow>(db, 'SELECT * FROM releases WHERE artifact_id = $1 ORDER BY created_at, id', [artifactId]);
      return rows.map(toRelease);
    },
    async getCurrentReleaseId(artifactId: string): Promise<string | undefined> {
      const { rows } = runQuery<{ release_id: string }>(db, 'SELECT release_id FROM artifact_current WHERE artifact_id = $1', [artifactId]);
      return rows[0]?.release_id;
    },
    async compareAndSwapCurrent(artifactId: string, expected: string | null, next: string): Promise<boolean> {
      return writer.run(() => {
        // 0004 terminal_pointer_guard.
        const artifact = runQuery<{ terminal: number }>(
          db, 'SELECT terminal_deleted_at IS NOT NULL AS terminal FROM artifacts WHERE id = $1', [artifactId],
        );
        if (artifact.rows[0] !== undefined && artifact.rows[0].terminal) throw new Error('terminal artifact');
        if (expected === null) {
          const inserted = runQuery(db, 'INSERT INTO artifact_current (artifact_id, release_id) VALUES ($1, $2) ON CONFLICT (artifact_id) DO NOTHING', [artifactId, next]);
          return inserted.rowCount !== 0;
        }
        const updated = runQuery(db, 'UPDATE artifact_current SET release_id = $3 WHERE artifact_id = $1 AND release_id = $2', [artifactId, expected, next]);
        return updated.rowCount !== 0;
      });
    },
    async execute<T>(key: string, paramsHash: string, work: () => Promise<T>): Promise<IdempotentResult<T>> {
      const select = 'SELECT params_hash, result FROM idempotency_keys WHERE key = $1';
      const found = runQuery<{ params_hash: string; result: string }>(db, select, [`idempotency:${key}`]);
      const stored = found.rows[0];
      if (stored !== undefined) {
        if (stored.params_hash !== paramsHash) {
          throw new Error(`idempotency conflict: key ${key} already used with different parameters`);
        }
        return { result: JSON.parse(stored.result) as T, replayed: true };
      }
      const result = await work();
      return writer.run(() => {
        const inserted = runQuery(
          db, 'INSERT INTO idempotency_keys (key, params_hash, result) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING RETURNING key',
          [`idempotency:${key}`, paramsHash, JSON.stringify(result)],
        );
        if (inserted.rowCount !== 0) return { result, replayed: false };
        const raced = runQuery<{ params_hash: string; result: string }>(db, select, [`idempotency:${key}`]);
        const winner = raced.rows[0];
        if (winner === undefined) throw new Error(`idempotency record lost for ${key}`);
        if (winner.params_hash !== paramsHash) {
          throw new Error(`idempotency conflict: key ${key} already used with different parameters`);
        }
        return { result: JSON.parse(winner.result) as T, replayed: true };
      });
    },
    async listRegisteredBlobs(storageScopeId: string): Promise<string[]> {
      const { rows } = runQuery<{ digest: string }>(db, 'SELECT digest FROM blobs WHERE storage_scope_id = $1 ORDER BY digest', [storageScopeId]);
      return rows.map((row) => row.digest);
    },
    async getArtifactAcl(artifactId: string): Promise<ArtifactAcl | undefined> {
      const { rows } = runQuery<{
        owner_id: string; storage_scope_id: string; is_public: number; access_mode: string | null;
        lifecycle_state: ArtifactState;
        binding_name: string; created_at: string; updated_at: string | null; metadata: string | null;
      }>(
        db, `SELECT owner_id, storage_scope_id, is_public, access_mode, lifecycle_state, binding_name, created_at, updated_at, metadata
          FROM artifacts WHERE id = $1`, [artifactId],
      );
      const row = rows[0];
      if (row === undefined) return undefined;
      const grants = runQuery<{ principal_id: string; permission: AccessGrant; created_at: string }>(
        db, 'SELECT principal_id, permission, created_at FROM artifact_access WHERE artifact_id = $1 ORDER BY principal_id', [artifactId],
      );
      const metadata = row.metadata === null ? {} : (JSON.parse(row.metadata) as ArtifactMetadata);
      // G1: access_mode is authoritative; is_public is its legacy projection.
      const accessMode = (row.access_mode ?? (row.is_public === 1 ? 'platform' : 'restricted')) as ArtifactAcl['accessMode'];
      return {
        bindingName: row.binding_name, createdAt: row.created_at, updatedAt: row.updated_at,
        ...metadata,
        ownerId: row.owner_id,
        storageScopeId: row.storage_scope_id,
        isPublic: accessMode !== 'restricted',
        accessMode,
        withdrawn: row.lifecycle_state === 'withdrawn',
        grants: grants.rows.map((grant) => ({ principalId: grant.principal_id, grant: grant.permission,
          createdAt: grant.created_at })),
        ...(Object.keys(metadata).length === 0 ? {} : { metadata }),
      };
    },
    async putArtifactAcl(artifactId: string, acl: ArtifactAcl): Promise<void> {
      // G1: write access_mode; is_public stays as its projection (never forced false).
      const accessMode = acl.accessMode ?? (acl.isPublic ? 'platform' : 'restricted');
      await writer.tx(() => {
        runQuery(
          db, `UPDATE artifacts SET access_mode = $2, is_public = ($2 <> 'restricted'), metadata = $4,
            lifecycle_state = CASE WHEN $3 <> 0 THEN 'withdrawn'
              WHEN lifecycle_state = 'withdrawn' THEN 'active'
              ELSE lifecycle_state END
            WHERE id = $1`,
          [artifactId, accessMode, acl.withdrawn ? 1 : 0, JSON.stringify(acl.metadata ?? {})],
        );
        runQuery(db, 'DELETE FROM artifact_access WHERE artifact_id = $1', [artifactId]);
        for (const grant of acl.grants) {
          // Q1 schema invariant: a source grant exists only in restricted mode. A
          // legacy platform/public artifact may still carry one; rewriting its ACL
          // must not trip the source guard on re-insert, so the stale source grant
          // is demoted to read — the grant row is kept, never dropped.
          const permission = grant.grant === 'source' && accessMode !== 'restricted' ? 'read' : grant.grant;
          runQuery(db, 'INSERT INTO artifact_access (artifact_id, principal_id, permission, created_at) VALUES ($1, $2, $3, COALESCE($4, strftime(\'%Y-%m-%dT%H:%M:%fZ\', \'now\')))',
            [artifactId, grant.principalId, permission, grant.createdAt ?? null]);
        }
      });
    },
    async listArtifactIds(): Promise<string[]> {
      const { rows } = runQuery<{ id: string }>(db, 'SELECT id FROM artifacts ORDER BY created_at ASC, id ASC');
      return rows.map((row) => row.id);
    },
    async getSource(artifactId: string): Promise<SourceRef | undefined> {
      const { rows } = runQuery<{ kind: string; commit_tx: string | null; steps: string | null }>(
        db, 'SELECT kind, commit_tx, steps FROM artifact_sources WHERE artifact_id = $1', [artifactId],
      );
      const row = rows[0];
      if (row === undefined) return undefined;
      if (row.kind === 'inline-original') return { kind: 'inline-original' };
      if (row.kind === 'base-commit') return { kind: 'base-commit', commit: row.commit_tx ?? '' };
      if (row.kind === 'recipe') {
        const steps: unknown = row.steps === null ? [] : JSON.parse(row.steps);
        return { kind: 'recipe', steps: Array.isArray(steps) ? steps.map((step) => String(step)) : [] };
      }
      throw new Error(`unknown source kind: ${row.kind}`);
    },
    async putSource(artifactId: string, source: SourceRef): Promise<void> {
      await writer.run(() => {
        const commit = source.kind === 'base-commit' ? source.commit : null;
        const steps = source.kind === 'recipe' ? JSON.stringify(source.steps) : null;
        runQuery(
          db, `INSERT INTO artifact_sources (artifact_id, kind, commit_tx, steps) VALUES ($1, $2, $3, $4)
            ON CONFLICT (artifact_id) DO UPDATE SET kind = excluded.kind, commit_tx = excluded.commit_tx, steps = excluded.steps`,
          [artifactId, source.kind, commit, steps],
        );
      });
    },
    async register(artifactId: string, ownerId: string): Promise<void> {
      const { rows } = runQuery<{ owner_id: string }>(db, 'SELECT owner_id FROM artifacts WHERE id = $1', [artifactId]);
      const row = rows[0];
      if (row === undefined) throw new Error(`unknown artifact: ${artifactId}`);
      if (row.owner_id !== ownerId) throw new Error(`owner mismatch for ${artifactId}`);
    },
    async getOwner(artifactId: string): Promise<string | undefined> {
      const { rows } = runQuery<{ owner_id: string }>(db, 'SELECT owner_id FROM artifacts WHERE id = $1', [artifactId]);
      return rows[0]?.owner_id;
    },
    async getArtifactState(artifactId: string): Promise<ArtifactState> {
      const { rows } = runQuery<{ lifecycle_state: ArtifactState }>(db, 'SELECT lifecycle_state FROM artifacts WHERE id = $1', [artifactId]);
      return rows[0]?.lifecycle_state ?? 'active';
    },
    async isTerminal(artifactId: string): Promise<boolean> {
      const { rows } = runQuery<{ terminal: number }>(db, 'SELECT terminal_deleted_at IS NOT NULL AS terminal FROM artifacts WHERE id = $1', [artifactId]);
      return rows[0]?.terminal === 1;
    },
    async markTerminal(artifactId: string): Promise<void> {
      await writer.run(() => {
        // pg markTerminal ignores unknown artifacts (no rowCount check).
        const { rows } = runQuery<{ lifecycle_state: ArtifactState; renewed_at: string | null; terminal_deleted_at: string | null }>(
          db, 'SELECT lifecycle_state, renewed_at, terminal_deleted_at FROM artifacts WHERE id = $1', [artifactId],
        );
        const row = rows[0];
        if (row === undefined) return;
        assertRestorable(row, 'deleted', row.renewed_at);
        runQuery(db, `UPDATE artifacts SET terminal_deleted_at = COALESCE(terminal_deleted_at, $2), lifecycle_state = 'deleted' WHERE id = $1`, [artifactId, nowIso()]);
      });
    },
    async setArtifactState(artifactId: string, state: ArtifactState): Promise<void> {
      await writer.run(() => {
        const row = artifactRow(db, artifactId);
        assertRestorable(row, state, row.renewed_at);
        const { rowCount } = runQuery(db, 'UPDATE artifacts SET lifecycle_state = $2 WHERE id = $1', [artifactId, state]);
        if (rowCount === 0) throw new Error(`unknown artifact: ${artifactId}`);
      });
    },
    async getRenewedAt(artifactId: string): Promise<string | undefined> {
      const { rows } = runQuery<{ renewed_at: string | null }>(db, 'SELECT renewed_at FROM artifacts WHERE id = $1', [artifactId]);
      return rows[0]?.renewed_at ?? undefined;
    },
    async setRenewedAt(artifactId: string, renewedAt: string): Promise<void> {
      await writer.run(() => {
        const row = artifactRow(db, artifactId);
        assertRestorable(row, row.lifecycle_state, renewedAt);
        const { rowCount } = runQuery(db, 'UPDATE artifacts SET renewed_at = $2 WHERE id = $1', [artifactId, renewedAt]);
        if (rowCount === 0) throw new Error(`unknown artifact: ${artifactId}`);
      });
    },
    async addRelease(artifactId: string, releaseId: string): Promise<void> {
      await writer.run(() => {
        const artifact = runQuery(db, 'SELECT id FROM artifacts WHERE id = $1', [artifactId]);
        if (artifact.rows.length === 0) throw new Error(`unknown artifact: ${artifactId}`);
        const release = runQuery(db, 'SELECT id FROM releases WHERE id = $1', [releaseId]);
        if (release.rows.length === 0) throw new Error(`unknown release: ${releaseId}`);
      });
    },
    async listArtifactReleases(artifactId: string): Promise<string[]> {
      const { rows } = runQuery<{ id: string }>(db, 'SELECT id FROM releases WHERE artifact_id = $1 ORDER BY created_at, id', [artifactId]);
      return rows.map((row) => row.id);
    },
    async getReleaseState(releaseId: string): Promise<ReleaseState> {
      const { rows } = runQuery<{ state: ReleaseState }>(db, 'SELECT state FROM releases WHERE id = $1', [releaseId]);
      return rows[0]?.state ?? 'ready';
    },
    async setReleaseState(releaseId: string, state: ReleaseState): Promise<void> {
      await writer.run(() => {
        const { rowCount } = runQuery(db, 'UPDATE releases SET state = $2 WHERE id = $1', [releaseId, state]);
        if (rowCount === 0) throw new Error(`unknown release: ${releaseId}`);
      });
    },
    async addRef(digest: string, holder: string): Promise<void> {
      await writer.run(() => {
        runQuery(db, 'INSERT INTO blob_ref_holders (digest, holder) VALUES ($1, $2) ON CONFLICT (digest, holder) DO NOTHING', [digest, holder]);
      });
    },
    async releaseRef(digest: string, holder: string): Promise<void> {
      await writer.run(() => {
        const { rowCount } = runQuery(db, 'DELETE FROM blob_ref_holders WHERE digest = $1 AND holder = $2', [digest, holder]);
        if (rowCount === 0) throw new Error(`refcount not held: ${digest} by ${holder}`);
      });
    },
    async pin(digest: string, reason: string): Promise<void> {
      await writer.run(() => {
        const inserted = runQuery(db, 'INSERT INTO blob_pins (digest, reason) VALUES ($1, $2) ON CONFLICT (digest, reason) DO NOTHING RETURNING digest', [digest, reason]);
        if (inserted.rowCount === 0) throw new Error(`duplicate pin: ${digest} (${reason})`);
      });
    },
    async unpin(digest: string, reason: string): Promise<void> {
      await writer.run(() => {
        const { rowCount } = runQuery(db, 'DELETE FROM blob_pins WHERE digest = $1 AND reason = $2', [digest, reason]);
        if (rowCount === 0) throw new Error(`not pinned: ${digest} (${reason})`);
      });
    },
    async count(digest: string): Promise<number> {
      const { rows } = runQuery<{ total: number }>(db, 'SELECT COUNT(*) AS total FROM blob_ref_holders WHERE digest = $1', [digest]);
      return Number(rows[0]?.total ?? 0);
    },
    async isPinned(digest: string): Promise<boolean> {
      const { rows } = runQuery<{ found: number }>(db, 'SELECT EXISTS (SELECT 1 FROM blob_pins WHERE digest = $1) AS found', [digest]);
      return rows[0]?.found === 1;
    },
  };
  return store;
}

export type { PreparationIntentStore, PublicationStateStore, IdempotencyStore, RefcountStore, SourceStore, LifecycleStore };
