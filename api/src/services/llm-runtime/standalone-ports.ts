// Standalone gateway route-plane ports (BRDP-EX7). Pure bookkeeping over injected
// ports: no product runtime, database, registry or cluster-mesh import, so the
// standalone gateway host and the product `/gw` namespace share one factory.
import type {
  GenerateRequest,
  GenerateResponse,
  PlannedRouteTarget,
  PreparedRouteAttempt,
  RoutePlan,
  RoutePlanInput,
  RoutePlanner,
  StreamRequest,
  StreamResult,
  VerifiedRoutingSubject,
} from '@sentropic/llm-mesh';
import { EXCLUSIVE_LAUNCH_ALIAS_TARGET_MAPPINGS, isNativeMessagesTarget, RoutePlanError } from '@sentropic/llm-mesh';
import type { AnthropicNativePort } from './anthropic-native';

export interface GatewayRouteIntentEvidence {
  readonly requestedModel: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly transportProviderId: string;
  readonly requiredCapabilities: readonly unknown[];
}

/** Resolves the one executable target for a verified subject and requested model. */
export interface GatewayRouteTargetPort {
  resolve(subject: VerifiedRoutingSubject, requestedModel: string): Promise<PlannedRouteTarget>;
}

export interface GatewayModelCatalogPort {
  listModels(): readonly { readonly modelId: string; readonly providerId: string }[];
}

/** Executes a planned target; structurally identical to the product runtime dispatch port. */
export interface GatewayRouteDispatchPort {
  generate(
    subject: VerifiedRoutingSubject,
    workspaceId: string | undefined,
    target: PlannedRouteTarget,
    request: GenerateRequest,
  ): Promise<GenerateResponse>;
  stream(
    subject: VerifiedRoutingSubject,
    workspaceId: string | undefined,
    target: PlannedRouteTarget,
    request: StreamRequest,
  ): Promise<StreamResult>;
}

export interface GatewayRoutePlanePorts {
  readonly nativeMessages?: AnthropicNativePort;
  readonly targets: GatewayRouteTargetPort;
  readonly catalog: GatewayModelCatalogPort;
  readonly dispatch: GatewayRouteDispatchPort;
  /** Prefix of plan/candidate refs and error messages (the product uses `application`). */
  readonly name: string;
  readonly councilRevision: string;
  readonly observeShadow?: (evidence: GatewayRouteIntentEvidence) => void;
}

const policy = {
  strategy: { kind: 'last-enrolled' as const },
  rules: [],
  fallbackMode: 'retest-preferred' as const,
  negativeCacheTtlMs: 300_000,
  maxAttempts: 1,
  preferSameTransport: true,
  stickyAccount: true,
  rotateEquivalentAccounts: false,
  allowEquivalentModels: true,
};

const subjectKey = (subject: VerifiedRoutingSubject, input: RoutePlanInput): string =>
  [subject.principalRef, subject.ownerScopeRef, input.affinityKey ?? '', input.requestedModel,
    input.nativeMessages ? 'native' : 'canonical'].join('\u001f');

const evidenceFor = (
  target: PlannedRouteTarget,
  route: Pick<RoutePlanInput, 'requestedModel' | 'requiredCapabilities'>,
): GatewayRouteIntentEvidence => ({
  requestedModel: route.requestedModel,
  providerId: target.providerId,
  modelId: target.modelId,
  transportProviderId: target.transportProviderId,
  requiredCapabilities: [...(route.requiredCapabilities ?? [])].sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right))),
});

export const createGatewayRoutePlane = (ports: GatewayRoutePlanePorts): {
  readonly planner: RoutePlanner;
  readonly shadowRouteIntent: (input: {
    readonly subject: VerifiedRoutingSubject;
    readonly route: RoutePlanInput;
  }) => Promise<void>;
} => {
  const { dispatch, name } = ports;
  const shadowTargets = new Map<string, PlannedRouteTarget>();
  const plans = new Map<string, {
    subject: VerifiedRoutingSubject;
    workspaceId?: string;
    target: PlannedRouteTarget;
    candidateRef: string;
    nativeRequired: boolean;
  }>();
  let sequence = 0;
  const feasible = async (subject: VerifiedRoutingSubject, input: RoutePlanInput, target: PlannedRouteTarget) => {
    if (!input.nativeMessages) return;
    if (target.modelId !== input.requestedModel || !ports.nativeMessages
      || !await ports.nativeMessages.available(subject, input.workspaceId, target)) {
      throw new RoutePlanError('Native Messages target is unavailable', 'native-unavailable');
    }
  };
  const validateRequired = (input: RoutePlanInput) => {
    if (!input.nativeMessages) return;
    if (Object.hasOwn(EXCLUSIVE_LAUNCH_ALIAS_TARGET_MAPPINGS, input.requestedModel)) {
      throw new RoutePlanError('Native Messages target is unavailable', 'native-unavailable');
    }
    const models = ports.catalog.listModels().filter(model => model.modelId === input.requestedModel);
    if (!models.length) throw new RoutePlanError('Unknown requested model', 'unknown-model');
    if (!models.some(model => isNativeMessagesTarget(model, ports.nativeMessages?.modelIds ?? []))) {
      throw new RoutePlanError('Native Messages target is unavailable', 'native-unavailable');
    }
  };

  const shadowRouteIntent = async (input: {
    readonly subject: VerifiedRoutingSubject;
    readonly route: RoutePlanInput;
  }): Promise<void> => {
    validateRequired(input.route);
    const target = await ports.targets.resolve(input.subject, input.route.requestedModel);
    await feasible(input.subject, input.route, target);
    shadowTargets.set(subjectKey(input.subject, input.route), target);
    ports.observeShadow?.(evidenceFor(target, input.route));
  };

  const planner: RoutePlanner = {
    async listModels() {
      return ports.catalog.listModels().map((model) => ({
        modelId: model.modelId, providerId: model.providerId,
      }));
    },
    async plan(subject, input): Promise<RoutePlan> {
      validateRequired(input);
      const key = subjectKey(subject, input);
      let target = shadowTargets.get(key);
      if (!target) {
        target = await ports.targets.resolve(subject, input.requestedModel);
        await feasible(subject, input, target);
        ports.observeShadow?.(evidenceFor(target, input));
      }
      else await feasible(subject, input, target);
      shadowTargets.delete(key);
      sequence += 1;
      const planRef = `${name}-gateway-plan-${sequence}`;
      const candidateRef = `${name}-gateway-candidate-${sequence}`;
      plans.set(planRef, {
        subject, ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        target, candidateRef, nativeRequired: input.nativeMessages === true,
      });
      return {
        planRef,
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
        candidateRefs: [candidateRef], policy, councilRevision: ports.councilRevision,
        diagnostics: [{
          candidateRef, diagnosticAccountRef: 'provider-owned',
          requestedModel: input.requestedModel,
          actualProviderId: target.providerId,
          actualModelId: target.modelId,
          actualTransportProviderId: target.transportProviderId,
          reason: target.reason, cacheContinuityRisk: false,
        }],
      };
    },
    async prepareAttempt(subject, planRef, candidateRef): Promise<PreparedRouteAttempt> {
      const planned = plans.get(planRef);
      if (!planned || planned.candidateRef !== candidateRef
        || planned.subject.principalRef !== subject.principalRef
        || planned.subject.ownerScopeRef !== subject.ownerScopeRef) {
        throw new Error('gateway route plan does not belong to the caller');
      }
      const native = await ports.nativeMessages?.prepare(subject, planned.workspaceId, planned.target);
      if (planned.nativeRequired && !native) {
        plans.delete(planRef);
        throw new RoutePlanError('Native Messages target is unavailable', 'native-unavailable');
      }
      return {
        ...(native ? { nativeMessages: native } : {}),
        attemptRef: `${candidateRef}:attempt`,
        generate: (request) => dispatch.generate(subject, planned.workspaceId, planned.target, request),
        stream: (request) => dispatch.stream(subject, planned.workspaceId, planned.target, request),
        async recordOutcome() { plans.delete(planRef); },
        async markCommitted() {},
        async complete() { plans.delete(planRef); },
        async releaseCancelled() { plans.delete(planRef); },
      };
    },
    describeAffinity() { return null; },
    promoteAffinity() { throw new Error(`${name} gateway affinity promotion is unsupported`); },
    rebindAffinity() { throw new Error(`${name} gateway affinity rebinding is unsupported`); },
    resetAffinity() { return false; },
  };

  return { planner, shadowRouteIntent };
};
