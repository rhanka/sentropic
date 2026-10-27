import { describe, expect, it, vi } from 'vitest';
import { createStructuredDecisionAdapter } from '../src/decision/structured.js';
import { createDecisionService } from '../src/decision/service.js';
import { createProviderRegistry } from '../src/registry.js';
import type { ProviderAdapter } from '../src/registry.js';
import { parseDecisionAdapterResult } from '../src/decision/adapter-result.js';
import { decisionRequest, decisionServiceFixture, structuredDecisionDescriptor, structuredDecisionPrice, structuredEvidenceBody, structuredEvidenceEnvelope } from './decision-fixtures.js';

const SECRET = 'synthetic-secret-canary';
const structuredService = (sendText: string, descriptorOverrides: Record<string, unknown> = {}) => {
  const base = decisionServiceFixture();
  const descriptor = { ...structuredDecisionDescriptor(), ...descriptorOverrides };
  const send = vi.fn(async () => structuredEvidenceEnvelope(sendText));
  const adapter = createStructuredDecisionAdapter({ descriptor: descriptor as never, transport: { send } });
  const resolvePrice = vi.fn(async () => structuredDecisionPrice(descriptor.wireModel));
  const service = createDecisionService({ ...base.options,
    registry: createProviderRegistry([adapter as never]),
    resolveEvaluator: (() => descriptor) as never,
    resolvePrice: resolvePrice as never,
    evaluatorAllowlist: [{ ...descriptor.evaluator }] as never });
  return { service, send, descriptor, resolvePrice };
};

describe('structured host boundary (R2-F4/R2-F5)', () => {
  it('carries protocol, authority and revision in the host price lookup key (R2-F4)', async () => {
    const { service, descriptor, resolvePrice } = structuredService(structuredEvidenceBody({ score: 0.7 }));
    const result = await service.decide(decisionRequest({ evaluator: { ...descriptor.evaluator } }));
    expect(result.ok).toBe(true);
    expect(resolvePrice).toHaveBeenCalledWith(expect.objectContaining({
      providerId: descriptor.evaluator.providerId, modelId: descriptor.wireModel,
      protocol: descriptor.protocol, authority: descriptor.priceProtocol.authority,
      priceRevision: descriptor.priceProtocol.revision }));
  });
  it.each(['verdict', 'score', 'scale'])('rejects an undeclared structured %s canary at the host boundary', async (carrier) => {
    const { descriptor } = structuredService(structuredEvidenceBody({ score: 0.7 }));
    const adapter = createStructuredDecisionAdapter({ descriptor: descriptor as never,
      transport: { send: vi.fn(async () => structuredEvidenceEnvelope(structuredEvidenceBody({ score: 0.7 }))) } });
    const request = decisionRequest({ evaluator: { ...descriptor.evaluator } });
    const valid = await adapter.decision(request);
    if (!valid.ok) throw new Error('valid adapter fixture failed');
    const changed = structuredClone(valid) as unknown as Record<string, unknown>;
    const verdict = changed.verdict as Record<string, unknown>;
    const target = carrier === 'verdict' ? verdict
      : carrier === 'score' ? verdict.score as Record<string, unknown>
      : (verdict.score as Record<string, unknown>).scale as Record<string, unknown>;
    target.extraCanary = 'HOST_CLOSED_CANARY';
    const result = parseDecisionAdapterResult(changed, request, descriptor as never, SECRET);
    expect(result.ok).toBe(false);
  });
  it('rejects a substituted structured score scale and direction at the host', async () => {
    const { descriptor } = structuredService(structuredEvidenceBody({ score: 0.7 }));
    const adapter = createStructuredDecisionAdapter({ descriptor: descriptor as never,
      transport: { send: vi.fn(async () => structuredEvidenceEnvelope(structuredEvidenceBody({ score: 0.7 }))) } });
    const request = decisionRequest({ evaluator: { ...descriptor.evaluator } });
    const valid = await adapter.decision(request);
    if (!valid.ok) throw new Error('valid adapter fixture failed');
    const changed = structuredClone(valid) as unknown as Record<string, unknown>;
    const verdict = changed.verdict as Record<string, unknown>;
    const score = verdict.score as Record<string, unknown>;
    score.meaning = 'invented-meaning';
    score.scale = { kind: 'bounded', min: -1000, max: 1000, direction: 'higher-is-better' };
    expect(parseDecisionAdapterResult(changed, request, descriptor as never, SECRET).ok).toBe(false);
  });
  it('binds the accepted meaning to the declared descriptor semantics', async () => {
    const declared = structuredService(structuredEvidenceBody({ score: 0.7 }),
      { scoreSemantics: { meaning: 'support', meaningRef: 'fixture:synthetic-scalar' } });
    const adapter = createStructuredDecisionAdapter({ descriptor: declared.descriptor as never,
      transport: { send: vi.fn(async () => structuredEvidenceEnvelope(structuredEvidenceBody({ score: 0.7 }))) } });
    const request = decisionRequest({ evaluator: { ...declared.descriptor.evaluator } });
    const valid = await adapter.decision(request);
    if (!valid.ok) throw new Error('valid adapter fixture failed');
    expect(parseDecisionAdapterResult(structuredClone(valid), request, declared.descriptor as never, SECRET).ok)
      .toBe(true);
    const rebound = { ...declared.descriptor,
      scoreSemantics: { meaning: 'declared-other', meaningRef: 'fixture:other' } };
    expect(parseDecisionAdapterResult(structuredClone(valid), request, rebound as never, SECRET).ok).toBe(false);
  });
  it('rejects an undeclared structured verdict carrier injected at the service boundary', async () => {
    const base = decisionServiceFixture();
    const descriptor = structuredDecisionDescriptor();
    const send = vi.fn(async () => structuredEvidenceEnvelope(structuredEvidenceBody({ score: 0.7 })));
    const inner = createStructuredDecisionAdapter({ descriptor: descriptor as never, transport: { send } });
    const resolvePrice = async () => structuredDecisionPrice(descriptor.wireModel);
    const resolveEvaluator = (() => descriptor) as never;
    const evaluatorAllowlist = [{ ...descriptor.evaluator }] as never;
    // Success control: the untouched service dispatches once and settles the verdict.
    const control = createDecisionService({ ...base.options,
      registry: createProviderRegistry([inner as never]),
      resolveEvaluator, resolvePrice: resolvePrice as never, evaluatorAllowlist });
    const controlResult = await control.decide(decisionRequest({ evaluator: { ...descriptor.evaluator } }));
    expect(send).toHaveBeenCalledTimes(1);
    if (!controlResult.ok || controlResult.kind !== 'verdict') throw new Error('valid structured service unexpectedly refused');
    // Canary: explicit per-method delegation, one method overridden. A spread
    // would drop prototype methods such as listEvaluators and dispatch nothing.
    send.mockClear();
    const adapter: ProviderAdapter & { descriptor: unknown } = {
      provider: inner.provider,
      descriptor: inner.descriptor,
      listModels: () => inner.listModels(),
      listEvaluators: () => inner.listEvaluators(),
      validateAuth: (source) => inner.validateAuth(source),
      normalizeError: (error) => inner.normalizeError(error),
      generate: (request, context) => inner.generate(request, context),
      stream: (request, context) => inner.stream(request, context),
      decision: async (request, context) => {
        const value = await inner.decision(request, context);
        if (value.ok) (value.verdict as Record<string, unknown>).extraCanary = 'SERVICE_CANARY';
        return value;
      },
    };
    const service = createDecisionService({ ...base.options,
      registry: createProviderRegistry([adapter]),
      resolveEvaluator, resolvePrice: resolvePrice as never, evaluatorAllowlist });
    const result = await service.decide(decisionRequest({ evaluator: { ...descriptor.evaluator } }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    if (result.ok || result.kind !== 'error') throw new Error('canary unexpectedly accepted');
    expect(result.error.code).toBe('VERDICT_INVALID');
    expect(JSON.stringify(result)).not.toContain('SERVICE_CANARY');
  });
  it('serves a valid structured verdict under a distinct provider identity (R2-F1)', async () => {
    const base = decisionServiceFixture();
    const descriptor = { ...structuredDecisionDescriptor(),
      evaluator: { providerId: 'openai', evaluatorId: 'structured-judge-v1', revision: 'synthetic-v1' } };
    const send = vi.fn(async () => structuredEvidenceEnvelope(structuredEvidenceBody({ score: 0.7 })));
    const adapter = createStructuredDecisionAdapter({ descriptor: descriptor as never, transport: { send } });
    expect(adapter.provider.providerId).toBe('openai');
    const tariff = { ...structuredDecisionPrice(descriptor.wireModel), providerId: 'openai' as const };
    const service = createDecisionService({ ...base.options,
      registry: createProviderRegistry([adapter as never]),
      resolveEvaluator: (() => descriptor) as never,
      resolvePrice: (async () => tariff) as never,
      evaluatorAllowlist: [{ ...descriptor.evaluator }] as never });
    const result = await service.decide(decisionRequest({ evaluator: { ...descriptor.evaluator } }));
    expect(result.ok).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    if (!result.ok || result.kind !== 'verdict') throw new Error('openai structured service unexpectedly refused');
    expect(result.receipt.evaluator).toMatchObject({ providerId: 'openai' });
  });
});
