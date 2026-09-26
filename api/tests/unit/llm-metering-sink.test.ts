import { beforeEach, describe, expect, it, vi } from 'vitest';

const { insert, values, onConflictDoNothing } = vi.hoisted(() => ({
  insert: vi.fn(),
  values: vi.fn(),
  onConflictDoNothing: vi.fn(),
}));

vi.mock('../../src/db/client', () => ({
  db: { insert },
}));

vi.mock('../../src/utils/id', () => ({
  createId: vi.fn(() => 'ledger_row_1'),
}));

import { costLedger } from '../../src/db/control-schema';
import { RouteQuoteError, type RoutePlanner } from '@sentropic/llm-mesh';

import {
  createRoutePartition, recordLlmUsage, routePartitionHash, RoutePartitionUnavailableError, settlementOperation,
  withCatalogQuote, withSettlementMode,
} from '../../src/services/llm-metering';

describe('recordLlmUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onConflictDoNothing.mockResolvedValue(undefined);
    values.mockReturnValue({ onConflictDoNothing });
    insert.mockReturnValue({ values });
  });

  it('persists normalized usage and stable dispatch attribution', async () => {
    await recordLlmUsage({
      callId: 'call_1',
      operation: 'stream',
      providerId: 'openai',
      modelId: 'gpt-5.5',
      credentialSource: 'user_byok',
      userId: 'user_1',
      workspaceId: 'workspace_1',
      finishReason: 'stop',
      responseId: 'response_1',
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        reasoningTokens: 5,
        totalTokens: 35,
        providerRawUsage: { prompt_tokens: 10, completion_tokens: 20 },
      },
    });

    expect(insert).toHaveBeenCalledWith(costLedger);
    expect(values).toHaveBeenCalledWith({
      id: 'ledger_row_1',
      idempotencyKey: 'call_1',
      userId: 'user_1',
      workspaceId: 'workspace_1',
      operation: 'stream',
      providerId: 'openai',
      modelId: 'gpt-5.5',
      credentialSource: 'user_byok',
      finishReason: 'stop',
      responseId: 'response_1',
      inputTokens: 10,
      outputTokens: 20,
      reasoningTokens: 5,
      totalTokens: 35,
      usageRaw: { prompt_tokens: 10, completion_tokens: 20 },
      costMicroUsd: null,
    });
    expect(onConflictDoNothing).toHaveBeenCalledWith({ target: costLedger.idempotencyKey });
  });

  it('stores null optional fields when a provider does not report usage', async () => {
    await recordLlmUsage({
      callId: 'call_2',
      operation: 'generate',
      providerId: 'anthropic',
      modelId: 'claude-sonnet-5',
    });

    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: 'call_2',
      userId: null,
      workspaceId: null,
      credentialSource: null,
      finishReason: null,
      responseId: null,
      inputTokens: null,
      outputTokens: null,
      reasoningTokens: null,
      totalTokens: null,
      usageRaw: null,
      costMicroUsd: null,
    }));
  });
});

describe('gateway ledger helpers (Lot D B3c)', () => {
  const planner = (actualModelId: string): RoutePlanner => ({
    async plan() {
      return {
        planRef: 'p', expiresAt: new Date().toISOString(), candidateRefs: ['c'], councilRevision: 'rev',
        policy: {} as never, diagnostics: [{ candidateRef: 'c', diagnosticAccountRef: 'provider-owned', requestedModel: 'm',
          actualProviderId: 'openai', actualModelId, actualTransportProviderId: 't', reason: 'exact', cacheContinuityRisk: false }],
      };
    },
    prepareAttempt: vi.fn(), describeAffinity: () => null, resetAffinity: () => false,
    promoteAffinity: vi.fn(), rebindAffinity: vi.fn(),
  }) as unknown as RoutePlanner;
  const catalog = { listModels: () => [{ modelId: 'm', providerId: 'openai' }, { modelId: 'x', providerId: 'codex' }] };
  const subject = { principalRef: 'u', ownerScopeRef: 'o' };
  const ceiling = { inputTokens: 10, outputTokens: 20 };

  it('quotes the exact catalog entries purely and refuses a plan outside the quote', async () => {
    const quoted = withCatalogQuote(planner('m'), { catalog, councilRevision: 'rev' });
    const quote = quoted.quote!({ requestedModel: 'm', ceiling, now: new Date(0) });
    expect(quote).toMatchObject({ requestedModel: 'm', maxAttempts: 1, councilRevision: 'rev',
      candidates: [{ providerId: 'openai', modelId: 'm', allowance: ceiling, outputCeilingEnforced: true }] });
    expect(quoted.quote!({ requestedModel: 'm', ceiling, now: new Date(0) }).quoteRef).toBe(quote.quoteRef);
    expect(quoted.quote!({ requestedModel: 'x', ceiling, now: new Date(0) }).candidates[0]!.outputCeilingEnforced).toBe(false);
    expect(() => quoted.quote!({ requestedModel: 'unknown', ceiling, now: new Date(0) })).toThrow(RouteQuoteError);
    await expect(quoted.plan(subject, { requestedModel: 'm', quote })).resolves.toMatchObject({ planRef: 'p' });
    const alias = withCatalogQuote(planner('other'), { catalog, councilRevision: 'rev' });
    await expect(alias.plan(subject, { requestedModel: 'm', quote })).rejects.toMatchObject({ code: 'quote-mismatch' });
  });

  it('binds the settlement operation from a trusted header, never from a forged value', async () => {
    const auth = withSettlementMode({ verify: async () => ({ ok: true, cost: { tenantId: 't', principalId: 'u' } as never }) });
    const headers: Record<string, string> = { 'x-sentropic-internal-settlement-mode': 'stream' };
    const result = await auth.verify(headers, { method: 'POST', url: 'http://x/v1', requestId: 'r' });
    expect(headers).toEqual({});
    expect(settlementOperation(result.cost!)).toBe('stream');
    expect(settlementOperation({ tenantId: 't' } as never)).toBe('generate');
  });

  it('verifies partition revisions and refuses other-host, unassigned and overlapping identities', async () => {
    const tenants = { t: { product: ['u'], standalone: ['s'] } };
    const config = { revision: 'r', hash: routePartitionHash('r', tenants), tenants };
    const product = createRoutePartition('product', { load: () => config, expected: () => ({ revision: 'r', hash: config.hash }) });
    expect(await product.assigned({ tenantId: 't', principalId: 'u' })).toBe(true);
    expect(await product.assigned({ tenantId: 't', principalId: 's' })).toBe(false);
    expect(await product.assigned({ tenantId: 'other', principalId: 'u' })).toBe(false);
    const overlap = { t: { product: ['u'], standalone: ['u'] } };
    const broken = createRoutePartition('product', {
      load: () => ({ revision: 'r', hash: routePartitionHash('r', overlap), tenants: overlap }),
      expected: () => ({ revision: 'r', hash: routePartitionHash('r', overlap) }),
    });
    await expect(broken.ready()).rejects.toBeInstanceOf(RoutePartitionUnavailableError);
    expect(routePartitionHash('r', { t: { product: ['b', 'a'] } })).toBe(routePartitionHash('r', { t: { product: ['a', 'b'] } }));
  });
});
