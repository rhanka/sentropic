import type { Pool } from 'pg';
import { ArtifactOperationError } from '../server/failures.js';
import { gitBindingEvent, gitBindingReceiptKey, validateGitAttachIntent, validateGitBindingWrite,
  type GitAttachIntent, type GitBinding, type GitBindingEvent, type GitBindingStore } from '../server/git-bindings.js';
import type { GitReleaseIndex, GitReleaseIndexStore } from '../server/git-contracts.js';

const fields = ['artifactId', 'storageScopeId', 'repoId', 'branch', 'channel', 'personalPrincipalId', 'subPath',
  'baseCommitSha', 'headCommitSha', 'releaseCommitSha', 'autoPublish', 'executor', 'pendingJobId',
  'pendingCommitSha', 'state', 'stateDetail', 'generation', 'version', 'attachedBy', 'attachedAt', 'updatedAt'] as const;
const column = (key: string) => key.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
function bindingRow(row: Record<string, unknown>): GitBinding {
  return Object.fromEntries(fields.flatMap(key => {
    const value = row[column(key)];
    return key === 'stateDetail' && value === null ? [] : [[key, value instanceof Date ? value.toISOString() : value]];
  })) as unknown as GitBinding;
}
const intentFields = ['storageScopeId', 'actorId', 'idempotencyKey', 'commandHash', 'artifactId', 'repoId',
  'branch', 'baseCommitSha', 'createdAt'] as const;
const intentRow = (row: Record<string, unknown>): GitAttachIntent => Object.fromEntries(intentFields.map(key => {
  const value = row[column(key)];
  return [key, value instanceof Date ? value.toISOString() : value];
})) as unknown as GitAttachIntent;
/** Injected pool, no import-time I/O/DDL. All mutation work shares one transaction. */
export function createPostgresGitBindingStore(pool: Pool): GitBindingStore {
  const readIntent = async (scope: string, actorId: string, key: string) => {
    const { rows } = await pool.query(`SELECT * FROM artifacts.git_attach_intents
      WHERE storage_scope_id=$1 AND actor_id=$2 AND idempotency_key=$3`, [scope, actorId, key]);
    return rows[0] ? intentRow(rows[0]) : undefined;
  };
  return {
    async get(scope, id) {
      const { rows } = await pool.query('SELECT * FROM artifacts.git_bindings WHERE storage_scope_id=$1 AND artifact_id=$2',
        [scope, id]);
      return rows[0] ? bindingRow(rows[0]) : undefined;
    },
    async events(scope, id) {
      const { rows } = await pool.query(`SELECT * FROM artifacts.git_binding_events
        WHERE storage_scope_id=$1 AND artifact_id=$2 ORDER BY id`, [scope, id]);
      return rows.map(row => {
        const event: GitBindingEvent = { id: String(row.id), artifactId: row.artifact_id,
          storageScopeId: row.storage_scope_id, actorId: row.actor_id, action: row.action,
          createdAt: row.created_at.toISOString() };
        for (const key of ['beforeSha', 'afterSha', 'deliveryId', 'invocationId'] as const) {
          if (row[column(key)] !== null) event[key] = row[column(key)];
        }
        if (row.branch_created === true) event.branchCreated = true;
        return event;
      });
    },
    async reserveAttachIntent(intent) {
      validateGitAttachIntent(intent);
      await pool.query(`INSERT INTO artifacts.git_attach_intents (storage_scope_id,actor_id,idempotency_key,
        command_hash,artifact_id,repo_id,branch,base_commit_sha,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`, intentFields.map(key => intent[key]));
      return (await readIntent(intent.storageScopeId, intent.actorId, intent.idempotencyKey))!;
    },
    attachIntent: readIntent,
    async write(input) {
      const snapshot = structuredClone(input);
      const binding = snapshot.binding;
      const scope = binding.storageScopeId;
      const key = gitBindingReceiptKey(snapshot);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Serialize absent receipts as well as replays across processes.
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
        const parent = await client.query(`SELECT id FROM artifacts.artifacts
          WHERE storage_scope_id=$1 AND id=$2 FOR UPDATE`, [scope, binding.artifactId]);
        if (!parent.rows[0]) throw new ArtifactOperationError('not_found');
        const receipt = await client.query('SELECT params_hash,result FROM artifacts.idempotency_keys WHERE key=$1', [key]);
        if (receipt.rows[0]) {
          if (receipt.rows[0].params_hash !== snapshot.commandHash) throw new ArtifactOperationError('command_conflict');
          await client.query('COMMIT');
          return { binding: receipt.rows[0].result as GitBinding, replayed: true };
        }
        const before = await client.query(`SELECT * FROM artifacts.git_bindings
          WHERE storage_scope_id=$1 AND artifact_id=$2 FOR UPDATE`, [scope, binding.artifactId]);
        validateGitBindingWrite(before.rows[0] ? bindingRow(before.rows[0]) : undefined, snapshot);
        const columns = fields.map(column);
        const values = fields.map(key => binding[key] ?? null);
        await client.query(`INSERT INTO artifacts.git_bindings (${columns.join(',')})
          VALUES (${fields.map((_, i) => '$' + (i + 1)).join(',')})
          ON CONFLICT (artifact_id) DO UPDATE SET ${columns.slice(1).map(c => `${c}=EXCLUDED.${c}`).join(',')}
          WHERE git_bindings.storage_scope_id=EXCLUDED.storage_scope_id`, values);
        const event = gitBindingEvent(snapshot);
        await client.query(`INSERT INTO artifacts.git_binding_events
          (artifact_id,storage_scope_id,actor_id,action,before_sha,after_sha,delivery_id,invocation_id,created_at,
          branch_created) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [binding.artifactId, scope, snapshot.actorId,
          event.action, event.beforeSha ?? null, event.afterSha ?? null,
          event.deliveryId ?? null, event.invocationId ?? null, event.createdAt, event.branchCreated ?? null]);
        await client.query('INSERT INTO artifacts.idempotency_keys(key,params_hash,result) VALUES ($1,$2,$3)',
          [key, snapshot.commandHash, JSON.stringify(binding)]);
        await client.query('COMMIT');
        return { binding, replayed: false };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505' &&
          'constraint' in error && ['git_bindings_active_branch', 'git_bindings_active_artifact'].includes(String(error.constraint))) {
          throw new ArtifactOperationError('git_binding_conflict', { publicDetails: { artifactId: binding.artifactId } });
        }
        throw error;
      } finally { client.release(); }
    },
  };
}

const indexFields = ['releaseId', 'artifactId', 'repoId', 'branch', 'commitSha', 'treeSha', 'manifestDigest',
  'candidateDigest', 'executor', 'verification', 'receiptId', 'jobId', 'buildRunId', 'attempt', 'createdAt'] as const;
function indexRow(row: Record<string, unknown>): GitReleaseIndex {
  return Object.fromEntries(indexFields.flatMap(key => {
    const value = row[column(key)];
    return value === null ? [] : [[key, value instanceof Date ? value.toISOString() : value]];
  })) as unknown as GitReleaseIndex;
}
/** Read-only SG1 port. SG4 writes both surfaces in the release transaction. */
export function createPostgresGitReleaseIndexStore(pool: Pool): GitReleaseIndexStore {
  return {
    async get(scope, releaseId) {
      const { rows } = await pool.query(`SELECT * FROM artifacts.git_release_index
        WHERE storage_scope_id=$1 AND release_id=$2`, [scope, releaseId]);
      return rows[0] ? indexRow(rows[0]) : undefined;
    },
    async forCommit(scope, artifactId, commitSha) {
      const { rows } = await pool.query(`SELECT * FROM artifacts.git_release_index
        WHERE storage_scope_id=$1 AND artifact_id=$2 AND commit_sha=$3 ORDER BY created_at,release_id`,
        [scope, artifactId, commitSha]);
      return rows.map(indexRow);
    },
  };
}
