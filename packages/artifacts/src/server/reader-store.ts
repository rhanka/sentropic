/**
 * Lot 1a — host port for the personal reader store, consent slice
 * (design-merged §1.3, §3.1). One identity, one store: consent rows key on
 * the same `(storageScopeId, readerAccountId, artifactId)` tuple as the
 * personal KV and the `me/` subtree of lots 2–3. Server only: the page can
 * neither read, write nor enumerate consent; it learns only the binary
 * outcome of its own call. Absent port ⇒ closed: hosts without a wired
 * store refuse consent routes with `capability_unavailable`.
 */
import { assertConsentScopeId, assertConsentScopeVersion,
  type ConsentKey, type ReaderConsentEvent, type ReaderConsentRecord } from './consent.js';

export type ConsentRevokedBy = 'self' | 'admin' | 'cascade';
export interface ConsentRevokeAudit {
  actor: string;
  surface: 'screen' | 'api' | 'mcp' | 'cascade';
}

export interface PrincipalDataExport {
  consents: readonly ReaderConsentRecord[];
  /** Lot 2 fills the personal KV slice; empty until then. */
  kv: readonly unknown[];
  /** Lot 3 fills the me-documents slice; empty until then. */
  meDocs: readonly unknown[];
  /** Lot 3 fills shared-write references; empty until then. */
  sharedWriteRefs: readonly unknown[];
}

export interface ArtifactReaderStore {
  /** Lifecycle-filtered finder: live rows only, like the A4 grant finder. */
  findLiveConsent(key: ConsentKey): Promise<ReaderConsentRecord | undefined>;
  /** A live row for the key converges: the existing row is returned, no second row or event. */
  grantConsent(record: ReaderConsentRecord): Promise<ReaderConsentRecord>;
  revokeConsent(key: ConsentKey, by: ConsentRevokedBy, at: string,
    audit: ConsentRevokeAudit): Promise<{ changed: boolean; revokedAt?: string }>;
  /**
   * Self or admin revocation of every live row of one artifact, optionally
   * restricted to one scope across all its versions (the MCP `scope`
   * argument names a scope, never a version). Omitted scope revokes all.
   */
  revokeAllConsents(key: Omit<ConsentKey, 'scopeId' | 'scopeVersion'> & { scopeId?: string },
    by: ConsentRevokedBy, at: string, audit: ConsentRevokeAudit): Promise<{ changed: boolean; revoked: number }>;
  /** All states, `grantedAt` then bytewise `consentId` ordering. */
  listConsentsForReader(scope: string, reader: string): Promise<readonly ReaderConsentRecord[]>;
  /** Append-only audit without content, same transaction as the mutation. */
  listConsentEvents(scope: string, artifactId: string): Promise<readonly ReaderConsentEvent[]>;
  purgeForArtifact(scope: string, artifactId: string): Promise<void>;
  purgeByPrincipal(scope: string, principalId: string): Promise<{ consents: number; kv: number; docs: number }>;
  exportByPrincipal(scope: string, principalId: string): Promise<PrincipalDataExport>;
}

const sameKey = (row: ReaderConsentRecord, key: ConsentKey) => row.storageScopeId === key.storageScopeId &&
  row.readerAccountId === key.readerAccountId && row.artifactId === key.artifactId &&
  row.scopeId === key.scopeId && row.scopeVersion === key.scopeVersion;

const byGrantedThenId = (left: ReaderConsentRecord, right: ReaderConsentRecord) =>
  left.grantedAt < right.grantedAt ? -1 : left.grantedAt > right.grantedAt ? 1
    : left.consentId < right.consentId ? -1 : left.consentId > right.consentId ? 1 : 0;

/** In-memory double: single process, synchronous mutation plus audit, no clock (callers stamp). */
export function createMemoryReaderConsentStore(): ArtifactReaderStore {
  const rows = new Map<string, ReaderConsentRecord>();
  const events: ReaderConsentEvent[] = [];
  const copy = (row: ReaderConsentRecord): ReaderConsentRecord => ({ ...row });
  return {
    async findLiveConsent(key) {
      for (const row of rows.values()) {
        if (sameKey(row, key) && row.revokedAt === undefined) return copy(row);
      }
      return undefined;
    },
    async grantConsent(record) {
      assertConsentScopeId(record.scopeId);
      assertConsentScopeVersion(record.scopeVersion);
      const live = await this.findLiveConsent(record);
      if (live !== undefined) return live;
      rows.set(record.consentId, copy(record));
      events.push({ consentId: record.consentId, storageScopeId: record.storageScopeId,
        readerAccountId: record.readerAccountId, artifactId: record.artifactId, scopeId: record.scopeId,
        scopeVersion: record.scopeVersion, action: 'grant', actor: record.readerAccountId,
        surface: 'screen', at: record.grantedAt });
      return copy(record);
    },
    async revokeConsent(key, by, at, audit) {
      const live = await this.findLiveConsent(key);
      if (live === undefined) return { changed: false };
      const stored = rows.get(live.consentId)!;
      stored.revokedAt = at;
      stored.revokedBy = by;
      events.push({ consentId: live.consentId, storageScopeId: key.storageScopeId,
        readerAccountId: key.readerAccountId, artifactId: key.artifactId, scopeId: key.scopeId,
        scopeVersion: key.scopeVersion, action: 'revoke', actor: audit.actor, surface: audit.surface, at });
      return { changed: true, revokedAt: at };
    },
    async revokeAllConsents(key, by, at, audit) {
      let revoked = 0;
      for (const row of [...rows.values()]) {
        if (row.storageScopeId === key.storageScopeId && row.readerAccountId === key.readerAccountId &&
          row.artifactId === key.artifactId && (key.scopeId === undefined || row.scopeId === key.scopeId) &&
          row.revokedAt === undefined) {
          const stored = rows.get(row.consentId)!;
          stored.revokedAt = at;
          stored.revokedBy = by;
          events.push({ consentId: row.consentId, storageScopeId: row.storageScopeId,
            readerAccountId: row.readerAccountId, artifactId: row.artifactId, scopeId: row.scopeId,
            scopeVersion: row.scopeVersion, action: 'revoke', actor: audit.actor, surface: audit.surface, at });
          revoked += 1;
        }
      }
      return { changed: revoked > 0, revoked };
    },
    async listConsentsForReader(scope, reader) {
      return [...rows.values()]
        .filter((row) => row.storageScopeId === scope && row.readerAccountId === reader)
        .sort(byGrantedThenId).map(copy);
    },
    async listConsentEvents(scope, artifactId) {
      return events
        .filter((event) => event.storageScopeId === scope && event.artifactId === artifactId)
        .map((event) => ({ ...event }));
    },
    async purgeForArtifact(scope, artifactId) {
      for (const row of [...rows.values()]) {
        if (row.storageScopeId === scope && row.artifactId === artifactId) rows.delete(row.consentId);
      }
      for (let index = events.length - 1; index >= 0; index -= 1) {
        if (events[index].storageScopeId === scope && events[index].artifactId === artifactId) events.splice(index, 1);
      }
    },
    async purgeByPrincipal(scope, principalId) {
      let consents = 0;
      for (const row of [...rows.values()]) {
        if (row.storageScopeId === scope && row.readerAccountId === principalId) { rows.delete(row.consentId); consents += 1; }
      }
      for (let index = events.length - 1; index >= 0; index -= 1) {
        if (events[index].storageScopeId === scope && events[index].readerAccountId === principalId) events.splice(index, 1);
      }
      return { consents, kv: 0, docs: 0 };
    },
    async exportByPrincipal(scope, principalId) {
      return { consents: await this.listConsentsForReader(scope, principalId), kv: [], meDocs: [], sharedWriteRefs: [] };
    },
  };
}
