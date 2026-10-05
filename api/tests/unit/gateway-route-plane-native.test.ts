import { afterEach, describe, expect, it, vi } from 'vitest';
import { isNativeMessagesTarget } from '@sentropic/llm-mesh';
import { createApplicationGatewayRoutePlane } from '../../src/services/llm-runtime/gateway-route-plane';
import { createGatewayRoutePlane } from '../../src/services/llm-runtime/standalone-ports';

vi.mock('../../src/services/llm-runtime/index', () => ({
  resolveRuntimeSelection: vi.fn(async ({ model }) => ({ model, providerId: model.startsWith('claude-') ? 'anthropic' : 'openai' })),
  callLLM: vi.fn(), callLLMStream: vi.fn(),
}));
const MODEL = 'claude-sonnet-5';
const subject = { principalRef: 'fixture-user', ownerScopeRef: 'fixture-owner' };
const route = { requestedModel: MODEL, nativeMessages: true as const, workspaceId: 'fixture-workspace' };
const quoteInput = { ...route, now: new Date('2026-10-04T00:00:00Z'), ceiling: { inputTokens: 100, outputTokens: 16 } };
const fixture = (enabled = true) => {
  const execute = vi.fn();
  const capability = { contractVersion: 1 as const, protocol: 'anthropic-messages' as const, modelId: MODEL,
    apiVersions: ['2023-06-01'], requiredBetas: [], execute };
  const available = vi.fn(async (_subject, _workspace, target) => isNativeMessagesTarget(target, [MODEL]));
  const prepare = vi.fn(async (_subject, _workspace, target) => isNativeMessagesTarget(target, [MODEL]) ? capability : undefined);
  const countTokens = { prepare: vi.fn(), modelIds: [MODEL] };
  const dispatch = { generate: vi.fn(), stream: vi.fn() };
  const port = { modelIds: [MODEL], available, prepare, countTokens };
  return { plane: createApplicationGatewayRoutePlane({ nativeMessages: enabled, nativePort: port, dispatch }),
    port, capability, available, prepare, execute, dispatch };
};
afterEach(() => vi.restoreAllMocks());
describe('product native route and quote composition', () => {
  it('keeps OFF/default product and standalone planes without native/count transport', async () => {
    const { plane, port } = fixture(false);
    expect(plane.nativeCountTokens).toBeUndefined();
    expect(() => plane.planner.quote!(quoteInput)).toThrow(expect.objectContaining({ code: 'native-unavailable' }));
    await expect(plane.planner.plan(subject, route)).rejects.toMatchObject({ code: 'native-unavailable' });
    expect(port.available).not.toHaveBeenCalled(); expect(port.prepare).not.toHaveBeenCalled();
    const defaultPlane = createApplicationGatewayRoutePlane();
    expect(defaultPlane.nativeCountTokens).toBeUndefined();
    await expect(defaultPlane.planner.plan(subject, route)).rejects.toMatchObject({ code: 'native-unavailable' });
    const target = { requestedModel: MODEL, providerId: 'anthropic', modelId: MODEL, transportProviderId: 'fixture', reason: 'exact' as const };
    const standalone = createGatewayRoutePlane({ name: 'standalone', councilRevision: 'fixture',
      catalog: { listModels: () => [target] }, targets: { resolve: vi.fn(async () => target) }, dispatch: fixture().dispatch });
    await expect(standalone.planner.plan(subject, route)).rejects.toMatchObject({ code: 'native-unavailable' });
  });
  it('pins native quote identity and exposes the independent count port', async () => {
    const { plane, port, capability } = fixture();
    const native = plane.planner.quote!(quoteInput);
    const canonical = plane.planner.quote!({ ...quoteInput, nativeMessages: undefined });
    expect(native.quoteRef).not.toBe(canonical.quoteRef);
    expect(plane.planner.quote!(quoteInput)).toEqual(native);
    expect(native.candidates).toMatchObject([{ providerId: 'anthropic', modelId: MODEL }]);
    const planned = await plane.planner.plan(subject, { ...route, quote: native });
    expect((await plane.planner.prepareAttempt(subject, planned.planRef, planned.candidateRefs[0]!, 'fixture', 0)).nativeMessages)
      .toBe(capability);
    expect(plane.nativeCountTokens).toBe(port.countTokens);
    expect(port.countTokens.prepare).not.toHaveBeenCalled();
  });
  it.each([['unknown-model', 'missing-model'], ['native-unavailable', 'claude-opus-5-5'],
    ['native-unavailable', 'gpt-5.6-terra'], ['native-unavailable', 'claude-opus-5']])('refuses %s %s before route bookkeeping', async (code, model) => {
    const { plane, available, prepare } = fixture();
    expect(() => plane.planner.quote!({ ...quoteInput, requestedModel: model })).toThrow(expect.objectContaining({ code }));
    await expect(plane.planner.plan(subject, { ...route, requestedModel: model })).rejects.toMatchObject({ code });
    expect(available).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled();
    expect((await plane.planner.plan(subject, route)).planRef).toBe('application-gateway-plan-1');
  });
  it('refuses unavailable credentials without consuming a plan sequence and rechecks preparation', async () => {
    const { plane, available, prepare } = fixture();
    available.mockResolvedValueOnce(false);
    await expect(plane.planner.plan(subject, route)).rejects.toMatchObject({ code: 'native-unavailable' });
    const plan = await plane.planner.plan(subject, route);
    expect(plan.planRef).toBe('application-gateway-plan-1');
    prepare.mockResolvedValueOnce(undefined);
    await expect(plane.planner.prepareAttempt(subject, plan.planRef, plan.candidateRefs[0]!, 'fixture', 0))
      .rejects.toMatchObject({ code: 'native-unavailable' });
    await expect(plane.planner.prepareAttempt(subject, plan.planRef, plan.candidateRefs[0]!, 'fixture', 0))
      .rejects.toThrow('does not belong');
  });
  it('preserves optional canonical fallback when the native capability disappears', async () => {
    const { plane, prepare, dispatch } = fixture();
    const plan = await plane.planner.plan(subject, { ...route, nativeMessages: undefined });
    prepare.mockResolvedValueOnce(undefined);
    const attempt = await plane.planner.prepareAttempt(subject, plan.planRef, plan.candidateRefs[0]!, 'fixture', 0);
    expect(attempt.nativeMessages).toBeUndefined();
    await attempt.generate({ messages: [] });
    expect(dispatch.generate).toHaveBeenCalledOnce();
  });
});
