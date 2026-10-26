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
      const effective = input.preimage.effective_input;
      if (effective.tool_name === 'engram_memory_capture') this.policy('capture', effective.capture_policy_version);
      if (effective.tool_name === 'engram_memory_request_admission') this.policy('admission', effective.admission_policy_version);
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
  private require(key: string): WorkflowRecord { return this.get(key) ?? refuse('NOT_FOUND'); }
  private checkConfirmation(row: WorkflowRecord, c: MemoryConfirmationContinuationV1,
    e: ExpectedConfirmationContinuationBindingV1): void {
    const p = row.input.preimage, target = p.target;
    const targetRef = target.kind === 'candidate' ? target.candidate_id : target.kind === 'record' ? target.record_id : '';
    if (c.operation_digest !== row.input.digest || c.reservation_ref !== p.reservation_ref || c.capability !== p.tool_name ||
        c.initiating_principal_namespace !== p.principal_namespace || c.initiating_principal_id !== p.principal_id ||
        c.tenant_id !== p.tenant_id || c.store_id !== p.store_id || c.scope_ref !== p.scope_ref ||
        c.connector_instance_ref !== p.connector_instance_ref || c.target_ref !== targetRef ||
        !verifyMemoryConfirmationContinuationV1(c, e).ok) refuse('gate_failed');
  }
  confirm(key: string, continuation: MemoryConfirmationContinuationV1, expected: ExpectedConfirmationContinuationBindingV1): void {
    this.transaction(() => {
      const row = this.require(key);
      if (row.state !== 'reserved' || expected.reservation_state !== 'uncommitted') refuse('gate_failed');
      this.checkConfirmation(row, continuation, expected);
      row.confirmation = structuredClone(continuation); this.save(row);
    });
  }
  claim(key: string, owner: string, now: number, leaseMs: number, currentlyAuthorized: unknown,
    expected?: ExpectedConfirmationContinuationBindingV1): WorkflowRecord {
    if (currentlyAuthorized !== true) return refuse('UNAUTHORIZED');
    if (!owner || !Number.isSafeInteger(now) || !Number.isSafeInteger(leaseMs) || leaseMs <= 0 || leaseMs > 30000) return refuse('gate_failed');
    return this.transaction(() => {
      const row = this.require(key);
      if (row.state === 'committed') return refuse('ALREADY_TERMINAL');
      if (row.state === 'unknown' || (row.state === 'executing' && now >= row.leaseUntil!)) return refuse('MUTATION_OUTCOME_UNKNOWN');
      if (row.state === 'executing') return refuse('FENCE_LOST');
      let leaseUntil = now + leaseMs;
      if (['engram_memory_withdraw', 'engram_memory_forget'].includes(row.input.preimage.tool_name)) {
        if (!row.confirmation || !expected || expected.reservation_state !== 'uncommitted') return refuse('gate_failed');
        this.checkConfirmation(row, row.confirmation, { ...expected, now: new Date(now).toISOString(),
          execution_deadline_at: new Date(Math.min(now + leaseMs, Date.parse(expected.execution_deadline_at))).toISOString() });
        leaseUntil = Math.min(leaseUntil, Date.parse(expected.execution_deadline_at), Date.parse(row.confirmation.expires_at));
        if (leaseUntil <= now) return refuse('gate_failed');
      }
      row.state = 'executing'; row.owner = owner; row.leaseUntil = leaseUntil; row.fence += 1;
      return this.save(row);
    });
  }
  assertEffectAllowed(key: string, fence: number, now: number, currentlyAuthorized: unknown, signal?: AbortSignal): void {
    if (currentlyAuthorized !== true) return refuse('UNAUTHORIZED');
    if (signal?.aborted) return refuse('gate_failed');
    const row = this.require(key);
    if (row.state !== 'executing' || row.fence !== fence || !Number.isSafeInteger(now) || now >= row.leaseUntil!) refuse('FENCE_LOST');
    if (row.confirmation && now >= Date.parse(row.confirmation.expires_at)) refuse('gate_failed');
  }
  markUnknown(key: string, fence: number): void {
    this.transaction(() => {
      const row = this.require(key);
      if (row.state !== 'executing' || row.fence !== fence) refuse('FENCE_LOST');
      row.state = 'unknown'; this.save(row);
    });
  }
  /** Only the host's canonical proof lookup may supply this record; never tool arguments. */
  reconcile(key: string, proof: CanonicalProof, currentlyAuthorized: unknown): void {
    if (currentlyAuthorized !== true) return refuse('UNAUTHORIZED');
    this.transaction(() => {
      const row = this.require(key);
      if (proof?.status !== 'committed' || proof.operationDigest !== row.input.digest || !proof.replayRef || proof.result === undefined) refuse('MUTATION_OUTCOME_UNKNOWN');
      if (row.canonical && JSON.stringify(row.canonical) !== JSON.stringify(proof)) refuse('DIGEST_CONFLICT');
      row.state = 'committed'; row.canonical = structuredClone(proof); this.save(row);
    });
  }
  complete(key: string, fence: number, currentlyAuthorized: unknown): unknown {
    if (currentlyAuthorized !== true) return refuse('UNAUTHORIZED');
    const row = this.require(key);
    if (row.fence !== fence) return refuse('FENCE_LOST');
    if (row.state !== 'committed' || !row.canonical) return refuse('MUTATION_OUTCOME_UNKNOWN');
    return structuredClone(row.canonical.result);
  }
}
