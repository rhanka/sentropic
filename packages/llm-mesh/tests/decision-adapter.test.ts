import { describe, expect, it, vi } from 'vitest';
import { parseDecisionEvaluatorDescriptor } from '../src/decision/descriptor-validation.js';
import { qualifiedDescriptor, decisionRequest, jevResponse } from './decision-fixtures.js';
import { createJevAdapter } from '../src/decision/adapter.js';
import { createDefaultProviderAdapters } from '../src/adapters.js';

describe('descriptor-owned immutable JEV semantics', () => {
  it('detaches and freezes qualified configuration without mutating the caller', () => {
    const input = qualifiedDescriptor();
    const descriptor = parseDecisionEvaluatorDescriptor(input);
    expect(descriptor).not.toBeNull();
    input.acceptedServedModelIds[0] = 'changed';
    expect(descriptor?.acceptedServedModelIds).toEqual(['synthetic-served-model']);
    expect(Object.isFrozen(descriptor?.qualification)).toBe(true);
    expect(Object.isFrozen(input)).toBe(false);
  });
  it.each([{ wireModel: 'jev-latest' }, { acceptedServedModelIds: [] }, { probabilityTolerance: 0.1 },
    { qualification: { servedIdentity: ['unqualified'], billingBound: 'unqualified', evidenceRefs: [] }, acceptedServedModelIds: [] },
    { qualification: { servedIdentity: 'qualified', billingBound: 'qualified', evidenceRefs: [] } },
    { nativeDecision: true }, { confidence: { meaning: 'decision-confidence', meaningRef: 'fixture:native', min: 0, max: 1 } }])(
    'refuses unpinned or undocumented semantics: %j', (override) => {
      expect(parseDecisionEvaluatorDescriptor({ ...qualifiedDescriptor(), ...override })).toBeNull();
    });
});

describe('explicit decision-only JEV composition', () => {
  const auth = { type: 'environment-token' as const, envVar: 'JEV_API_KEY', token: 'synthetic-key' };
  it('discovers without I/O, stays outside default adapters and refuses both chat methods', async () => {
    const send = vi.fn();
    const adapter = createJevAdapter({ transport: { send } });
    expect(adapter.listModels()).toEqual([]);
    expect(adapter.listEvaluators()).toHaveLength(1);
    expect(createDefaultProviderAdapters()).toHaveLength(8);
    expect(await adapter.decision(decisionRequest({ evaluator: adapter.listEvaluators()[0] }), { auth }))
      .toMatchObject({ error: { code: 'PROVIDER_UNAVAILABLE' } });
    await expect(adapter.generate({} as never)).rejects.toThrow('does not support chat');
    await expect(adapter.stream({} as never)).rejects.toThrow('does not support chat');
    expect(send).not.toHaveBeenCalled();
  });
  it.each([{ type: 'environment-token', envVar: 'JEV_API_KEY' },
    { type: 'direct-token', token: 'synthetic-key' }, { ...auth, token: ' ' }])('refuses unresolved or unsupported auth', async (material) => {
    const send = vi.fn();
    const adapter = createJevAdapter({ transport: { send }, descriptor: qualifiedDescriptor() });
    expect(await adapter.decision(decisionRequest(), { auth: material as never })).toMatchObject({ error: { code: 'CREDENTIAL_MISSING' } });
    expect(send).not.toHaveBeenCalled();
  });
  it('returns a validated negative verdict and strips credentials from observed IDs', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, body: jevResponse(), providerRequestId: 'fixture:1' });
    const adapter = createJevAdapter({ transport: { send }, descriptor: qualifiedDescriptor() });
    const result = await adapter.decision(decisionRequest({ decision: { kind: 'threshold', field: 'score', op: 'gte', value: 0.5 } }), { auth });
    expect(result).toMatchObject({ ok: true, verdict: { decision: { pass: false }, confidence: null } });
    send.mockResolvedValue({ ok: true, body: { ...jevResponse(), model: 'synthetic-key' }, providerRequestId: 'synthetic-key' });
    const refusal = await adapter.decision(decisionRequest(), { auth });
    expect(refusal).toMatchObject({ error: { code: 'SERVED_IDENTITY_MISMATCH' }, servedModelId: null });
    expect(JSON.stringify(refusal)).not.toContain(auth.token);
  });
  it('sanitizes an injected transport rejection and retains uncertain execution usage', async () => {
    const adapter = createJevAdapter({ descriptor: qualifiedDescriptor(), transport: {
      send: vi.fn().mockRejectedValue(new Error('synthetic-key content-canary')) } });
    const result = await adapter.decision(decisionRequest(), { auth });
    expect(result).toMatchObject({ error: { code: 'TRANSPORT_FAILED' }, usage: { evaluatorCalls: null } });
    expect(JSON.stringify(result)).not.toMatch(/synthetic-key|content-canary/);
  });
});
