/**
 * Slice 2 — In-memory secret store + audited StpConnectorContext factory.
 *
 * Implements the §4.5 audited just-in-time secret accessor and the §6.4
 * restart-safe, fail-closed secret-status lookup. There is NO bulk secret map on
 * the context: `getSecret(name)` resolves one value per call, audits the access
 * (NAME only, never the value) and fails closed when the record is missing or
 * not `active`.
 *
 * MOCK-ONLY: in-memory store keyed by the §6.4 composite key.
 */
import type { InMemoryAuditSink, SecretRedactor } from './audit.js';
import type {
  LifecycleState,
  SecretStatus,
  StpConnectorContext,
} from './runtime.js';
import type { AuthFreshnessPolicy } from './manifest.js';

export class SecretAccessError extends Error {
  constructor(
    readonly name: string,
    readonly reason: 'missing' | LifecycleState,
  ) {
    super(`secret '${name}' unavailable: ${reason}`);
    this.name = 'SecretAccessError';
  }
}

type SecretKey = {
  principalSub: string;
  tenantRef: string;
  workspaceRef?: string;
  connectorInstanceId: string;
  name: string;
};

const keyOf = (k: SecretKey): string =>
  [k.principalSub, k.tenantRef, k.workspaceRef ?? '-', k.connectorInstanceId, k.name].join('::');

/** In-memory secret store; persistence-shaped (composite key), restart-safe. */
export class MockSecretStore {
  readonly #records = new Map<string, { value: string; status: SecretStatus }>();
  readonly #redactor: SecretRedactor;

  constructor(redactor: SecretRedactor) {
    this.#redactor = redactor;
  }

  /** Enroll/mint a secret. The value is registered with the redactor so it can
   *  never be echoed in logs, audit events, prompts or fixtures. */
  put(key: SecretKey, value: string): void {
    this.#redactor.register(value);
    this.#records.set(keyOf(key), {
      value,
      status: { name: key.name, scope: 'connector-instance', state: 'active' },
    });
  }

  transition(key: SecretKey, state: LifecycleState): void {
    const rec = this.#records.get(keyOf(key));
    if (rec) {
      if (state !== 'active') this.#redactor.forget(rec.value);
      rec.status = { ...rec.status, state, rotatedAt: new Date().toISOString() };
    }
  }

  /** State-only status (never the value), fail-closed when missing (§6.4). */
  statusFor(key: SecretKey): SecretStatus {
    const rec = this.#records.get(keyOf(key));
    return rec ? rec.status : { name: key.name, scope: 'connector-instance', state: 'revoked' };
  }

  /** Resolve the value fail-closed: only `state === 'active'` authorizes use. */
  resolve(key: SecretKey): string {
    const rec = this.#records.get(keyOf(key));
    if (!rec) throw new SecretAccessError(key.name, 'missing');
    if (rec.status.state !== 'active') throw new SecretAccessError(key.name, rec.status.state);
    return rec.value;
  }
}

export type ContextDeps = {
  requestId: string;
  correlationId: string;
  auditId: string;
  principal: {
    sub: string;
    claims: Record<string, unknown>;
    scopes: string[];
    tenantRef: string;
    workspaceRef?: string;
    authTime: string;
    freshness?: AuthFreshnessPolicy;
  };
  surface: 'chat' | 'vscode' | 'stp' | 'backend';
  mcpClient?: { clientId: string; client: string };
  mcpSessionId: string;
  connectorInstanceId: string;
  consentRefs: string[];
  grantRefs: string[];
  connectorConfig?: Record<string, unknown>;
  secretStore: MockSecretStore;
  audit: InMemoryAuditSink;
};

/**
 * Build a concrete StpConnectorContext whose `getSecret` is per-call audited
 * (NAME only) and fail-closed. The returned value is handed to connector code
 * but is never logged: the audit event records the name and resulting state.
 */
export function createStpConnectorContext(deps: ContextDeps): StpConnectorContext {
  const baseKey = {
    principalSub: deps.principal.sub,
    tenantRef: deps.principal.tenantRef,
    workspaceRef: deps.principal.workspaceRef,
    connectorInstanceId: deps.connectorInstanceId,
  };
  return {
    requestId: deps.requestId,
    correlationId: deps.correlationId,
    auditId: deps.auditId,
    principal: deps.principal,
    surface: deps.surface,
    mcpClient: deps.mcpClient,
    session: { mcpSessionId: deps.mcpSessionId },
    tenantRef: deps.principal.tenantRef,
    workspaceRef: deps.principal.workspaceRef,
    connectorInstanceId: deps.connectorInstanceId,
    consentRefs: deps.consentRefs,
    grantRefs: deps.grantRefs,
    connectorConfig: deps.connectorConfig ?? {},
    audit: deps.audit,
    logger: { log: (...p: unknown[]) => deps.audit.log(...p) },
    async getSecret(name: string): Promise<string> {
      const key = { ...baseKey, name };
      try {
        const value = deps.secretStore.resolve(key);
        await deps.audit.emit({
          kind: 'secret.access',
          auditId: deps.auditId,
          correlationId: deps.correlationId,
          at: new Date().toISOString(),
          detail: { name, state: 'active', result: 'granted' }, // NAME only, never value
        });
        return value;
      } catch (err) {
        const reason = err instanceof SecretAccessError ? err.reason : 'error';
        await deps.audit.emit({
          kind: 'secret.access',
          auditId: deps.auditId,
          correlationId: deps.correlationId,
          at: new Date().toISOString(),
          detail: { name, state: reason, result: 'denied' },
        });
        throw err;
      }
    },
  };
}
