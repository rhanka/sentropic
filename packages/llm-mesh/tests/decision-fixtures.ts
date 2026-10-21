import { vi } from 'vitest';
import { createProviderRegistry } from '../src/registry.js';
import { createJevAdapter } from '../src/judge/adapter.js';
import type { JudgeServiceOptions } from '../src/judge/host-options.js';
import type { JudgeReceipt } from '../src/judge/receipt.js';
import type { JudgeRequest } from '../src/judge/request.js';
import { jevDescriptor } from '../src/judge/jev-descriptor.js';

/** Synthetic qualification only: these IDs/evidence do not activate the built-in descriptor. */
export const qualifiedDescriptor = () => structuredClone({ ...jevDescriptor,
  evaluator: { ...jevDescriptor.evaluator, revision: 'synthetic-v1' },
  acceptedServedModelIds: ['synthetic-served-model'],
  qualification: { servedIdentity: 'qualified' as const, billingBound: 'qualified' as const,
    evidenceRefs: ['fixture:synthetic-qualification'] },
});
export const judgeRequest = (overrides: Partial<JudgeRequest> = {}): JudgeRequest => ({
  schemaVersion: 1, evaluator: qualifiedDescriptor().evaluator,
  inputs: { output: 'synthetic candidate' }, criterion: { kind: 'binary', instructions: 'Check evidence.' },
  ...overrides,
});
export const jevResponse = (answer: unknown = { noul: 0.25 }) => ({
  model: 'synthetic-served-model', answers: { verdict: answer }, usage: { input_tokens: 1000, output_tokens: 0 },
});
export const judgePrice = () => ({ providerId: 'typesafe' as const, modelId: 'jev-1.13.0', priceRevision: 'fixture-price-v1',
  inputMicroUsdPerMtok: '42000', outputMicroUsdPerMtok: '0', minimumMicroUsd: '0', identityMismatchPricing: 'requested-model' as const });

/** Test-only linearized durable-port model; never a production financial authority. */
export function judgeServiceFixture() {
  const descriptor = qualifiedDescriptor();
  const state = { now: 0, disabled: new Set<string>(), ledger: [] as JudgeReceipt[], receipts: [] as JudgeReceipt[] };
  const key = (ref: { providerId: string; evaluatorId: string; revision: string }) => JSON.stringify(ref);
  const transport = { send: vi.fn().mockResolvedValue({ ok: true, body: jevResponse() }) };
  const adapter = createJevAdapter({ descriptor, transport });
  const budget = {
    admit: vi.fn(async (input) => state.disabled.has(key(input.evaluator))
      ? { ok: false as const, code: 'PROVIDER_UNAVAILABLE' as const } : { ok: true as const, holdId: input.callId }),
    markDispatched: vi.fn(async (input) => state.disabled.has(key(input.evaluator))
      ? { ok: false as const, code: 'PROVIDER_UNAVAILABLE' as const, provenUnsent: true } : { ok: true as const }),
    release: vi.fn(async () => {}),
    settle: vi.fn(async (input) => {
      state.ledger.push(input.receipt);
      if (input.boundViolated) state.disabled.add(key(input.receipt.evaluator));
    }),
  };
  const options: JudgeServiceOptions = { registry: createProviderRegistry([adapter]), resolveEvaluator: () => descriptor,
    resolvePrice: vi.fn(() => judgePrice()), authorize: vi.fn(async () => true), budget,
    resolveAuth: vi.fn(async () => ({ material: { type: 'environment-token', envVar: 'JEV_API_KEY', token: 'synthetic-secret-canary' },
      descriptor: { sourceType: 'environment-token' } })),
    receipts: { persist: vi.fn(async (receipt) => { state.receipts.push(receipt); }) },
    clock: { wall: () => 1700000000000 + state.now, monotonic: () => state.now } };
  return { options, descriptor, transport, adapter, budget, state };
}
