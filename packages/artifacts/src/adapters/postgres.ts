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

/** Create the Postgres-backed store over an injected pool (no DDL). */
export function createPostgresArtifactStore(pool: Pool): PostgresArtifactBasics {
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
  };
}
