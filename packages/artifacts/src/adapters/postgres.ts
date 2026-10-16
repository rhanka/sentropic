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

export interface PostgresArtifactBindings {
  ensureArtifact(input: ArtifactBindingInput): Promise<ArtifactBinding>;
}

/** Create the Postgres-backed store over an injected pool (no DDL). */
export function createPostgresArtifactStore(pool: Pool): PostgresArtifactBindings {
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
  };
}
