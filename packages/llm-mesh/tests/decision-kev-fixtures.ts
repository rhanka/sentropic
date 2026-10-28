import { vi } from 'vitest';
import { createProviderRegistry } from '../src/registry.js';
import { createKevAdapter, createKevQualificationDescriptor, createSystemOneLocalTransport,
  KEV_INVENTORY, KEV_SERVED_MODEL_ID } from '../src/decision/host.js';
import { decisionRequest, decisionServiceFixture } from './decision-fixtures.js';

export function kevFixture() {
  const base = decisionServiceFixture();
  const descriptor = createKevQualificationDescriptor(KEV_INVENTORY);
  const body = { model: KEV_SERVED_MODEL_ID, answers: { verdict: { type: 'noul', noul: 0.75 } as Record<string, unknown> },
    usage: { input_tokens: 100, output_tokens: 0 } };
  const models = { data: [{ id: KEV_SERVED_MODEL_ID, architecture: { output_modalities: ['decisions'] } }] };
  const inventory = structuredClone(KEV_INVENTORY);
  const verifyInventory = vi.fn(async () => inventory);
  const fetch = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/models') ? models : body),
    { headers: { 'content-type': 'application/json' } }));
  const transport = createSystemOneLocalTransport({ fetch: fetch as typeof globalThis.fetch, verifyInventory });
  const adapter = createKevAdapter({ descriptor, transport });
  const price = { providerId: 'local', modelId: descriptor.wireModel, protocol: 'systemone-local',
    authority: descriptor.priceProtocol.authority, priceRevision: descriptor.priceProtocol.revision,
    inputMicroUsdPerMtok: '1000000', outputMicroUsdPerMtok: '0', minimumMicroUsd: '0',
    identityMismatchPricing: 'requires-reconciliation' as const };
  const auth = { material: { type: 'environment-token' as const, envVar: 'KEV_LOCAL_API_KEY', token: 'fixture-kev-secret' },
    descriptor: { sourceType: 'environment-token' as const } };
  const options = { ...base.options, registry: createProviderRegistry([adapter]), resolveEvaluator: () => descriptor,
    evaluatorAllowlist: [descriptor.evaluator], resolvePrice: vi.fn(() => price), resolveAuth: vi.fn(async () => auth) };
  const request = decisionRequest({ evaluator: descriptor.evaluator,
    decision: { kind: 'threshold', field: 'score', op: 'gte', value: 0.5 } });
  return { ...base, descriptor, body, models, inventory, verifyInventory, fetch, transport, adapter, options, request, auth, price };
}
