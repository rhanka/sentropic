/**
 * MCP-L5 Lot 1 — broker source-binding tests.
 *
 * Case: P01.broker.source-binding. Covers exact source selection, changed
 * sourceId, substituted provider/connector, stale generation, same-name
 * collision across connectors and cross-principal or cross-tenant
 * substitution, with zero selection of another handler.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  CompiledMemoryDispatch,
  MemoryDispatchRefusal,
} from '../../src/memory/index.js';
import { makeCtx, makeMemoryAdapter, makePlan, selectInput } from './fixtures.js';

function makeDispatch() {
  return new CompiledMemoryDispatch({
    plan: makePlan(['engram_memory_search', 'engram_memory_get']),
    adapters: [makeMemoryAdapter()],
    sourceId: 'mcp:engram-memory',
    generation: 'gen-1',
  });
}

describe('P01.broker.source-binding', () => {
  it('P01.broker.source-binding: selects the exact planned source with no handler contact', () => {
    const adapter = makeMemoryAdapter();
    const spy = vi.spyOn(adapter, 'invokeTool');
    const dispatch = new CompiledMemoryDispatch({
      plan: makePlan(),
      adapters: [adapter],
      sourceId: 'mcp:engram-memory',
      generation: 'gen-1',
    });
    const selected = dispatch.select(selectInput());
    expect(selected.adapter).toBe(adapter);
    expect(selected.selection.capabilityName).toBe('engram_memory_search');
    expect(spy).not.toHaveBeenCalled();
  });

  it('P01.broker.source-binding: refuses changed sourceId and stale generation', () => {
    const dispatch = makeDispatch();
    expect(() => dispatch.select(selectInput({ expectedSourceId: 'mcp:other' }))).toThrow(
      expect.objectContaining({ refusalCode: 'source_binding_mismatch' }),
    );
    expect(() => dispatch.select(selectInput({ expectedGeneration: 'gen-0' }))).toThrow(
      expect.objectContaining({ refusalCode: 'stale_generation' }),
    );
  });

  it('P01.broker.source-binding: refuses substituted provider, connector and unplanned names', () => {
    const dispatch = makeDispatch();
    expect(() => dispatch.select(selectInput({ toolName: 'engram_memory_capture' }))).toThrow(
      expect.objectContaining({ refusalCode: 'unknown_tool' }),
    );
    expect(() => dispatch.select(selectInput({ toolName: 'do_thing' }))).toThrow(
      expect.objectContaining({ refusalCode: 'unknown_tool' }),
    );
    expect(
      () =>
        new CompiledMemoryDispatch({
          plan: makePlan(),
          adapters: [makeMemoryAdapter('other-connector')],
          sourceId: 'mcp:engram-memory',
          generation: 'gen-1',
        }),
    ).toThrow(MemoryDispatchRefusal);
  });

  it('P01.broker.source-binding: refuses cross-principal and cross-tenant substitution', () => {
    const dispatch = makeDispatch();
    expect(() => dispatch.select(selectInput({ expectedPrincipalSub: 'user-9' }))).toThrow(
      expect.objectContaining({ refusalCode: 'principal_mismatch' }),
    );
    expect(() => dispatch.select(selectInput({ expectedTenantRef: 'tenant-9' }))).toThrow(
      expect.objectContaining({ refusalCode: 'tenant_mismatch' }),
    );
    expect(() =>
      dispatch.select(
        selectInput({
          ctx: makeCtx({
            principal: {
              sub: 'user-1',
              claims: { sub: 'user-1', tid: 'tenant-1' },
              scopes: [],
              tenantRef: 'tenant-1',
              authTime: '2026-10-18T00:00:00.000Z',
            },
          }),
        }),
      ),
    ).toThrow(expect.objectContaining({ refusalCode: 'insufficient_scope' }));
  });
});
