import type { AuthResolver } from '@sentropic/llm-mesh';
import type { DecisionServiceOptions, DecisionEvaluatorDescriptor } from '@sentropic/llm-mesh/decision/host';
import type { JevTransport } from '@sentropic/llm-mesh/transport/jev';

export type DecisionHostModule = typeof import('@sentropic/llm-mesh/decision/host');
export type DecisionExecutionProfile = 'production' | 'qualification';
export const decisionProfile = (value: string | undefined): DecisionExecutionProfile => {
  if (value === undefined || value === 'production') return 'production';
  if (value === 'qualification') return value;
  throw new Error('Decision execution profile unavailable');
};

/** Names only in configuration and diagnostics. Missing or malformed material never falls back. */
export const createDecisionAuth = (environment: Readonly<Record<string, string | undefined>>): AuthResolver => (request) => {
  const envVar = request.providerId === 'openai' ? 'OPENAI_API_KEY' : request.providerId === 'typesafe' ? 'JEV_API_KEY' : undefined;
  const token = envVar ? environment[envVar] : undefined;
  if (!envVar || !token || token !== token.trim() || /[\r\n]/.test(token)) {
    return { material: { type: 'none' }, descriptor: { sourceType: 'none' } };
  }
  return { material: { type: 'environment-token', envVar, token }, descriptor: { sourceType: 'environment-token' } };
};

export const decisionDescriptors = (host: DecisionHostModule, profile: DecisionExecutionProfile): DecisionEvaluatorDescriptor[] =>
  [host.jevDescriptor, host.openAiDecisionsDescriptor].map((source) => {
    const descriptor = structuredClone(source);
    if (profile === 'qualification') {
      descriptor.executionProfile = profile;
      descriptor.acceptedServedModelIds = [descriptor.wireModel];
      // A conservative byte cap bounds one native question, with room for wire overhead.
      // This host-only financial bound awards no identity or semantic qualification.
      descriptor.maxStateQuestionBytes = Math.min(descriptor.maxStateQuestionBytes, 1024);
      descriptor.maxRequestBytes = 8192;
      descriptor.qualification.billingBound = 'qualified';
      descriptor.qualification.evidenceRefs = ['spec/decision/api-host.md#financial-bound'];
    }
    return descriptor;
  });

export const createDecisionHost = (input: {
  host: DecisionHostModule;
  mesh: typeof import('@sentropic/llm-mesh');
  jev: JevTransport;
  fetch: typeof globalThis.fetch;
  profile: DecisionExecutionProfile;
  descriptors: readonly DecisionEvaluatorDescriptor[];
  ports: Pick<DecisionServiceOptions, 'authorize' | 'budget' | 'receipts' | 'resolvePrice' | 'resolveAuth'>;
}) => {
  const [jev, openai] = input.descriptors;
  const registry = input.mesh.createProviderRegistry([
    input.host.createJevAdapter({ descriptor: jev, transport: input.jev }),
    input.host.createOpenAiDecisionsAdapter({ descriptor: openai,
      transport: input.host.createOpenAiDecisionsTransport({ fetch: input.fetch }) }),
  ]);
  return input.host.createDecisionService({
    registry, executionProfile: input.profile, ...input.ports,
    evaluatorAllowlist: input.descriptors.map((descriptor) => descriptor.evaluator),
    resolveEvaluator: (ref) => input.descriptors.find((descriptor) =>
      JSON.stringify(descriptor.evaluator) === JSON.stringify(ref)) ?? null,
    policy: { allowRaw: false, timeoutMs: 10_000 },
    readiness: { contractConformance: false, transportAccessible: false, assessments: [],
      policy: { revision: 'decision-host-v1', language: 'en', domain: 'qualification', intendedUse: 'qualification',
        maxInputBytes: 1024, decision: null } },
  });
};
