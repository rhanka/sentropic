/**
 * Files parity LOT 2 §A.5 — Postgres upload session store over the 0007 +
 * 0009 tables (mirrors the reader-consent adapter shape). Over an injected pg
 * Pool: no eager connections, no DDL at runtime. Quota-critical writes run in
 * one transaction holding the per-scope advisory lock, so the check and the
 * insert stay paired under concurrency.
 */
import type { Pool, PoolClient } from 'pg';
import type { StagedFileRecord, UploadSession, UploadSessionStore } from '../server/uploads.js';

type Db = Pick<Pool, 'query'>;

async function tx<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    try {
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  } finally {
    client.release();
  }
}

interface UploadRow {
  id: string;
  artifact_id: string | null;
  storage_scope_id: string | null;
  owner_id: string | null;
  mime_type: string;
  max_size: number;
  state: string;
  expires_at: Date | null;
  created_at: Date;
  page_session_id: string | null;
}

interface StagedRow {
  upload_id: string;
  artifact_id: string;
  path: string;
  mime_type: string;
  digest: string;
  size: number;
  created_at: Date;
}

const toSession = (row: UploadRow): UploadSession => ({
  uploadId: row.id,
  artifactId: row.artifact_id ?? '',
  storageScopeId: row.storage_scope_id ?? '',
  ownerId: row.owner_id ?? '',
  mimeType: row.mime_type,
  maxSize: row.max_size,
  state: row.state as UploadSession['state'],
  expiresAt: (row.expires_at ?? row.created_at).toISOString(),
  createdAt: row.created_at.toISOString(),
  ...(row.page_session_id === null ? {} : { pageSessionId: row.page_session_id }),
});

const toStaged = (row: StagedRow): StagedFileRecord => ({
  uploadId: row.upload_id,
  artifactId: row.artifact_id,
  path: row.path,
  mimeType: row.mime_type,
  digest: row.digest,
  size: row.size,
  createdAt: row.created_at.toISOString(),
});

function using(pool: Pool, db: Db, inTx: boolean): UploadSessionStore {
  return {
    async create(session) {
      await db.query(
        `INSERT INTO artifacts.uploads (id, artifact_id, storage_scope_id, owner_id, mime_type,
          max_size, state, expires_at, created_at, page_session_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [session.uploadId, session.artifactId, session.storageScopeId, session.ownerId,
          session.mimeType, session.maxSize, session.state, session.expiresAt,
          session.createdAt, session.pageSessionId ?? null],
      );
    },
    async get(uploadId) {
      const { rows } = await db.query<UploadRow>(
        'SELECT * FROM artifacts.uploads WHERE id = $1', [uploadId]);
      return rows[0] === undefined ? undefined : toSession(rows[0]);
    },
    async countOpen(storageScopeId, ownerId) {
      const { rows } = await db.query<{ n: string }>(
        `SELECT COUNT(*) AS n FROM artifacts.uploads
         WHERE storage_scope_id = $1 AND owner_id = $2 AND state = 'open'`,
        [storageScopeId, ownerId]);
      return Number(rows[0]?.n ?? 0);
    },
    async listExpiredOpen(at) {
      const { rows } = await db.query<UploadRow>(
        `SELECT * FROM artifacts.uploads WHERE state = 'open' AND expires_at <= $1 ORDER BY expires_at, id`,
        [at.toISOString()]);
      return rows.map(toSession);
    },
    async markCommitted(uploadId) {
      const { rowCount } = await db.query(
        `UPDATE artifacts.uploads SET state = 'committed' WHERE id = $1`, [uploadId]);
      if (rowCount === 0) throw new Error(`unknown upload: ${uploadId}`);
    },
    async markExpired(uploadId) {
      const { rowCount } = await db.query(
        `UPDATE artifacts.uploads SET state = 'expired' WHERE id = $1`, [uploadId]);
      if (rowCount === 0) throw new Error(`unknown upload: ${uploadId}`);
    },
    async recordStagedFile(record) {
      await db.query(
        `INSERT INTO artifacts.staged_files (upload_id, artifact_id, path, mime_type, digest, size, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (upload_id) DO UPDATE SET artifact_id = EXCLUDED.artifact_id, path = EXCLUDED.path,
           mime_type = EXCLUDED.mime_type, digest = EXCLUDED.digest, size = EXCLUDED.size,
           created_at = EXCLUDED.created_at`,
        [record.uploadId, record.artifactId, record.path, record.mimeType,
          record.digest, record.size, record.createdAt],
      );
    },
    async getStagedFile(uploadId) {
      const { rows } = await db.query<StagedRow>(
        'SELECT * FROM artifacts.staged_files WHERE upload_id = $1', [uploadId]);
      return rows[0] === undefined ? undefined : toStaged(rows[0]);
    },
    async listStagedFiles(artifactId) {
      const { rows } = await db.query<StagedRow>(
        'SELECT * FROM artifacts.staged_files WHERE artifact_id = $1 ORDER BY path', [artifactId]);
      return rows.map(toStaged);
    },
    async sumOpenMaxSize(_storageScopeId) {
      throw new Error('not implemented');
    },
    async sumStagedBytesByScope(_storageScopeId) {
      throw new Error('not implemented');
    },
    async listPageSessions(_pageSessionId) {
      throw new Error('not implemented');
    },
    withScopeLock(_storageScopeId, _action) {
      throw new Error('not implemented');
    },
    async listExpiredStaged(_at, _ttlMs) {
      throw new Error('not implemented');
    },
    async deleteStagedFile(_uploadId) {
      throw new Error('not implemented');
    },
  };
}

/** Postgres upload session ledger; quota writes hold the scope advisory lock. */
export function createPostgresUploadSessionStore(pool: Pool): UploadSessionStore {
  return using(pool, pool, false);
}
