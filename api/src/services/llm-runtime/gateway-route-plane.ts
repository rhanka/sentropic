import {
  type ExecutionFeature,
  type PlannedRouteTarget,
  RoutePlanError,
  type RoutePlanInput,
  type RoutePlanner,
  type VerifiedRoutingSubject,
} from '@sentropic/llm-mesh';
import type {
  CanonicalIngressResult,
  CostContext,
  NativeCountTokensPort,
} from '@sentropic/llm-gateway';

import { providerRegistry } from '../provider-registry';
import {
  applicationGatewayRuntime,
  type GatewayRuntimeDispatchPort,
} from './gateway-wire-adapter';
import { withCatalogQuote } from '../llm-metering/budget-admission';
import { createAnthropicNativePort, type AnthropicNativePort } from './anthropic-native';
import { resolveRuntimeSelection } from './index';
import {
  createGatewayRoutePlane,
  type GatewayRouteIntentEvidence,
} from './standalone-ports';
import { createGatewayCountTokensPort } from './gateway-count-tokens';

export type { GatewayRouteIntentEvidence } from './standalone-ports';

export interface GatewayShadowRouteIntentInput {
  readonly cost: CostContext;
  readonly subject: VerifiedRoutingSubject;
  readonly canonical: CanonicalIngressResult;
  readonly route: RoutePlanInput;
}

const resolveTarget = async (
  subject: VerifiedRoutingSubject,
  requestedModel: string,
): Promise<PlannedRouteTarget> => {
  const selected = await resolveRuntimeSelection({
    model: requestedModel,
    userId: subject.principalRef,
  });
  return {
    requestedModel,
    providerId: selected.providerId,
    modelId: selected.model,
    transportProviderId: 'application-runtime',
    reason: selected.model === requestedModel ? 'exact' : 'alias',
  };
};

const APPLICATION_COUNCIL_REVISION = 'application-runtime-v1';
const applicationCatalog = { listModels: () => providerRegistry.listModels() };

/**
 * Truthful execution-feature support for the injected application runtime
 * (spec §16.4): no §16 execution feature is honored across the whole
 * runtime. Named choice and parallel control are refused by the dispatch
 * adapter; reasoning/strict/structured support is partial per provider at
 * most; replay, context, custom tools, verbosity and output-ceiling
 * enforcement are unserved. Unknown/partial support is not support: fail
 * closed. A request requiring any feature is excluded at plan time with a
 * capability refusal instead of reaching dispatch.
 */
const APPLICATION_RUNTIME_EXECUTION_FEATURES: readonly ExecutionFeature[] = [];

const withExecutionFeatureSupport = (planner: RoutePlanner): RoutePlanner => ({
  ...planner,
  async plan(subject, input) {
    const unsupported = (input.requiredExecutionFeatures ?? []).filter(
      (feature) => !APPLICATION_RUNTIME_EXECUTION_FEATURES.includes(feature),
    );
    if (unsupported.length > 0) {
      throw new RoutePlanError(
        `application runtime does not support execution features: ${unsupported.join(', ')}`,
        'capabilities-unmet',
      );
    }
    return planner.plan(subject, input);
  },
});

/**
 * Product route plane. Its planner carries the catalog quote seam (B3c): budget admission quotes
 * the requested model's catalog entries and the plan refuses any target outside that quote.
 */
export const createApplicationGatewayRoutePlane = (options?: {
  readonly nativeMessages?: boolean;
  readonly nativeMessagesModelIds?: readonly string[];
  /** Trusted host/test port, never selected by caller fields. */
  readonly nativePort?: AnthropicNativePort;
  readonly dispatch?: GatewayRuntimeDispatchPort;
  readonly observeShadow?: (evidence: GatewayRouteIntentEvidence) => void;
}): {
  readonly planner: RoutePlanner;
  /** Host-owned provider count transport for POST /v1/messages/count_tokens; available even when native is off. */
  readonly nativeCountTokens: NativeCountTokensPort;
  readonly shadowRouteIntent: (input: GatewayShadowRouteIntentInput) => Promise<void>;
} => {
  const native = options?.nativeMessages === true
    ? options.nativePort ?? createAnthropicNativePort({ modelIds: options.nativeMessagesModelIds }) : undefined;
  const plane = createGatewayRoutePlane({
    name: 'application',
    councilRevision: APPLICATION_COUNCIL_REVISION,
    targets: { resolve: resolveTarget },
    catalog: applicationCatalog,
    dispatch: options?.dispatch ?? applicationGatewayRuntime,
    ...(native ? { nativeMessages: native } : {}),
    ...(options?.observeShadow ? { observeShadow: options.observeShadow } : {}),
  });
  return {
    ...plane,
    nativeCountTokens: native?.countTokens ?? createGatewayCountTokensPort(),
    planner: withCatalogQuote(withExecutionFeatureSupport(plane.planner), { catalog: applicationCatalog, councilRevision: APPLICATION_COUNCIL_REVISION,
      nativeMessagesModelIds: native?.modelIds ?? [] }),
  };
};
