import { describe, expect, it, vi } from 'vitest';
import * as host from '@sentropic/llm-mesh/decision/host';
import * as mesh from '@sentropic/llm-mesh';
import { decisionRequest, jevResponse } from '../../../packages/llm-mesh/tests/decision-fixtures';
import { createDecisionAuth, createDecisionHost, decisionDescriptors, decisionProfile } from '../../src/services/decision-host';

const fixture = (profile: 'production' | 'qualification' = 'qualification', withKeys = true) => {
  const descriptors = decisionDescriptors(host, profile);
  const jev = { send: vi.fn(async () => ({ ok: true as const, body: { ...jevResponse(), model: 'jev-1.13.0' } })) };
  const fetch = vi.fn(async () => Response.json({ model: 'gpt-6-luna',
    answers: [{ name: 'verdict', type: 'predicate', probability: 0.25 }],
    usage: { input_tokens: 1000, output_tokens: 0, total_tokens: 1000,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
  }));
  const ports = {
    authorize: vi.fn(async () => true),
    resolveAuth: createDecisionAuth(withKeys ? { JEV_API_KEY: 'fixture-jev-token', OPENAI_API_KEY: 'fixture-openai-token' } : {}),
    resolvePrice: vi.fn(async (key) => ({ ...key, inputMicroUsdPerMtok: key.providerId === 'openai' ? '100000' : '42000',
      outputMicroUsdPerMtok: '0', minimumMicroUsd: '0', identityMismatchPricing: 'requires-reconciliation' })),
    budget: { admit: vi.fn(async () => ({ ok: true as const, holdId: 'fixture-hold' })),
      markDispatched: vi.fn(async () => ({ ok: true as const })), release: vi.fn(async () => {}), settle: vi.fn(async () => {}) },
    receipts: { persist: vi.fn(async () => {}) },
  };
  return { descriptors, jev, fetch, ports, client: createDecisionHost({ host, mesh, profile, descriptors, jev, fetch, ports }) };
};

describe('Decision API host composition without provider access', () => {
  it.each([0, 1])('should run backend %i only as an experimental qualification verdict', async (index) => {
    const f = fixture();
    const result = await f.client.decide(decisionRequest({ evaluator: f.descriptors[index].evaluator }));
    expect(result).toMatchObject({ ok: true, kind: 'experimental-verdict', experimental: true,
      receipt: { experimental: true, servedEvaluator: { provisional: true }, attempts: 1, budget: { state: 'settled' } } });
    expect(f.ports.budget.admit).toHaveBeenCalledOnce();
    expect(f.ports.receipts.persist).toHaveBeenCalledOnce();
    expect(index === 0 ? f.jev.send : f.fetch).toHaveBeenCalledOnce();
    expect(index === 0 ? f.fetch : f.jev.send).not.toHaveBeenCalled();
  });
  it.each([0, 1])('should refuse production backend %i before credentials or a budget hold', async (index) => {
    const f = fixture('production');
    const result = await f.client.decide(decisionRequest({ evaluator: f.descriptors[index].evaluator }));
    expect(result).toMatchObject({ ok: false, error: { code: 'PROVIDER_UNAVAILABLE' }, receipt: { attempts: 0 } });
    expect(f.ports.budget.admit).not.toHaveBeenCalled();
    expect(f.jev.send).not.toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it.each([0, 1])('should fail closed for missing backend %i credentials', async (index) => {
    const f = fixture('qualification', false);
    expect(await f.client.decide(decisionRequest({ evaluator: f.descriptors[index].evaluator })))
      .toMatchObject({ ok: false, error: { code: 'CREDENTIAL_MISSING' }, receipt: { attempts: 0 } });
    expect(f.ports.budget.admit).not.toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.jev.send).not.toHaveBeenCalled();
  });
  it('should refuse absent pricing, revoked authority, and excessive qualification inputs before dispatch', async () => {
    for (const failure of ['price', 'authorization', 'input']) {
      const f = fixture();
      if (failure === 'price') f.ports.resolvePrice.mockResolvedValue(null);
      if (failure === 'authorization') f.ports.authorize.mockResolvedValue(false);
      const request = decisionRequest({ evaluator: f.descriptors[0].evaluator,
        ...(failure === 'input' ? { inputs: { output: 'x'.repeat(2000) } } : {}) });
      expect((await f.client.decide(request)).ok).toBe(false);
      expect(f.ports.budget.admit).not.toHaveBeenCalled();
      expect(f.jev.send).not.toHaveBeenCalled();
    }
  });
  it('should reject request-selected profiles and financial ownership before any effect', async () => {
    const f = fixture();
    const request = { ...decisionRequest({ evaluator: f.descriptors[0].evaluator }), executionProfile: 'qualification', tenantId: 'foreign' };
    expect(await f.client.decide(request)).toMatchObject({ ok: false, error: { code: 'REQUEST_INVALID' } });
    expect(f.ports.budget.admit).not.toHaveBeenCalled();
  });
  it('should keep production as the default and reject unknown host profile values', () => {
    expect(decisionProfile(undefined)).toBe('production');
    expect(() => decisionProfile('enabled')).toThrow('unavailable');
  });
});
