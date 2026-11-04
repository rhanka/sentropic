/**
 * Lot 1a — reference Postgres adapter for the reader consent slice
 * (design-merged §1.2, §3.1). Over an injected pg Pool, no DDL at runtime
 * (the train numbers `sql/reader-consent.sql` at land time). Every mutation
 * runs with its audit event in one transaction: a rollback removes the grant
 * plus the event.
 */
import type { Pool, PoolClient } from 'pg';
import { assertConsentScopeId, assertConsentScopeVersion,
  type ConsentKey, type ReaderConsentEvent, type ReaderConsentRecord } from '../server/consent.js';
import type { ArtifactReaderStore, ConsentRevokedBy, ConsentRevokeAudit } from '../server/reader-store.js';

interface ConsentRow { consent_id: string; storage_scope_id: string; reader_account_id: string;
  artifact_id: string; scope_id: string; scope_version: string; granted_at: Date;
  granted_via: 'reader_screen'; revoked_at: Date | null; revoked_by: ConsentRevokedBy | null; }

const toRecord = (row: ConsentRow): ReaderConsentRecord => ({ consentId: row.consent_id,
  storageScopeId: row.storage_scope_id, readerAccountId: row.reader_account_id, artifactId: row.artifact_id,
  scopeId: row.scope_id, scopeVersion: row.scope_version, grantedAt: row.granted_at.toISOString(),
  grantedVia: row.granted_via, ...(row.revoked_at === null ? {} : { revokedAt: row.revoked_at.toISOString() }),
  ...(row.revoked_by === null ? {} : { revokedBy: row.revoked_by }) });

const LIVE_WHERE = `storage_scope_id = $1 AND reader_account_id = $2 AND artifact_id = $3
  AND scope_id = $4 AND scope_version = $5 AND revoked_at IS NULL`;

async function tx<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    try { const result = await work(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
  } finally { client.release(); }
}

const INSERT_EVENT = `INSERT INTO artifacts.reader_consent_events (consent_id, storage_scope_id,
  reader_account_id, artifact_id, scope_id, scope_version, action, actor, surface, created_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`;

/** Reference adapter; the tables come from the train-numbered migration. */
export function createPostgresReaderConsentStore(pool: Pool): ArtifactReaderStore {
  return {
    async findLiveConsent(key: ConsentKey) {
      const { rows } = await pool.query<ConsentRow>(`SELECT * FROM artifacts.reader_consents WHERE ${LIVE_WHERE}`,
        [key.storageScopeId, key.readerAccountId, key.artifactId, key.scopeId, key.scopeVersion]);
      return rows[0] === undefined ? undefined : toRecord(rows[0]);
    },
    async grantConsent(record) {
      assertConsentScopeId(record.scopeId);
      assertConsentScopeVersion(record.scopeVersion);
      return tx(pool, async (client) => {
        const live = await client.query<ConsentRow>(`SELECT * FROM artifacts.reader_consents WHERE ${LIVE_WHERE} FOR UPDATE`,
          [record.storageScopeId, record.readerAccountId, record.artifactId, record.scopeId, record.scopeVersion]);
        if (live.rows[0] !== undefined) return toRecord(live.rows[0]);
        await client.query(`INSERT INTO artifacts.reader_consents (consent_id, storage_scope_id, reader_account_id,
          artifact_id, scope_id, scope_version, granted_at, granted_via)
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'reader_screen')`,
          [record.consentId, record.storageScopeId, record.readerAccountId, record.artifactId,
            record.scopeId, record.scopeVersion, record.grantedAt]);
        await client.query(INSERT_EVENT, [record.consentId, record.storageScopeId, record.readerAccountId,
          record.artifactId, record.scopeId, record.scopeVersion, 'grant', record.readerAccountId, 'screen', record.grantedAt]);
        return { ...record };
      });
    },
    async revokeConsent(key: ConsentKey, by: ConsentRevokedBy, at: string, audit: ConsentRevokeAudit) {
      return tx(pool, async (client) => {
        const live = await client.query<ConsentRow>(`SELECT * FROM artifacts.reader_consents WHERE ${LIVE_WHERE} FOR UPDATE`,
          [key.storageScopeId, key.readerAccountId, key.artifactId, key.scopeId, key.scopeVersion]);
        if (live.rows[0] === undefined) return { changed: false };
        await client.query(`UPDATE artifacts.reader_consents SET revoked_at = $1, revoked_by = $2 WHERE consent_id = $3`,
          [at, by, live.rows[0].consent_id]);
        await client.query(INSERT_EVENT, [live.rows[0].consent_id, key.storageScopeId, key.readerAccountId,
          key.artifactId, key.scopeId, key.scopeVersion, 'revoke', audit.actor, audit.surface, at]);
        return { changed: true, revokedAt: at };
      });
    },
    async revokeAllConsents(key, by: ConsentRevokedBy, at: string, audit: ConsentRevokeAudit) {
      return tx(pool, async (client) => {
        const { rows } = await client.query<ConsentRow>(`SELECT * FROM artifacts.reader_consents
          WHERE storage_scope_id = $1 AND reader_account_id = $2 AND artifact_id = $3
          AND ($4::text IS NULL OR scope_id = $4) AND revoked_at IS NULL FOR UPDATE`,
          [key.storageScopeId, key.readerAccountId, key.artifactId, key.scopeId ?? null]);
        for (const row of rows) {
          await client.query(`UPDATE artifacts.reader_consents SET revoked_at = $1, revoked_by = $2 WHERE consent_id = $3`,
            [at, by, row.consent_id]);
          await client.query(INSERT_EVENT, [row.consent_id, row.storage_scope_id, row.reader_account_id,
            row.artifact_id, row.scope_id, row.scope_version, 'revoke', audit.actor, audit.surface, at]);
        }
        return { changed: rows.length > 0, revoked: rows.length };
      });
    },
    async listConsentsForReader(scope: string, reader: string) {
      const { rows } = await pool.query<ConsentRow>(`SELECT * FROM artifacts.reader_consents
        WHERE storage_scope_id = $1 AND reader_account_id = $2 ORDER BY granted_at, consent_id`, [scope, reader]);
      return rows.map(toRecord);
    },
    async listConsentEvents(scope: string, artifactId: string) {
      const { rows } = await pool.query(`SELECT consent_id AS "consentId", storage_scope_id AS "storageScopeId",
        reader_account_id AS "readerAccountId", artifact_id AS "artifactId", scope_id AS "scopeId",
        scope_version AS "scopeVersion", action, actor, surface, created_at FROM artifacts.reader_consent_events
        WHERE storage_scope_id = $1 AND artifact_id = $2 ORDER BY id`, [scope, artifactId]);
      return rows.map((row) => ({ consentId: row.consentId, storageScopeId: row.storageScopeId,
        readerAccountId: row.readerAccountId, artifactId: row.artifactId, scopeId: row.scopeId,
        scopeVersion: row.scopeVersion, action: row.action as ReaderConsentEvent['action'],
        actor: row.actor, surface: row.surface as ReaderConsentEvent['surface'], at: row.created_at.toISOString() }));
    },
    async purgeForArtifact(scope: string, artifactId: string) {
      await tx(pool, async (client) => {
        await client.query(`DELETE FROM artifacts.reader_consent_events WHERE storage_scope_id = $1 AND artifact_id = $2`, [scope, artifactId]);
        await client.query(`DELETE FROM artifacts.reader_consents WHERE storage_scope_id = $1 AND artifact_id = $2`, [scope, artifactId]);
      });
    },
    async purgeByPrincipal(scope: string, principalId: string) {
      return tx(pool, async (client) => {
        await client.query(`DELETE FROM artifacts.reader_consent_events WHERE storage_scope_id = $1 AND reader_account_id = $2`, [scope, principalId]);
        const removed = await client.query(`DELETE FROM artifacts.reader_consents WHERE storage_scope_id = $1 AND reader_account_id = $2`, [scope, principalId]);
        return { consents: removed.rowCount ?? 0, kv: 0, docs: 0 };
      });
    },
    async exportByPrincipal(scope: string, principalId: string) {
      return { consents: await this.listConsentsForReader(scope, principalId), kv: [], meDocs: [], sharedWriteRefs: [] };
    },
  };
}
