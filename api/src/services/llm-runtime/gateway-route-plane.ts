import {
  type PlannedRouteTarget,
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
  readonly nativeCountTokens?: NativeCountTokensPort;
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
    ...(native ? { nativeCountTokens: native.countTokens } : {}),
    planner: withCatalogQuote(plane.planner, { catalog: applicationCatalog, councilRevision: APPLICATION_COUNCIL_REVISION,
      nativeMessagesModelIds: native?.modelIds ?? [] }),
  };
};
