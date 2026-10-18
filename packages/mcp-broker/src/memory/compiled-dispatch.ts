/**
 * MCP-L5 Lot 1 — compiled memory dispatch (broker seam).
 *
 * Exact-name selection against the immutable compiled registry plan plus
 * the verified memory source binding. Forged direct invocation without
 * verified context or selection fails before provider or effect;
 * same-named tools, changed sourceId, substituted provider/connector,
 * cross-principal or cross-tenant substitution and stale generation never
 * select another handler and never disclose another outcome.
 *
 * Consumers cannot register handlers separately or replace the compiled
 * plan: adapters are bound once at construction from the plan, and every
 * call re-resolves the exact tool name through that plan.
 */

import type {
  AppConnectorProviderAdapter,
  StpConnectorContext,
} from '@sentropic/mcp-platform/memory';
import {
  MEMORY_CONNECTOR_ID,
  MEMORY_PROVIDER_ID,
  isMemoryToolName,
  isMutatingMemoryToolName,
  isValidIdempotencyKey,
  isValidOpaqueRef,
  requireTrustedInvocationContext,
  type MemoryContextProjectionV1,
} from '@sentropic/mcp-platform/memory';
import { bindMemoryInvocation } from './context-projection.js';
import type {
  MemoryDispatchSelectionV1,
  MemorySourceBindingV1,
} from './contracts.js';

export type MemoryDispatchRefusalCode =
  | 'unknown_tool'
  | 'source_binding_mismatch'
  | 'stale_generation'
  | 'principal_mismatch'
  | 'tenant_mismatch'
  | 'insufficient_scope'
  | 'insufficient_claims';

/** Typed refusal raised before any provider contact or effect. */
export class MemoryDispatchRefusal extends Error {
  readonly refusalCode: MemoryDispatchRefusalCode;

  constructor(code: MemoryDispatchRefusalCode, detail: string) {
    super(`MemoryDispatch: ${code}: ${detail}`);
    this.name = 'MemoryDispatchRefusal';
    this.refusalCode = code;
  }
}

export type CompiledMemoryDispatchOptions = {
  plan: MemoryDispatchPlanV1;
  adapters: AppConnectorProviderAdapter[];
  sourceId: string;
  generation: string;
};

/** Structural view of the authoritative compiled plan; no secondary registry. */
type MemoryDispatchPlanV1 = {
  resolveTool(name: string): {
    providerId: string; capabilityName: string; requiredScopes: readonly string[]; requiredClaims: readonly string[];
  } | undefined;
};

export type SelectMemoryToolInput = {
  toolName: string;
  ctx: StpConnectorContext;
  purposeRef: string;
  idempotencyKey?: string;
  elicitationRef?: string;
  expectedPrincipalSub: string;
  expectedTenantRef: string;
  expectedSourceId: string;
  expectedGeneration: string;
};

export type SelectedMemoryToolV1 = {
  adapter: AppConnectorProviderAdapter;
  selection: MemoryDispatchSelectionV1;
  projection: MemoryContextProjectionV1;
  auditRef: string;
};

/**
 * Compiled memory dispatch bound once to an immutable plan. Selection is
 * exact-name through the plan; the adapter is the plan-bound adapter for
 * the resolved provider, never a separately registered handler.
 */
export class CompiledMemoryDispatch {
  private readonly plan: MemoryDispatchPlanV1;
  private readonly adaptersByConnector = new Map<string, AppConnectorProviderAdapter>();
  private readonly sourceId: string;
  private readonly generation: string;

  constructor(options: CompiledMemoryDispatchOptions) {
    if (options.sourceId.length === 0) {
      throw new MemoryDispatchRefusal('source_binding_mismatch', 'sourceId must be nonempty');
    }
    if (options.generation.length === 0) {
      throw new MemoryDispatchRefusal('stale_generation', 'generation must be nonempty');
    }
    this.plan = options.plan;
    this.sourceId = options.sourceId;
    this.generation = options.generation;
    for (const adapter of options.adapters) {
      if (adapter.manifest.providerId !== MEMORY_PROVIDER_ID || adapter.connectorId !== MEMORY_CONNECTOR_ID) {
        throw new MemoryDispatchRefusal(
          'source_binding_mismatch',
          `adapter "${adapter.connectorId}" is not the bound memory provider`,
        );
      }
      const incumbent = this.adaptersByConnector.get(adapter.connectorId);
      if (incumbent !== undefined && incumbent !== adapter) {
        throw new MemoryDispatchRefusal(
          'source_binding_mismatch',
          `duplicate adapter for connector "${adapter.connectorId}"`,
        );
      }
      this.adaptersByConnector.set(adapter.connectorId, adapter);
    }
    if (!this.adaptersByConnector.has(MEMORY_CONNECTOR_ID)) {
      throw new MemoryDispatchRefusal('source_binding_mismatch', 'memory adapter absent from dispatch');
    }
  }

  /**
   * Select the exact planned memory tool for one verified invocation.
   * Raises `MemoryDispatchRefusal` (or the trusted-context protocol error)
   * before any provider contact on any mismatch. Zero provider or effect
   * calls happen on refusal.
   */
  select(input: SelectMemoryToolInput): SelectedMemoryToolV1 {
    const verified = requireTrustedInvocationContext(input.ctx);
    if (input.expectedSourceId !== this.sourceId) {
      throw new MemoryDispatchRefusal('source_binding_mismatch', 'observed source differs from the bound source');
    }
    if (input.expectedGeneration !== this.generation) {
      throw new MemoryDispatchRefusal('stale_generation', 'observed generation differs from the active generation');
    }
    if (verified.memory?.binding.selected_source_id !== this.sourceId) {
      throw new MemoryDispatchRefusal('source_binding_mismatch', 'verified source differs from the bound source');
    }
    if (verified.memory.binding.active_generation !== this.generation) {
      throw new MemoryDispatchRefusal('stale_generation', 'verified generation differs from the active generation');
    }
    if (isMutatingMemoryToolName(input.toolName) && !isValidIdempotencyKey(input.idempotencyKey)) {
      throw new MemoryDispatchRefusal('source_binding_mismatch', 'mutation requires an envelope idempotency key');
    }
    if ((input.toolName === 'engram_memory_withdraw' || input.toolName === 'engram_memory_forget') && !isValidOpaqueRef(input.elicitationRef)) {
      throw new MemoryDispatchRefusal('source_binding_mismatch', 'destructive mutation requires an elicitation reference');
    }
    if (!isMemoryToolName(input.toolName)) {
      throw new MemoryDispatchRefusal('unknown_tool', `no memory tool named "${input.toolName}"`);
    }
    const resolution = this.plan.resolveTool(input.toolName);
    if (resolution === undefined) {
      throw new MemoryDispatchRefusal('unknown_tool', `"${input.toolName}" is not in the compiled plan`);
    }
    if (resolution.providerId !== MEMORY_PROVIDER_ID) {
      throw new MemoryDispatchRefusal(
        'source_binding_mismatch',
        `"${input.toolName}" resolves to provider "${resolution.providerId}", not the memory provider`,
      );
    }
    const adapter = this.adaptersByConnector.get(MEMORY_CONNECTOR_ID);
    if (adapter === undefined) {
      throw new MemoryDispatchRefusal('source_binding_mismatch', 'memory adapter absent from dispatch');
    }
    if (verified.principal.sub !== input.expectedPrincipalSub) {
      throw new MemoryDispatchRefusal('principal_mismatch', 'verified subject differs from the expected principal');
    }
    if (verified.tenantRef !== input.expectedTenantRef) {
      throw new MemoryDispatchRefusal('tenant_mismatch', 'authorized tenant differs from the expected tenant');
    }
    const scopes = new Set(verified.principal.scopes);
    for (const required of resolution.requiredScopes) {
      if (!scopes.has(required)) {
        throw new MemoryDispatchRefusal('insufficient_scope', `missing scope "${required}"`);
      }
    }
    const claims = new Set(Object.keys(verified.principal.claims ?? {}));
    for (const required of resolution.requiredClaims) {
      if (!claims.has(required)) {
        throw new MemoryDispatchRefusal('insufficient_claims', `missing claim "${required}"`);
      }
    }
    let bound;
    try {
      bound = bindMemoryInvocation({
        ctx: verified,
        purposeRef: input.purposeRef,
        idempotencyKey: input.idempotencyKey,
        elicitationRef: input.elicitationRef,
      });
    } catch (error) {
      throw new MemoryDispatchRefusal(
        'source_binding_mismatch',
        error instanceof Error ? error.message : 'invalid invocation binding',
      );
    }
    const sourceBinding: MemorySourceBindingV1 = {
      providerId: MEMORY_PROVIDER_ID,
      connectorId: MEMORY_CONNECTOR_ID,
      sourceId: this.sourceId,
      connectorInstanceRef: verified.connectorInstanceId,
      generation: this.generation,
    };
    return {
      adapter,
      selection: {
        capabilityName: resolution.capabilityName,
        providerId: resolution.providerId,
        sourceBinding,
        requiredScopes: [...resolution.requiredScopes],
        requiredClaims: [...resolution.requiredClaims],
      },
      projection: bound.projection,
      auditRef: bound.auditRef,
    };
  }
}
