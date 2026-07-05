/**
 * Slice 3 — Typed, restart-safe stores for the §6.3 / §6.4 / §5.1 records.
 *
 * Each port is a small persistence seam over the generic `RecordStore<T>` so the
 * record state survives a simulated process restart (new store at the same
 * durable medium). All resolution is fail-closed per
 * SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM §6.3 ("any state other than `active`
 * denies") and §6.4 (status-only, missing → denied). Backing defaults to
 * `MemoryRecordStore` (non-durable, identical to the prior in-memory behavior);
 * inject a `FileRecordStore` for a restart-safe medium.
 *
 * MOCK-ONLY: no real DB/driver/network. Secret VALUES are NEVER stored here — the
 * §6.4 store persists status only (§5.2(b) / §11 "No secret leakage").
 */
import { MemoryRecordStore, type RecordStore } from './persistence.js';
import type {
  ConnectorEnrollment,
  ConsentGrant,
  LifecycleState,
  McpSession,
  SecretStatus,
} from './runtime.js';
import type { ElicitationRecord } from './elicitation.js';

const isExpired = (expiresAt: string | undefined, now: number): boolean =>
  expiresAt !== undefined && Date.parse(expiresAt) <= now;

// ---------------------------------------------------------------------------
// §6.3 — MCP session store
// ---------------------------------------------------------------------------

export interface SessionStore {
  put(session: McpSession): void;
  get(id: string): McpSession | undefined;
  byComposite(principalSub: string, tenantRef: string): McpSession[];
  setState(id: string, state: LifecycleState): void;
  /** Fail-closed (§6.3): session only when state==='active' and unexpired. */
  resolveActive(id: string, now?: number): McpSession | undefined;
  reload(): void;
  snapshot(): string;
}

export class PersistentSessionStore implements SessionStore {
  readonly #store: RecordStore<McpSession>;
  constructor(store: RecordStore<McpSession> = new MemoryRecordStore<McpSession>()) {
    this.#store = store;
  }
  put(session: McpSession): void {
    this.#store.put(session.id, session);
  }
  get(id: string): McpSession | undefined {
    return this.#store.get(id);
  }
  byComposite(principalSub: string, tenantRef: string): McpSession[] {
    return this.#store.all().filter((s) => s.principalSub === principalSub && s.tenantRef === tenantRef);
  }
  setState(id: string, state: LifecycleState): void {
    const s = this.#store.get(id);
    if (s) this.#store.put(id, { ...s, state });
  }
  resolveActive(id: string, now: number = Date.now()): McpSession | undefined {
    const s = this.#store.get(id);
    if (!s || s.state !== 'active' || isExpired(s.expiresAt, now)) return undefined;
    return s;
  }
  reload(): void {
    this.#store.reload();
  }
  snapshot(): string {
    return this.#store.snapshot();
  }
}

// ---------------------------------------------------------------------------
// §6.3 — Consent grant store
// ---------------------------------------------------------------------------

export interface ConsentStore {
  put(grant: ConsentGrant): void;
  get(id: string): ConsentGrant | undefined;
  all(): ConsentGrant[];
  setState(id: string, state: LifecycleState): void;
  reload(): void;
}

export class PersistentConsentStore implements ConsentStore {
  readonly #store: RecordStore<ConsentGrant>;
  constructor(store: RecordStore<ConsentGrant> = new MemoryRecordStore<ConsentGrant>()) {
    this.#store = store;
  }
  put(grant: ConsentGrant): void {
    this.#store.put(grant.id, grant);
  }
  get(id: string): ConsentGrant | undefined {
    return this.#store.get(id);
  }
  all(): ConsentGrant[] {
    return this.#store.all();
  }
  setState(id: string, state: LifecycleState): void {
    const g = this.#store.get(id);
    if (g) this.#store.put(id, { ...g, state });
  }
  reload(): void {
    this.#store.reload();
  }
}

// ---------------------------------------------------------------------------
// §6.3 — Connector enrollment store (composite-keyed)
// ---------------------------------------------------------------------------

const enrollmentKey = (principalSub: string, connectorInstanceId: string, tenantRef: string): string =>
  [principalSub, connectorInstanceId, tenantRef].join('::');

export interface EnrollmentStore {
  put(enrollment: ConnectorEnrollment): void;
  all(): ConnectorEnrollment[];
  forPrincipal(principalSub: string, connectorInstanceId: string): ConnectorEnrollment[];
  setState(principalSub: string, connectorInstanceId: string, tenantRef: string, state: LifecycleState): void;
  reload(): void;
}

export class PersistentEnrollmentStore implements EnrollmentStore {
  readonly #store: RecordStore<ConnectorEnrollment>;
  constructor(store: RecordStore<ConnectorEnrollment> = new MemoryRecordStore<ConnectorEnrollment>()) {
    this.#store = store;
  }
  put(e: ConnectorEnrollment): void {
    this.#store.put(enrollmentKey(e.principalSub, e.id, e.tenantRef), e);
  }
  all(): ConnectorEnrollment[] {
    return this.#store.all();
  }
  forPrincipal(principalSub: string, connectorInstanceId: string): ConnectorEnrollment[] {
    return this.#store.all().filter((e) => e.principalSub === principalSub && e.id === connectorInstanceId);
  }
  setState(principalSub: string, connectorInstanceId: string, tenantRef: string, state: LifecycleState): void {
    const k = enrollmentKey(principalSub, connectorInstanceId, tenantRef);
    const e = this.#store.get(k);
    if (e) this.#store.put(k, { ...e, state });
  }
  reload(): void {
    this.#store.reload();
  }
}

// ---------------------------------------------------------------------------
// §6.4 — Secret-status store (status only; NEVER the value)
// ---------------------------------------------------------------------------

export type SecretKey = {
  principalSub: string;
  tenantRef: string;
  workspaceRef?: string;
  connectorInstanceId: string;
  name: string;
};

export const secretKeyOf = (k: SecretKey): string =>
  [k.principalSub, k.tenantRef, k.workspaceRef ?? '-', k.connectorInstanceId, k.name].join('::');

export interface SecretStatusStore {
  put(key: SecretKey, status: SecretStatus): void;
  get(key: SecretKey): SecretStatus | undefined;
  all(): SecretStatus[];
  reload(): void;
}

export class PersistentSecretStatusStore implements SecretStatusStore {
  readonly #store: RecordStore<SecretStatus>;
  constructor(store: RecordStore<SecretStatus> = new MemoryRecordStore<SecretStatus>()) {
    this.#store = store;
  }
  put(key: SecretKey, status: SecretStatus): void {
    this.#store.put(secretKeyOf(key), status);
  }
  get(key: SecretKey): SecretStatus | undefined {
    return this.#store.get(secretKeyOf(key));
  }
  all(): SecretStatus[] {
    return this.#store.all();
  }
  reload(): void {
    this.#store.reload();
  }
}

// ---------------------------------------------------------------------------
// §5.1 — Elicitation record store
// ---------------------------------------------------------------------------

export interface ElicitationStore {
  get(id: string): ElicitationRecord | undefined;
  put(rec: ElicitationRecord): void;
  all(): ElicitationRecord[];
  reload(): void;
}

export class PersistentElicitationStore implements ElicitationStore {
  readonly #store: RecordStore<ElicitationRecord>;
  constructor(store: RecordStore<ElicitationRecord> = new MemoryRecordStore<ElicitationRecord>()) {
    this.#store = store;
  }
  get(id: string): ElicitationRecord | undefined {
    return this.#store.get(id);
  }
  put(rec: ElicitationRecord): void {
    this.#store.put(rec.id, rec);
  }
  all(): ElicitationRecord[] {
    return this.#store.all();
  }
  reload(): void {
    this.#store.reload();
  }
}
