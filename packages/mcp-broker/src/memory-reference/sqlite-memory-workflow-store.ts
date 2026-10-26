import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { computeMutationDigest, reservationLookupKey, validatePolicyVersionsProjection,
  verifyMemoryConfirmationContinuationV1 } from '@sentropic/mcp-platform/memory';
import type { MemoryConfirmationContinuationV1, ExpectedConfirmationContinuationBindingV1 } from '@sentropic/mcp-platform/memory';
import { openDriver, refuse, supportsRuntime } from './driver.js';
import { SCHEMA_V1 } from './schema.js';
import type { WorkflowInput, WorkflowRecord, CanonicalProof } from './schema.js';

/** File-backed workflow authority; the canonical engine alone commits effect and replay. */
export class SqliteMemoryWorkflowStoreV1 {
  private constructor(private readonly db: DatabaseSync) {}
  static supportsRuntime = supportsRuntime;
  static async open(path: string): Promise<SqliteMemoryWorkflowStoreV1> {
    const db = await openDriver(path);
    try {
      db.exec('BEGIN IMMEDIATE');
      const version = db.prepare('PRAGMA user_version').get()?.['user_version'];
      if (version === 0) {
        if (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").get()) refuse('POLICY_UNAVAILABLE');
        db.exec(SCHEMA_V1);
      } else if (version !== 1) refuse('POLICY_UNAVAILABLE');
      db.exec('COMMIT');
      return new SqliteMemoryWorkflowStoreV1(db);
    } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
  }
  close(): void { this.db.close(); }
  settings() {
    return { journalMode: this.db.prepare('PRAGMA journal_mode').get()?.['journal_mode'],
      synchronous: this.db.prepare('PRAGMA synchronous').get()?.['synchronous'],
      busyTimeout: this.db.prepare('PRAGMA busy_timeout').get()?.['timeout'],
      sqliteVersion: this.db.prepare('SELECT sqlite_version() AS version').get()?.['version'] };
  }
  private transaction<T>(run: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = run(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private get(key: string): WorkflowRecord | undefined {
    const row = this.db.prepare('SELECT record FROM workflow WHERE key=?').get(key);
    return row ? JSON.parse(String(row['record'])) as WorkflowRecord : undefined;
  }
  private save(row: WorkflowRecord): WorkflowRecord {
    this.db.prepare('INSERT INTO workflow(key,record) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET record=excluded.record')
      .run(row.key, JSON.stringify(row));
    return structuredClone(row);
  }
  read(key: string, currentlyAuthorized: unknown): WorkflowRecord | undefined {
    return currentlyAuthorized === true ? this.get(key) : undefined;
  }
  reserve(input: WorkflowInput, currentlyAuthorized: unknown): WorkflowRecord {
    if (currentlyAuthorized !== true) return refuse('UNAUTHORIZED');
    let digest: string;
    try { digest = computeMutationDigest(input.preimage); } catch { return refuse('INVALID_DIGEST'); }
    if (digest !== input.digest) return refuse('INVALID_DIGEST');
    if (validatePolicyVersionsProjection(input.preimage.effective_input, input.policyVersions).length) return refuse('POLICY_STALE');
    if (!input.audit?.auditId || !input.audit.correlationId || !input.resolved || Array.isArray(input.resolved)) return refuse('gate_failed');
    const lookup = reservationLookupKey(input.preimage);
    const key = createHash('sha256').update(JSON.stringify(Object.values(lookup))).digest('hex');
    return this.transaction(() => {
      const prior = this.get(key);
      if (prior) {
        if (prior.input.digest !== digest) return refuse('DIGEST_CONFLICT');
        return prior;
      }
      return this.save({ key, input: structuredClone(input), state: 'reserved', fence: 0 });
    });
  }
  putPolicy(kind: string, version: string, value: unknown): void {
    if (!kind || !version || value === undefined) return refuse('POLICY_UNAVAILABLE');
    this.transaction(() => {
      const prior = this.db.prepare('SELECT value FROM policy WHERE kind=? AND version=?').get(kind, version);
      const bytes = JSON.stringify(value);
      if (prior && prior['value'] !== bytes) return refuse('POLICY_STALE');
      this.db.prepare('INSERT OR IGNORE INTO policy(kind,version,value) VALUES(?,?,?)').run(kind, version, bytes);
    });
  }
  policy(kind: string, version: string): unknown {
    const prior = this.db.prepare('SELECT value FROM policy WHERE kind=? AND version=?').get(kind, version);
    if (!prior) return refuse('POLICY_UNAVAILABLE');
    return JSON.parse(String(prior['value']));
  }
}
