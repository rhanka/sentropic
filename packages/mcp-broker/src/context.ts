/**
 * BR-72 DEPTH Lot 2 — generalized in-memory `StpConnectorContext` factory.
 *
 * Generalizes the pattern proven per-connector in
 * `../../mcp-connector-github/src/live-broker.ts`'s `makeLiveConnectorContext`
 * (BR-72 DEPTH Lot 1): stub principal/tenant/connectorInstanceId/session,
 * `audit.emit` writing a REDACTED line to `console.error` by default, and
 * `logger` defaulting to `console`. Nothing here is connector-specific.
 *
 * `getSecret` delegates to an INJECTABLE `secretResolver` (default: always
 * resolves to `''`, i.e. no secret store wired). THIS is the seam a future
 * EnrollmentStore / TenantResolver PORT replaces — the factory only defines
 * the injection point (`opts.secretResolver: (name: string) => Promise<string>
 * | string`); it deliberately does NOT pre-empt that PORT's own shape,
 * lifecycle, or storage.
 *
 * NEVER log or echo a secret VALUE — the default `auditSink` only ever
 * receives whatever event shape the CALLER passes to `audit.emit`, and
 * callers are redaction-obligated (see `StpConnectorContext.audit` in
 * `../../mcp-platform/src/runtime.ts`).
 */
import type { StpConnectorContext } from '../../mcp-platform/src/runtime.js';

export type SecretResolver = (name: string) => Promise<string> | string;

export type InMemoryContextOptions = {
  principalSub?: string;
  tenantRef?: string;
  workspaceRef?: string;
  connectorInstanceId?: string;
  scopes?: string[];
  surface?: StpConnectorContext['surface'];
  // Injection seam for a future EnrollmentStore/TenantResolver PORT — see
  // module docblock above. Defaults to a resolver that always returns ''.
  secretResolver?: SecretResolver;
  auditSink?: (event: unknown) => Promise<void> | void;
  logger?: unknown;
};

let sequence = 0;
function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now()}-${sequence}`;
}

/**
 * Build a contract-complete, connector-AGNOSTIC in-memory `StpConnectorContext`.
 * Every REQUIRED field declared on `StpConnectorContext`
 * (`../../mcp-platform/src/runtime.ts`) is present with a correctly-shaped
 * value; optional fields (`workspaceRef`, `mcpClient`, `mandateRef`,
 * `trackRef`, `principal.freshness`) are simply omitted.
 */
export function createInMemoryContext(opts: InMemoryContextOptions = {}): StpConnectorContext {
  const principalSub = opts.principalSub ?? 'mcp-broker-inmemory-principal';
  const tenantRef = opts.tenantRef ?? 'mcp-broker-inmemory-tenant';
  const connectorInstanceId = opts.connectorInstanceId ?? 'mcp-broker-inmemory-connector-instance';
  const now = new Date().toISOString();
  const auditSink =
    opts.auditSink ??
    ((event: unknown) => {
      // REDACTED console audit sink by default — never emits a secret value;
      // the caller of `audit.emit` is redaction-obligated for whatever event
      // shape it passes.
      console.error('[mcp-broker audit]', JSON.stringify(event));
    });

  const context: StpConnectorContext = {
    requestId: nextId('mcp-broker-req'),
    correlationId: nextId('mcp-broker-corr'),
    auditId: nextId('mcp-broker-audit'),
    principal: {
      sub: principalSub,
      claims: {},
      scopes: opts.scopes ?? [],
      tenantRef,
      authTime: now,
    },
    surface: opts.surface ?? 'backend',
    session: { mcpSessionId: nextId('mcp-broker-session') },
    tenantRef,
    connectorInstanceId,
    consentRefs: [],
    grantRefs: [],
    // Audited just-in-time secret accessor — resolves the raw secret VALUE
    // for this single call only, via the injectable `secretResolver` seam
    // (see module docblock). Never logged/echoed by this factory.
    getSecret: async (name: string) => {
      if (!opts.secretResolver) {
        return '';
      }
      return opts.secretResolver(name);
    },
    connectorConfig: {},
    audit: {
      emit: async (event: unknown) => {
        await auditSink(event);
      },
    },
    logger: opts.logger ?? console,
  };

  if (opts.workspaceRef !== undefined) {
    context.workspaceRef = opts.workspaceRef;
  }

  return context;
}
