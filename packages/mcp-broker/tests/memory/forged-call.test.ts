/**
 * MCP-L5 Lot 1 — forged-call refusal tests.
 *
 * Case: P01.broker.forged-call. Forged direct invocation without verified
 * context or selection fails before provider or effect: missing context,
 * synthetic audit, same-named unplanned tools, changed source, substituted
 * provider/connector, cross-principal or cross-session replay and stale
 * generation. Every refusal asserts zero provider calls.
 */
import { describe, expect, it, vi } from 'vitest';
import { McpProviderBroker } from '../../src/broker.js';
import { CompiledMemoryDispatch } from '../../src/memory/index.js';
import { makeCtx, makeMemoryAdapter, makePlan, selectInput } from './fixtures.js';

const MEMORY_OPTS = { purposeRef: 'purpose-1', idempotencyKey: '0123456789abcdef' };

function makeBroker() {
  const adapter = makeMemoryAdapter();
  const broker = new McpProviderBroker({
    plan: makePlan(['engram_memory_search']),
    adapters: [adapter],
    sourceId: 'mcp:engram-memory',
    generation: '1',
  });
  return { broker, adapter };
}

describe('P01.broker.forged-call', () => {
  it('P01.broker.forged-call: direct calls without verified context fail before the provider', async () => {
    const { broker, adapter } = makeBroker();
    const spy = vi.spyOn(adapter, 'invokeTool');
    await expect(
      broker.invoke('engram-memory', 'engram_memory_search', { purpose_ref: 'purpose-1' }, {
        ctx: undefined as unknown as never,
        ...MEMORY_OPTS,
      }),
    ).rejects.toMatchObject({ code: '-32603' });
    await expect(
      broker.invoke('engram-memory', 'engram_memory_search', { purpose_ref: 'purpose-1' }, {
        ctx: makeCtx({ auditId: 'audit_mcp_l0_default' }),
        ...MEMORY_OPTS,
      }),
    ).rejects.toMatchObject({ code: '-32603' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('P01.broker.forged-call: same-named unplanned tools never select another handler', async () => {
    const { broker, adapter } = makeBroker();
    const spy = vi.spyOn(adapter, 'invokeTool');
    const result = await broker.invoke('engram-memory', 'engram_memory_capture', {}, {
      ctx: makeCtx(),
      ...MEMORY_OPTS,
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('CAPABILITY_UNAVAILABLE');
    expect(spy).not.toHaveBeenCalled();
  });

  it('P01.broker.forged-call: substituted connector, principal and session fail closed', async () => {
    const { broker, adapter } = makeBroker();
    const spy = vi.spyOn(adapter, 'invokeTool');
    await expect(
      broker.invoke('mock', 'engram_memory_search', { purpose_ref: 'purpose-1' }, { ctx: makeCtx(), ...MEMORY_OPTS }),
    ).rejects.toThrow();
    const crossPrincipal = await broker.invoke('engram-memory', 'engram_memory_search', { purpose_ref: 'purpose-1' }, {
      ctx: makeCtx({
        principal: {
          sub: 'user-2',
          claims: { sub: 'user-2', tid: 'tenant-1' },
          scopes: ['mcp:tools:invoke'],
          tenantRef: 'tenant-1',
          authTime: '2026-10-18T00:00:00.000Z',
        },
      }),
      ...MEMORY_OPTS,
    }).catch(error => error);
    expect(crossPrincipal).toMatchObject({ code: '-32603' });
    const staleSession = makeCtx({ session: {} });
    await expect(
      broker.invoke('engram-memory', 'engram_memory_search', { purpose_ref: 'purpose-1' }, { ctx: staleSession, ...MEMORY_OPTS }),
    ).rejects.toMatchObject({ code: '-32603' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('P01.broker.forged-call: compiled selection refuses forged bindings with zero provider contact', () => {
    const adapter = makeMemoryAdapter();
    const spy = vi.spyOn(adapter, 'invokeTool');
    const dispatch = new CompiledMemoryDispatch({
      plan: makePlan(),
      adapters: [adapter],
      sourceId: 'mcp:engram-memory',
      generation: '1',
    });
    const forged = [
      selectInput({ expectedSourceId: 'mcp:forged' }),
      selectInput({ expectedGeneration: '0' }),
      selectInput({ expectedPrincipalSub: 'forged-user' }),
      selectInput({ expectedTenantRef: 'forged-tenant' }),
      selectInput({ toolName: 'engram_memory_search ', purposeRef: 'purpose-1' }),
    ];
    for (const input of forged) {
      expect(() => dispatch.select(input)).toThrow();
    }
    expect(spy).not.toHaveBeenCalled();
  });
});
