/**
 * BR-72 DEPTH Lot 2 — minimal, connector-AGNOSTIC MCP provider broker.
 *
 * Generalizes the "mount + invoke" seam proven per-connector in
 * `../../mcp-connector-github/src/live-broker.ts` (BR-72 DEPTH Lot 1): a
 * `ConnectorRegistry` mounts any number of `AppConnectorProviderAdapter`s,
 * and `McpProviderBroker.invoke()` dispatches resource-vs-tool through the
 * SAME code path regardless of which connector is targeted. No
 * connector-specific logic lives in this file — the only connector-aware
 * code in this package is the SMOKE script
 * (`../scripts/smoke-broker-github.mjs`), which mounts the real github live
 * adapter as ONE example connector to prove the seam end-to-end.
 *
 * Production residence of a broker like this one (in-process library vs. a
 * hosted service, real secret-store / EnrollmentStore wiring, tenant
 * resolution policy) is an architect D4 decision, deferred — this package is
 * a proof (`"private": true`, not published), not a shipped runtime.
 */
import type { AppCapability, CapabilityResource } from '../../mcp-platform/src/manifest.js';
import type {
  AppConnectorProviderAdapter,
  AppResultEnvelope,
  StpConnectorContext,
} from '../../mcp-platform/src/runtime.js';
import { createInMemoryContext, type InMemoryContextOptions } from './context.js';
import { ConnectorRegistry } from './registry.js';

export class UnknownConnectorError extends Error {
  readonly code = 'unknown_connector';
  readonly connectorId: string;

  constructor(connectorId: string) {
    super(`McpProviderBroker: no connector registered for connectorId "${connectorId}".`);
    this.name = 'UnknownConnectorError';
    this.connectorId = connectorId;
  }
}

export class McpBrokerError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'McpBrokerError';
    this.code = code;
  }
}

export type InvokeOptions = {
  ctx?: StpConnectorContext;
  secretResolver?: InMemoryContextOptions['secretResolver'];
  token?: string;
};

let brokerAuditSequence = 0;
function nextBrokerAuditId(prefix: string): string {
  brokerAuditSequence += 1;
  return `${prefix}-${Date.now()}-${brokerAuditSequence}`;
}

function findCapability(
  adapter: AppConnectorProviderAdapter,
  capabilityRef: string,
): AppCapability | undefined {
  return (
    adapter.manifest.resources.find((c) => c.name === capabilityRef) ??
    adapter.manifest.tools.find((c) => c.name === capabilityRef) ??
    adapter.manifest.prompts.find((c) => c.name === capabilityRef)
  );
}

// Connector-AGNOSTIC resource URI resolution: uses the CAPABILITY'S OWN
// declared `uriTemplate` (`../../mcp-platform/src/manifest.ts`'s
// `CapabilityResource.uriTemplate`) and substitutes `{param}` placeholders
// from the caller-supplied `input` object — no connector-specific parsing
// (contrast with github's per-capability `buildResourceUri` switch in
// `../../mcp-connector-github/src/live-broker.ts`, which this generalizes
// away). A bare string input, or a single-key `{ uri }` object, is used
// as-is (the caller already built the URI itself).
function resolveResourceUri(capability: CapabilityResource, input: unknown): string {
  if (typeof input === 'string') {
    return input;
  }
  const params = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  if (typeof params.uri === 'string' && Object.keys(params).length === 1) {
    return params.uri;
  }
  const missing: string[] = [];
  const uri = capability.uriTemplate.replace(/\{([^}]+)\}/g, (_match, key: string) => {
    const value = params[key];
    if (value === undefined || value === null) {
      missing.push(key);
      return '';
    }
    return String(value);
  });
  if (missing.length > 0) {
    throw new McpBrokerError(
      'missing_resource_uri_param',
      `Resource capability "${capability.name}" uriTemplate "${capability.uriTemplate}" requires param(s) [${missing.join(', ')}], not present in input.`,
    );
  }
  return uri;
}

/**
 * `McpProviderBroker` — mount any number of connectors via a
 * `ConnectorRegistry`, invoke any of their capabilities through ONE
 * connector-agnostic dispatch path (`invoke`). `contextFactory` defaults to
 * `createInMemoryContext` (see `./context.ts`) but can be overridden — e.g.
 * with a factory backed by a real EnrollmentStore/TenantResolver PORT later.
 */
export class McpProviderBroker {
  private readonly registry: ConnectorRegistry;
  private readonly contextFactory: (opts?: InMemoryContextOptions) => StpConnectorContext;

  constructor(opts: {
    registry: ConnectorRegistry;
    contextFactory?: (opts?: InMemoryContextOptions) => StpConnectorContext;
  }) {
    this.registry = opts.registry;
    this.contextFactory = opts.contextFactory ?? createInMemoryContext;
  }

  listConnectors(): string[] {
    return this.registry.list();
  }

  private resolveAdapter(connectorId: string): AppConnectorProviderAdapter {
    const adapter = this.registry.get(connectorId);
    if (!adapter) {
      throw new UnknownConnectorError(connectorId);
    }
    return adapter;
  }

  /**
   * List a connector's capabilities via its OWN adapter contract:
   * `resolveTenant()` narrows a `ConnectorTenantContext` from the given (or
   * default in-memory) `StpConnectorContext`, then `listCapabilities()` is
   * called against that narrowed tenant context — mirrors how a real core
   * would call these two adapter methods in sequence (§4.4).
   */
  async listCapabilities(connectorId: string, ctx?: StpConnectorContext): Promise<AppCapability[]> {
    const adapter = this.resolveAdapter(connectorId);
    const stpCtx = ctx ?? this.contextFactory({ connectorInstanceId: connectorId });
    const tenantCtx = await adapter.resolveTenant({
      principalSub: stpCtx.principal.sub,
      tenantRef: stpCtx.tenantRef,
      workspaceRef: stpCtx.workspaceRef,
      connectorInstanceId: stpCtx.connectorInstanceId,
    });
    return adapter.listCapabilities(tenantCtx);
  }

  /**
   * Dispatch a single capability invocation through the connector's
   * `AppConnectorProviderAdapter`. Resource-vs-tool dispatch mirrors
   * `../../mcp-connector-github/src/live-broker.ts`'s `invokeGithubLive`,
   * generalized: which method to call (`readResource` vs `invokeTool`) is
   * decided from the capability's OWN declared `kind` in the connector's
   * manifest, never from a per-connector allowlist.
   */
  async invoke(
    connectorId: string,
    capabilityRef: string,
    input: unknown,
    opts?: InvokeOptions,
  ): Promise<AppResultEnvelope<unknown>> {
    const adapter = this.resolveAdapter(connectorId);
    const token = opts?.token;
    const ctx =
      opts?.ctx ??
      this.contextFactory({
        connectorInstanceId: connectorId,
        secretResolver: opts?.secretResolver ?? (token !== undefined ? () => token : undefined),
      });

    const capability = findCapability(adapter, capabilityRef);
    if (!capability) {
      return {
        ok: false,
        auditId: nextBrokerAuditId('mcp-broker-unknown-capability'),
        redactionClass: 'none',
        error: {
          code: 'unknown_capability',
          message: `McpProviderBroker: connector "${connectorId}" has no capability named "${capabilityRef}".`,
          retriable: false,
        },
      };
    }

    if (capability.kind === 'resource') {
      try {
        const uri = resolveResourceUri(capability, input);
        return await adapter.readResource({ capabilityRef, input: { uri }, ctx });
      } catch (err) {
        if (err instanceof McpBrokerError) {
          return {
            ok: false,
            auditId: nextBrokerAuditId('mcp-broker-resource-input-error'),
            redactionClass: 'none',
            error: { code: err.code, message: err.message, retriable: false },
          };
        }
        throw err;
      }
    }

    if (capability.kind === 'tool') {
      const result = await adapter.invokeTool({ capabilityRef, input, ctx });
      if (typeof result === 'string') {
        // Guard the DurableCallRef string return (§8 durable-call refs) —
        // this in-memory broker proof does not implement durable-call
        // tracking/polling; mirrors the same guard in
        // `../../mcp-connector-github/src/live-broker.ts`'s `invokeGithubLive`.
        throw new Error(
          `McpProviderBroker: unexpected DurableCallRef "${result}" for capability "${capabilityRef}" — this in-memory broker proof does not support durable/long-running tool calls.`,
        );
      }
      return result;
    }

    // capability.kind === 'prompt'
    if (!adapter.renderPrompt) {
      return {
        ok: false,
        auditId: nextBrokerAuditId('mcp-broker-unsupported-capability-kind'),
        redactionClass: 'none',
        error: {
          code: 'unsupported_capability_kind',
          message: `McpProviderBroker: connector "${connectorId}" declares prompt capability "${capabilityRef}" but its adapter does not implement renderPrompt.`,
          retriable: false,
        },
      };
    }
    const promptInput = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
    return adapter.renderPrompt({ capabilityRef, input: promptInput, ctx });
  }
}
