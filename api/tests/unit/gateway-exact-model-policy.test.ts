import { expect, it, vi } from 'vitest';
import { freezeLaunchRoutingContract, mappingContentSha256, InMemoryRoutePlanner, type PlannedRouteTarget } from '@sentropic/llm-mesh';
import { createGatewayRoutePlane, type GatewayRouteDispatchPort, type GatewayRoutePlanePorts } from '../../src/services/llm-runtime/standalone-ports';
const subject = { principalRef: 'p', ownerScopeRef: 'owner-a' };
const requestedModel = 'claude-opus-5-5';
const target: PlannedRouteTarget = { requestedModel, providerId: 'gemini', modelId: 'gemini-4-argon', transportProviderId: 'cloud-code', reason: 'alias' };
const selected = { [requestedModel]: [{ providerId: 'gemini', model: 'gemini-4-argon', transportProviderId: 'cloud-code', effort: 'high' }] };
const policy = () => freezeLaunchRoutingContract({ version: 1, revision: 'p1', ownerScopeRef: 'owner-a', exactModels: [requestedModel],
  authorizedAccountRefs: ['account-a'], rotateAccounts: false, effortPolicy: { mode: 'preserve' },
  mapping: { id: 'G', revision: 'g1', contentSha256: mappingContentSha256(selected), targets: selected } });
const fixture = () => {
  const generate = vi.fn<GatewayRouteDispatchPort['generate']>(async () => ({ id: 'r', providerId: 'gemini', modelId: target.modelId, text: 'synthetic', message: { role: 'assistant' as const, content: 'synthetic' }, toolCalls: [], finishReason: 'stop' }));
  const authorizeTarget = vi.fn<NonNullable<GatewayRoutePlanePorts['authorizeTarget']>>(async (_s, contract) => contract.authorizedAccountRefs.includes('account-a'));
  const ports = { name: 'test', councilRevision: 'c', targets: { resolve: vi.fn(async () => target) },
    catalog: { listModels: () => [{ modelId: target.modelId, providerId: target.providerId }] },
    dispatch: { generate, stream: vi.fn<GatewayRouteDispatchPort['stream']>() }, authorizeTarget };
  return { generate, ports, build: () => createGatewayRoutePlane(ports) };
};
it('refuses implicit Claude to Argon on standalone/product shared factory, including after restart', async () => {
  const f = fixture();
  for (const plane of [f.build(), f.build()]) await expect(plane.planner.plan(subject, { requestedModel })).rejects.toMatchObject({ code: 'no-route' });
  await expect(f.build().planner.plan(subject, { requestedModel, policyOverride: { allowEquivalentModels: true } })).rejects.toMatchObject({ code: 'routing-contract-invalid' });
  expect(f.generate).not.toHaveBeenCalled();
});
it('executes only an explicitly mapped, account-authorized, quoted target', async () => {
  const f = fixture(); const evidence: unknown[] = [];
  const plane = createGatewayRoutePlane({ ...f.ports, observeShadow: row => evidence.push(row) });
  const input = { requestedModel, launchRoutingContract: policy() };
  const quote = new InMemoryRoutePlanner({ directory: { listEligible: async () => [], prepareAttempt: vi.fn() } }).quote({
    ...input, ceiling: { inputTokens: 1, outputTokens: 10 }, now: new Date() });
  await plane.shadowRouteIntent({ subject, route: input });
  const plan = await plane.planner.plan(subject, { ...input, quote });
  const attempt = await plane.planner.prepareAttempt(subject, plan.planRef, plan.candidateRefs[0]!, 'r', 0);
  await attempt.generate({ modelId: requestedModel, messages: [] }); await attempt.complete();
  expect(f.generate).toHaveBeenCalledOnce();
  expect(f.generate.mock.calls[0]?.[2]).toMatchObject({ requestedModel, modelId: 'gemini-4-argon', effort: 'high' });
  expect(evidence).toEqual([expect.objectContaining({ requestedModel, modelId: 'gemini-4-argon', mappingRevision: 'g1', policyRevision: 'p1' })]);
  f.ports.authorizeTarget.mockResolvedValue(false);
  await expect(f.build().planner.plan(subject, input)).rejects.toMatchObject({ code: 'no-route' });
  expect(f.generate).toHaveBeenCalledOnce();
});
