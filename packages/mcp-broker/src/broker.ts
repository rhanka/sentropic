/**
 * MCP-L5 Lot 1 — plan-bound MCP provider broker.
 *
 * Dispatches through ONE connector-agnostic path against the immutable
 * compiled registry plan. Adapters are bound once at construction from that
 * plan; consumers cannot register handlers separately or replace the plan.
 *
 * Every invocation requires a verified host `StpConnectorContext`. A
 * missing or untrusted context throws the M2 pre-dispatch protocol error
 * (-32603, `Trusted invocation context unavailable`) before provider
 * dispatch, reservation, canonical access or effect — never a domain
 * envelope and never a fabricated audit reference. Memory tools additionally
 * resolve their exact plan entry, provider/connector source binding and
 * scope/claim coverage, and bind the neutral context projection before the
 * adapter is contacted.
 */

import type {
  AppCapability,
  AppConnectorProviderAdapter,
  AppResultEnvelope,
  CapabilityResource,
  StpConnectorContext,
} from '@sentropic/mcp-platform';
import type { CompiledMcpRegistry } from '@sentropic/mcp-platform/registry';
import {
  MEMORY_CONNECTOR_ID,
  MEMORY_PROVIDER_ID,
  TRUSTED_CONTEXT_PROTOCOL_ERROR_CODE,
  TRUSTED_CONTEXT_UNAVAILABLE_MESSAGE,
  MemoryTrustedContextError,
  isMemoryToolName,
  requireTrustedInvocationContext,
  type PublicMemoryErrorCode,
} from '@sentropic/mcp-platform/memory';
import { CompiledMemoryDispatch, MemoryDispatchRefusal } from './memory/compiled-dispatch.js';
import { CompiledConnectorIndex } from './registry.js';

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

/** Trusted-context protocol refusal: -32603, constant message, no envelope. */
function trustedContextRefusal(): McpBrokerError {
  return new McpBrokerError(
    String(TRUSTED_CONTEXT_PROTOCOL_ERROR_CODE),
    TRUSTED_CONTEXT_UNAVAILABLE_MESSAGE,
  );
}

export type InvokeOptions = {
  /** Verified host invocation context (REQUIRED, never manufactured). */
  ctx: StpConnectorContext;
  /** Validated domain purpose for memory tools (REQUIRED for memory tools). */
  purposeRef?: string;
  /** Envelope idempotency key for memory mutations (REQUIRED for memory tools). */
  idempotencyKey?: string;
  /** Satisfied elicitation reference for memory mutations. */
  elicitationRef?: string;
};

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
// declared `uriTemplate` and substitutes `{param}` placeholders from the
// caller-supplied `input` object. A bare string input, or a single-key
// `{ uri }` object, is used as-is.
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

export type McpProviderBrokerOptions = {
  plan: CompiledMcpRegistry;
  adapters: AppConnectorProviderAdapter[];
  sourceId: string;
  generation: string;
};

/**
 * `McpProviderBroker` — plan-bound dispatch over the adapters mounted from
 * that plan. `sourceId` and the active `generation` are host-supplied
 * bindings carried into every memory selection.
 */
export class McpProviderBroker {
  private readonly memoryDispatch?: CompiledMemoryDispatch;
  private readonly index: CompiledConnectorIndex;
  private readonly sourceId: string;
  private readonly generation: string;

  constructor(opts: McpProviderBrokerOptions) {
    if (opts.sourceId.length === 0) {
      throw new McpBrokerError('source_binding_mismatch', 'McpProviderBroker: sourceId must be nonempty.');
    }
    if (opts.generation.length === 0) {
      throw new McpBrokerError('stale_generation', 'McpProviderBroker: generation must be nonempty.');
    }
    const memoryAdapters = opts.adapters.filter(a => a.manifest.providerId === MEMORY_PROVIDER_ID);
    if (memoryAdapters.length) this.memoryDispatch = new CompiledMemoryDispatch({ ...opts, adapters: memoryAdapters });
    this.index = new CompiledConnectorIndex(opts.plan, opts.adapters);
    this.sourceId = opts.sourceId;
    this.generation = opts.generation;
  }

  listConnectors(): string[] {
    return this.index.list();
  }

  private resolveAdapter(connectorId: string): AppConnectorProviderAdapter {
    const adapter = this.index.get(connectorId);
    if (!adapter) {
      throw new UnknownConnectorError(connectorId);
    }
    return adapter;
  }

  private requireCtx(opts: InvokeOptions | undefined): StpConnectorContext {
    try {
      return requireTrustedInvocationContext(opts?.ctx);
    } catch {
      throw trustedContextRefusal();
    }
  }

  /**
   * List a connector's capabilities via its OWN adapter contract:
   * `resolveTenant()` narrows a `ConnectorTenantContext` from the verified
   * context, then `listCapabilities()` is called against that narrowed
   * tenant context.
   */
  async listCapabilities(connectorId: string, ctx: StpConnectorContext): Promise<AppCapability[]> {
    const verified = this.requireCtx({ ctx });
    const adapter = this.resolveAdapter(connectorId);
    const stpCtx = verified;
    const tenantCtx = await adapter.resolveTenant({
      principalSub: stpCtx.principal.sub,
      tenantRef: stpCtx.tenantRef,
      workspaceRef: stpCtx.workspaceRef,
      connectorInstanceId: stpCtx.connectorInstanceId,
    });
    return adapter.listCapabilities(tenantCtx);
  }

  /**
   * Dispatch a single capability invocation through the plan-bound adapter.
   * Memory tools resolve their exact plan entry and source binding before
   * the adapter is contacted; any mismatch refuses with a domain envelope
   * and zero provider or effect calls.
   */
  async invoke(
    connectorId: string,
    capabilityRef: string,
    input: unknown,
    opts: InvokeOptions,
  ): Promise<AppResultEnvelope<unknown>> {
    const ctx = this.requireCtx(opts);
    const adapter = this.resolveAdapter(connectorId);

    const capability = findCapability(adapter, capabilityRef);
    if (!capability) {
      return {
        ok: false,
        auditId: ctx.auditId,
        redactionClass: isMemoryToolName(capabilityRef) ? 'high' : 'none',
        error: {
          code: isMemoryToolName(capabilityRef) ? 'CAPABILITY_UNAVAILABLE' : 'unknown_capability',
          message: `McpProviderBroker: connector "${connectorId}" has no capability named "${capabilityRef}".`,
          retriable: false,
        },
      };
    }

    if (isMemoryToolName(capabilityRef)) {
      return this.invokeMemoryTool(adapter, connectorId, capabilityRef, input, ctx, opts);
    }

    if (capability.kind === 'resource') {
      try {
        const uri = resolveResourceUri(capability, input);
        return await adapter.readResource({ capabilityRef, input: { uri }, ctx });
      } catch (err) {
        if (err instanceof McpBrokerError) {
          return {
            ok: false,
            auditId: ctx.auditId,
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
        // this broker proof does not implement durable-call
        // tracking/polling.
        throw new Error(
          `McpProviderBroker: unexpected DurableCallRef "${result}" for capability "${capabilityRef}" — durable/long-running tool calls are not supported here.`,
        );
      }
      return result;
    }

    // capability.kind === 'prompt'
    if (!adapter.renderPrompt) {
      return {
        ok: false,
        auditId: ctx.auditId,
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

  private async invokeMemoryTool(
    adapter: AppConnectorProviderAdapter,
    connectorId: string,
    capabilityRef: string,
    input: unknown,
    ctx: StpConnectorContext,
    opts: InvokeOptions,
  ): Promise<AppResultEnvelope<unknown>> {
    const memoryFailure = (code: PublicMemoryErrorCode, message: string): AppResultEnvelope<unknown> => ({
      ok: false,
      auditId: ctx.auditId,
      redactionClass: 'high',
      error: { code, message, retriable: false },
    });
    const args = input && typeof input === 'object' ? input as Record<string, any> : {};
    const purpose = capabilityRef === 'engram_memory_capture' ? args.payload?.purpose_ref : args.purpose_ref;
    let selected;
    try {
      if (!this.memoryDispatch || connectorId !== MEMORY_CONNECTOR_ID) throw new Error('memory dispatch unavailable');
      selected = this.memoryDispatch.select({
        toolName: capabilityRef, ctx, purposeRef: opts.purposeRef ?? '', idempotencyKey: opts.idempotencyKey,
        elicitationRef: opts.elicitationRef, expectedPrincipalSub: ctx.principal.sub,
        expectedTenantRef: ctx.tenantRef, expectedSourceId: this.sourceId, expectedGeneration: this.generation,
      });
      if (selected.adapter !== adapter) throw new Error('selected adapter mismatch');
    } catch (error) {
      if (error instanceof MemoryTrustedContextError) throw trustedContextRefusal();
      const code: PublicMemoryErrorCode = error instanceof MemoryDispatchRefusal
        ? error.refusalCode === 'unknown_tool' ? 'CAPABILITY_UNAVAILABLE'
          : error.refusalCode === 'stale_generation' ? 'AUTHORIZATION_REVOKED' : 'UNAUTHORIZED'
        : 'UNAUTHORIZED';
      return memoryFailure(code, 'Memory invocation refused by the current dispatch binding.');
    }
    if (opts.purposeRef === undefined || (purpose !== undefined && purpose !== opts.purposeRef) ||
        (['engram_memory_search', 'engram_memory_get', 'engram_memory_capture'].includes(capabilityRef) && purpose === undefined) ||
        (args.idempotency_key !== undefined && args.idempotency_key !== opts.idempotencyKey)) {
      return memoryFailure('INVALID_SCHEMA', 'Memory arguments must match the trusted purpose and envelope bindings.');
    }
    const result = await selected.adapter.invokeTool({ capabilityRef, input, ctx,
      memoryConfirmationRequired: selected.selection.confirmationRequired,
      idempotencyKey: opts.idempotencyKey, elicitationRef: opts.elicitationRef, memoryContext: selected.projection });
    if (typeof result === 'string') {
      throw new Error(
        `McpProviderBroker: unexpected DurableCallRef "${result}" for memory capability "${capabilityRef}".`,
      );
    }
    return result;
  }
}
