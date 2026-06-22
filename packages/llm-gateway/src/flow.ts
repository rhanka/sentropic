/**
 * The gateway request flow (spec §2). This is the real v0 personal-passthrough
 * orchestration, wire-agnostic: the router calls it for both `/v1/messages`
 * (Anthropic) and `/v1/chat/completions` (OpenAI).
 *
 * Order (spec §2):
 *   1. caller-auth (verify the SENTROPIC identity) -> resolve CostContext from
 *      the VERIFIED identity (NEVER the body).
 *   2. resolve provider/model from the body `model`.
 *   3. (kill-switch) reject any request that would require a cross-user grant
 *      while `crossUserPoolEnabled` is OFF.
 *   4. pool.select() -> AccountTransportCoordinator.acquire() over the caller's
 *      PERSONAL pool (sticky binding; no silent rebind).
 *   5. authResolver.resolve() -> executable SecretAuthMaterial (gateway-owned,
 *      refresh-under-lock). Hooks/logs get the REDACTED descriptor only.
 *   6. dispatch via llm-mesh (faithful provider-compat passthrough).
 *   7. SETTLE: recordOutcome + the metering hook (BR-47 wiring is a later lot;
 *      the settle HOOK is always called — success, failure, or mid-stream).
 *
 * No-retry-after-stream (spec §2): once bytes have streamed, a mid-stream
 * provider failure settles with failure/estimated usage and does NOT retry.
 */

import type { AccountTransportOutcome } from '@sentropic/llm-mesh';

import type { GatewayConfig } from './config.js';
import type { CostContext } from './ports/cost-context.js';
import type {
  GatewayDispatchRequest,
  GatewayDispatchResponse,
  GatewayDispatchStreamEvent,
  GatewayWire,
} from './ports/dispatch.js';
import type { PoolSelection, PoolSelectionRequest } from './ports/pool.js';
import { GatewayError } from './router/errors.js';
import { redactSelection, type RedactedSelectionView } from './redaction.js';

/**
 * Normalized usage the settle hook records. `estimated` is true when the
 * provider did not report usage (spec §5 never-zero -> estimate).
 */
export interface SettleUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimated: boolean;
}

/** Settle context passed to the metering hook (BR-47 wiring lands later). */
export interface SettleContext {
  readonly cost: CostContext;
  readonly wire: GatewayWire;
  readonly providerId: string;
  readonly model: string;
  readonly outcome: AccountTransportOutcome['status'];
  readonly usage: SettleUsage;
  /** Redacted account view — NEVER the executable material (spec §4). */
  readonly account: RedactedSelectionView;
}

/**
 * Metering settle hook (spec §5). v0 = a HOOK stub; BR-47 ledger wiring is a
 * later lot. The flow ALWAYS calls this exactly once per request (success,
 * failure, or mid-stream failure), so the seam is real even before the ledger.
 */
export interface MeteringSink {
  settle(context: SettleContext): Promise<void> | void;
}

/** Provider/model resolution from the body. */
export interface ResolvedTarget {
  readonly providerId: string;
  readonly transportProviderId: string;
  readonly model: string;
}

/**
 * Resolve provider/model + transport for a model string. v0 personal-passthrough
 * uses a minimal static map; Lot 3+ replaces it with the catalog/pool snapshot.
 * Unknown models throw a `bad-request` GatewayError (mapped to provider 400).
 */
export type TargetResolver = (model: string) => ResolvedTarget | undefined;

export interface GatewayFlowDeps {
  readonly config: GatewayConfig;
  readonly resolveTarget: TargetResolver;
  readonly metering: MeteringSink;
  /** Estimate usage when the provider reports none (spec §5 never-zero). */
  readonly estimateUsage?: (wire: GatewayWire, body: unknown) => SettleUsage;
}

/** Inputs the router hands the flow per request. */
export interface GatewayFlowRequest {
  readonly wire: GatewayWire;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly model: string;
  readonly stream: boolean;
  readonly signal?: AbortSignal;
}

const DEFAULT_USAGE: SettleUsage = { inputTokens: 0, outputTokens: 0, estimated: true };

/**
 * Map an llm-mesh `AccountTransportAcquireError` (no_account / no_active_account)
 * to a gateway failure class — NEVER surface the pool detail to the caller.
 */
const isAcquireError = (error: unknown): boolean =>
  error instanceof Error && error.name === 'AccountTransportAcquireError';

/** Steps 1-5: authenticate, resolve target, select + lease, resolve secret. */
const prepare = async (
  deps: GatewayFlowDeps,
  request: GatewayFlowRequest,
): Promise<{
  cost: CostContext;
  target: ResolvedTarget;
  selection: PoolSelection;
  material: Awaited<ReturnType<GatewayConfig['authResolver']['resolve']>>;
  account: RedactedSelectionView;
}> => {
  const { config } = deps;

  // 1. caller-auth -> CostContext (from the VERIFIED identity, never the body).
  const auth = await config.callerAuth.verify(request.headers);
  if (!auth.ok || !auth.cost) {
    throw new GatewayError('caller-auth-failed', auth.reason ?? 'caller-auth failed');
  }
  const cost = auth.cost;

  // 2. resolve provider/model from the body `model`.
  const target = deps.resolveTarget(request.model);
  if (!target) {
    throw new GatewayError('bad-request', `unsupported model: ${request.model}`);
  }

  // 4. pool.select -> coordinator.acquire over the PERSONAL pool.
  const selectionRequest: PoolSelectionRequest = {
    cost,
    targetProviderId: target.providerId,
    transportProviderId: target.transportProviderId,
    modelId: target.model,
    workspaceId: cost.workspaceId ?? null,
    userId: cost.principalId,
    affinityKey: cost.correlationId,
    requestId: cost.correlationId,
    // 3. kill-switch: v0 carries NO authorization grant (caller == provider).
    // `PoolStatePort.select` rejects grant-requiring selection while OFF.
  };

  let selection: PoolSelection;
  try {
    selection = await config.pool.select(selectionRequest);
  } catch (error) {
    if (error instanceof GatewayError) {
      throw error;
    }
    if (isAcquireError(error)) {
      throw new GatewayError('no-eligible-account', 'no eligible account in pool');
    }
    throw new GatewayError('pooled-account-unavailable', 'pool selection failed');
  }

  // 5. resolve the executable material (gateway-owned). Logs get the descriptor.
  let material;
  try {
    material = await config.authResolver.resolve(selection);
  } catch {
    // Settle the lease as a failed outcome so the account isn't stuck leased.
    await selection.acquisition.recordOutcome({ status: 'auth_failed' });
    throw new GatewayError('pooled-account-unavailable', 'credential resolution failed');
  }

  const account = redactSelection(material.descriptor, material.material);
  return { cost, target, selection, material, account };
};

const usageOrEstimate = (
  deps: GatewayFlowDeps,
  request: GatewayFlowRequest,
  usage: SettleUsage | undefined,
): SettleUsage => {
  if (usage && (usage.inputTokens > 0 || usage.outputTokens > 0)) {
    return usage;
  }
  return deps.estimateUsage?.(request.wire, request.body) ?? DEFAULT_USAGE;
};

/** Settle exactly once: record the pool outcome + call the metering hook. */
const settle = async (
  deps: GatewayFlowDeps,
  request: GatewayFlowRequest,
  ctx: {
    cost: CostContext;
    target: ResolvedTarget;
    selection: PoolSelection;
    account: RedactedSelectionView;
  },
  status: AccountTransportOutcome['status'],
  usage: SettleUsage | undefined,
  retryAfterMs?: number,
): Promise<void> => {
  const finalUsage = usageOrEstimate(deps, request, usage);
  await ctx.selection.acquisition.recordOutcome({
    status,
    requestId: ctx.cost.correlationId,
    ...(typeof retryAfterMs === 'number' ? { retryAfterMs } : {}),
  });
  await deps.metering.settle({
    cost: ctx.cost,
    wire: request.wire,
    providerId: ctx.target.providerId,
    model: ctx.target.model,
    outcome: status,
    usage: finalUsage,
    account: ctx.account,
  });
};

/** Result of a non-stream gateway call (router sends `body` with `status`). */
export interface GatewayJsonResult {
  readonly status: number;
  readonly body: unknown;
}

/**
 * Run a NON-STREAM gateway request end to end. Throws a `GatewayError` on any
 * pre-dispatch failure (router maps it to a provider-shaped error). On a
 * provider error response it still settles (failure usage), never leaking pool
 * internals.
 */
export const runJsonFlow = async (
  deps: GatewayFlowDeps,
  request: GatewayFlowRequest,
): Promise<GatewayJsonResult> => {
  const prepared = await prepare(deps, request);
  const dispatchRequest: GatewayDispatchRequest = {
    wire: request.wire,
    providerId: prepared.target.providerId,
    model: prepared.target.model,
    material: prepared.material.material,
    body: request.body,
    stream: false,
    ...(request.signal ? { signal: request.signal } : {}),
  };

  let response: GatewayDispatchResponse;
  try {
    response = await deps.config.dispatch.dispatch(dispatchRequest);
  } catch {
    await settle(deps, request, prepared, 'failed', undefined);
    throw new GatewayError('pooled-account-unavailable', 'dispatch failed');
  }

  const ok = response.status >= 200 && response.status < 300;
  await settle(
    deps,
    request,
    prepared,
    ok ? 'success' : 'failed',
    extractUsage(request.wire, response.body),
  );
  // Faithful passthrough: provider-native JSON, provider status code verbatim.
  return { status: response.status, body: response.body };
};

/**
 * Run a STREAMING gateway request. Yields the provider-native SSE frames
 * (already framed by the dispatch adapter). Settles exactly once at end —
 * including a mid-stream failure (no retry after bytes streamed, spec §2).
 */
export async function* runStreamFlow(
  deps: GatewayFlowDeps,
  request: GatewayFlowRequest,
): AsyncGenerator<GatewayDispatchStreamEvent, void, unknown> {
  const prepared = await prepare(deps, request);
  const dispatchRequest: GatewayDispatchRequest = {
    wire: request.wire,
    providerId: prepared.target.providerId,
    model: prepared.target.model,
    material: prepared.material.material,
    body: request.body,
    stream: true,
    ...(request.signal ? { signal: request.signal } : {}),
  };

  let streamedAny = false;
  let usage: SettleUsage | undefined;
  let failed = false;
  try {
    for await (const event of deps.config.dispatch.dispatchStream(dispatchRequest)) {
      streamedAny = true;
      const eventUsage = extractUsageFromFrame(request.wire, event.raw);
      if (eventUsage) {
        usage = eventUsage;
      }
      yield event;
    }
  } catch {
    // Mid-stream provider failure (spec §2): NO retry after bytes streamed.
    // Settle with failure/estimated usage; the dispatch adapter is responsible
    // for emitting a provider-native error event before this point.
    failed = true;
  } finally {
    void streamedAny;
    await settle(deps, request, prepared, failed ? 'failed' : 'success', usage);
  }
}

/** Extract usage from a non-stream provider-native response body. */
const extractUsage = (wire: GatewayWire, body: unknown): SettleUsage | undefined => {
  if (!body || typeof body !== 'object') {
    return undefined;
  }
  if (wire === 'anthropic-messages') {
    const usage = (body as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
    if (usage) {
      return {
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        estimated: false,
      };
    }
    return undefined;
  }
  const usage = (body as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
  if (usage) {
    return {
      inputTokens: usage.prompt_tokens ?? 0,
      outputTokens: usage.completion_tokens ?? 0,
      estimated: false,
    };
  }
  return undefined;
};

/** Extract usage from a single SSE frame (Anthropic `message_delta`, OpenAI final chunk). */
const extractUsageFromFrame = (
  wire: GatewayWire,
  raw: string,
): SettleUsage | undefined => {
  const dataLine = raw
    .split('\n')
    .find((line) => line.startsWith('data:'));
  if (!dataLine) {
    return undefined;
  }
  const payload = dataLine.slice('data:'.length).trim();
  if (payload === '[DONE]') {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return undefined;
  }
  return extractUsage(wire, parsed);
};
