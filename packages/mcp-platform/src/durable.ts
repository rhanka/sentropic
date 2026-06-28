/**
 * Slice 7 — MOCK durable-call / workflow adapter for long-running MCP tools.
 *
 * Models a long-running MCP tool call via the canonical DurableCall lifecycle
 * (SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM §8 -> SPEC_EVOL_AGENT_RUNTIME_HERMES_LOOP
 * §3.2): queued -> running -> waiting -> succeeded|failed|cancelled, with the
 * `waiting` state qualified by DurableCallWaitingFor
 * (elicitation|consent|freshness|external-workflow). The canonical `DurableCall`
 * shape is NOT forked: MCP correlation is threaded alongside it via
 * `McpDurableCallRefs` (`McpDurableCall = { call, refs, waitingFor? }`).
 *
 * Guarantees exercised by the slice-7 probes:
 * - restart-safe: records persist through a `DurableCallStore` over the slice-3
 *   `RecordStore<T>`; a brand-new adapter at the same medium resumes a mid-flight
 *   call (§6.3 / §11 "Long call lifecycle").
 * - idempotent launch: a repeated launch with the SAME idempotencyKey returns the
 *   SAME durable call — never a duplicate (§8).
 * - fail-closed resume: a `waiting` call only resumes once its wait condition is
 *   cleared (elicitation gate released / consent present / …). A waiting-on-consent
 *   call can NEVER reach `succeeded` until consent is present (succeed is reachable
 *   only from `running`).
 * - audited: every transition emits a redacted audit event carrying ids / state /
 *   refs only — NEVER a token, secret value or PII.
 *
 * MOCK-ONLY: no real workflow engine, queue, Redis, network or DB — deterministic
 * in-memory (or tmp-file) state only.
 */
import { randomUUID } from 'node:crypto';
import { MemoryRecordStore, type RecordStore } from './persistence.js';
import type { InMemoryAuditSink } from './audit.js';
import type { ElicitationManager } from './elicitation.js';
import type {
  AppToolInvocation,
  DurableCall,
  DurableCallKind,
  DurableCallState,
  DurableCallWaitingFor,
  McpDurableCall,
} from './runtime.js';

const TERMINAL: ReadonlySet<DurableCallState> = new Set(['succeeded', 'failed', 'cancelled']);

// ---------------------------------------------------------------------------
// Persistence — DurableCallStore over the slice-3 RecordStore (restart-safe)
// ---------------------------------------------------------------------------

export interface DurableCallStore {
  get(id: string): McpDurableCall | undefined;
  put(rec: McpDurableCall): void;
  all(): McpDurableCall[];
  /** Idempotency lookup (§8): the existing call for an idempotencyKey, if any. */
  findByIdempotencyKey(key: string): McpDurableCall | undefined;
  reload(): void;
  snapshot(): string;
}

export class PersistentDurableCallStore implements DurableCallStore {
  readonly #store: RecordStore<McpDurableCall>;
  constructor(store: RecordStore<McpDurableCall> = new MemoryRecordStore<McpDurableCall>()) {
    this.#store = store;
  }
  get(id: string): McpDurableCall | undefined {
    return this.#store.get(id);
  }
  put(rec: McpDurableCall): void {
    this.#store.put(rec.call.id, rec);
  }
  all(): McpDurableCall[] {
    return this.#store.all();
  }
  findByIdempotencyKey(key: string): McpDurableCall | undefined {
    return this.#store.all().find((r) => r.refs.idempotencyKey === key);
  }
  reload(): void {
    this.#store.reload();
  }
  snapshot(): string {
    return this.#store.snapshot();
  }
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export type DurableCallAdapterDeps = {
  audit: InMemoryAuditSink;
  store?: DurableCallStore;
  /** Resolves the elicitation gate for `waitingFor === 'elicitation'`. */
  elicitations?: ElicitationManager;
  /**
   * Clears a non-elicitation wait (consent / freshness / external-workflow).
   * FAIL-CLOSED default: with no resolver the wait NEVER clears, so a
   * waiting-on-consent call can never succeed without an explicit clearance.
   */
  isWaitCleared?: (rec: McpDurableCall) => boolean;
  now?: () => number;
  newId?: () => string;
};

export type DurableLaunchInput = {
  envelope: AppToolInvocation;
  kind?: DurableCallKind; // default 'mcp'
  delegated?: boolean; // canonical authz.delegated (default false)
  workflowRunId?: string;
};

/**
 * Drives the canonical DurableCall lifecycle for a long-running MCP tool. All
 * transitions are synchronous and fail-closed; every hop is persisted and
 * audited. A brand-new adapter at the same `store` medium = a process restart.
 */
export class DurableCallAdapter {
  readonly #store: DurableCallStore;
  readonly #audit: InMemoryAuditSink;
  readonly #elicitations?: ElicitationManager;
  readonly #isWaitCleared?: (rec: McpDurableCall) => boolean;
  readonly #now: () => number;
  readonly #newId: () => string;

  constructor(deps: DurableCallAdapterDeps) {
    this.#store = deps.store ?? new PersistentDurableCallStore();
    this.#audit = deps.audit;
    this.#elicitations = deps.elicitations;
    this.#isWaitCleared = deps.isWaitCleared;
    this.#now = deps.now ?? ((): number => Date.now());
    this.#newId = deps.newId ?? ((): string => `dc-${randomUUID()}`);
  }

  /** Re-read records from the durable medium (restart-safe lookup, §11). */
  reload(): void {
    this.#store.reload();
  }

  status(id: string): McpDurableCall | undefined {
    return this.#store.get(id);
  }

  /**
   * Launch (or idempotently return the existing) durable call in `queued`. A
   * repeated launch with the same idempotencyKey returns the SAME record — no
   * duplicate is ever created (§8).
   */
  launch(input: DurableLaunchInput): McpDurableCall {
    const { envelope } = input;
    const key = envelope.idempotencyKey;
    if (key !== undefined) {
      const existing = this.#store.findByIdempotencyKey(key);
      if (existing) {
        this.#emit('durable.launch.idempotent_hit', existing);
        return existing; // same call, no duplicate
      }
    }
    const at = new Date(this.#now()).toISOString();
    const ctx = envelope.ctx;
    const rec: McpDurableCall = {
      call: {
        id: this.#newId(),
        kind: input.kind ?? 'mcp',
        requestedBy: { surface: ctx.surface, userId: ctx.principal.sub },
        mandateRef: ctx.mandateRef,
        trackRef: ctx.trackRef,
        workflowRunId: input.workflowRunId,
        capabilityRef: envelope.capabilityRef,
        authz: {
          scopes: ctx.principal.scopes,
          consentRef: ctx.consentRefs[0],
          delegated: input.delegated ?? false,
        },
        state: 'queued',
        evidenceRefs: [],
        createdAt: at,
        updatedAt: at,
      },
      refs: {
        sessionRef: ctx.session.mcpSessionId,
        connectorInstanceRef: ctx.connectorInstanceId,
        tenantRef: ctx.tenantRef,
        workspaceRef: ctx.workspaceRef,
        idempotencyKey: envelope.idempotencyKey,
        elicitationRef: envelope.elicitationRef,
        auditId: ctx.auditId,
        correlationId: ctx.correlationId,
      },
    };
    this.#store.put(rec);
    this.#emit('durable.launch', rec);
    return rec;
  }

  /** queued -> running. */
  start(id: string): McpDurableCall {
    return this.#transition(id, 'start', (rec) => {
      if (rec.call.state !== 'queued') return undefined;
      rec.call.state = 'running';
      return rec;
    });
  }

  /** running -> waiting(<reason>). */
  wait(id: string, waitingFor: DurableCallWaitingFor): McpDurableCall {
    return this.#transition(id, 'wait', (rec) => {
      if (rec.call.state !== 'running') return undefined;
      rec.call.state = 'waiting';
      rec.waitingFor = waitingFor;
      return rec;
    });
  }

  /**
   * waiting -> running, ONLY once the wait condition is cleared. `checkpointRef`
   * records the resume point. A still-blocked wait stays `waiting` (fail-closed)
   * and emits a `durable.resume.blocked` audit; a non-waiting call is a no-op.
   */
  resume(id: string, opts?: { checkpointRef?: string }): McpDurableCall {
    const rec = this.#require(id);
    if (rec.call.state !== 'waiting') {
      this.#emit('durable.resume.denied', rec);
      return rec;
    }
    if (!this.#waitCleared(rec)) {
      this.#emit('durable.resume.blocked', rec); // wait condition unmet → stays waiting
      return rec;
    }
    rec.call.state = 'running';
    rec.waitingFor = undefined;
    if (opts?.checkpointRef !== undefined) rec.call.checkpointRef = opts.checkpointRef;
    return this.#commit(rec, 'resume');
  }

  /** running -> succeeded (guarded: a `waiting` call MUST resume first). */
  succeed(id: string, evidenceRef?: string): McpDurableCall {
    return this.#transition(id, 'succeed', (rec) => {
      if (rec.call.state !== 'running') return undefined; // never from waiting/queued/terminal
      rec.call.state = 'succeeded';
      if (evidenceRef !== undefined) rec.call.evidenceRefs = [...rec.call.evidenceRefs, evidenceRef];
      return rec;
    });
  }

  /** running|waiting -> failed. */
  fail(id: string, code: string): McpDurableCall {
    return this.#transition(
      id,
      'fail',
      (rec) => {
        if (rec.call.state !== 'running' && rec.call.state !== 'waiting') return undefined;
        rec.call.state = 'failed';
        rec.waitingFor = undefined;
        return rec;
      },
      { code },
    );
  }

  /** queued|running|waiting -> cancelled (records the cancellation reason). */
  cancel(id: string, reason: string): McpDurableCall {
    return this.#transition(id, 'cancel', (rec) => {
      if (TERMINAL.has(rec.call.state)) return undefined;
      rec.call.state = 'cancelled';
      rec.waitingFor = undefined;
      rec.refs = { ...rec.refs, cancellationReason: reason };
      return rec;
    });
  }

  // ---- internals ----

  #waitCleared(rec: McpDurableCall): boolean {
    if (rec.waitingFor === 'elicitation') {
      const ref = rec.refs.elicitationRef;
      return ref !== undefined && this.#elicitations?.isGateReleased(ref) === true;
    }
    // consent / freshness / external-workflow → injected resolver (fail-closed default)
    return this.#isWaitCleared?.(rec) === true;
  }

  #transition(
    id: string,
    op: string,
    mutate: (rec: McpDurableCall) => McpDurableCall | undefined,
    extra?: Record<string, unknown>,
  ): McpDurableCall {
    const rec = this.#require(id);
    const next = mutate(rec);
    if (!next) {
      this.#emit(`durable.${op}.denied`, rec, extra); // illegal for current state → no-op, audited
      return rec;
    }
    return this.#commit(next, op, extra);
  }

  #commit(rec: McpDurableCall, op: string, extra?: Record<string, unknown>): McpDurableCall {
    rec.call.updatedAt = new Date(this.#now()).toISOString();
    this.#store.put(rec);
    this.#emit(`durable.${op}`, rec, extra);
    return rec;
  }

  #require(id: string): McpDurableCall {
    const rec = this.#store.get(id);
    if (!rec) throw new Error(`unknown durable call '${id}'`);
    return rec;
  }

  /** Redacted audit: ids / state / refs only — NEVER a token, secret value or PII. */
  #emit(kind: string, rec: McpDurableCall, extra?: Record<string, unknown>): void {
    void this.#audit.emit({
      kind,
      auditId: rec.refs.auditId,
      correlationId: rec.refs.correlationId,
      at: new Date(this.#now()).toISOString(),
      detail: {
        durableCallRef: rec.call.id,
        kind: rec.call.kind,
        capability: rec.call.capabilityRef,
        state: rec.call.state,
        waitingFor: rec.waitingFor,
        idempotencyKey: rec.refs.idempotencyKey,
        sessionRef: rec.refs.sessionRef,
        connectorInstanceRef: rec.refs.connectorInstanceRef,
        tenantRef: rec.refs.tenantRef,
        ...extra,
      },
    });
  }
}
