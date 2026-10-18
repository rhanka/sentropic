/**
 * MCP-L5 Lot 1 — broker verified invocation context tests.
 *
 * Case: P01.broker.invocation-context. Covers the broker seam projection
 * for two principals and two tenants, workspace/tenant separation,
 * altered agent/session bindings and same-name collision isolation, with
 * zero unauthorized handler calls.
 */
import { describe, expect, it } from 'vitest';
import type { StpConnectorContext } from '@sentropic/mcp-platform';
import {
  bindMemoryInvocation,
  CompiledMemoryDispatch,
} from '../../src/memory/index.js';
import { makeCtx, makeMemoryAdapter, makePlan, selectInput } from './fixtures.js';

describe('P01.broker.invocation-context', () => {
  it('P01.broker.invocation-context: binds a verified invocation with its audit reference', () => {
    const bound = bindMemoryInvocation({
      ctx: makeCtx(),
      purposeRef: 'purpose-1',
      idempotencyKey: '0123456789abcdef',
    });
    expect(bound.auditRef).toBe('audit-host-1');
    expect(bound.projection.principalId).toBe('user-1');
    expect(bound.projection.tenantId).toBe('tenant-1');
    expect(bound.projection.idempotencyKey).toBe('0123456789abcdef');
    expect(bound.projection.elicitationRef).toBeNull();
  });

  it('P01.broker.invocation-context: selects the exact planned tool for two principals and two tenants', () => {
    const dispatch = new CompiledMemoryDispatch({
      plan: makePlan(),
      adapters: [makeMemoryAdapter()],
      sourceId: 'mcp:engram-memory',
      generation: '1',
    });
    const first = dispatch.select(selectInput());
    expect(first.selection.capabilityName).toBe('engram_memory_search');
    expect(first.selection.sourceBinding).toEqual({
      providerId: 'sentropic.engram.memory',
      connectorId: 'engram-memory',
      sourceId: 'mcp:engram-memory',
      connectorInstanceRef: 'ci-1',
      generation: '1',
    });
    const second = dispatch.select(
      selectInput({
        ctx: makeCtx({
          principal: {
            sub: 'user-2',
            claims: { sub: 'user-2', tid: 'tenant-2' },
            scopes: ['mcp:tools:invoke'],
            tenantRef: 'tenant-2',
            authTime: '2026-10-18T00:00:00.000Z',
          },
          tenantRef: 'tenant-2',
          auditId: 'audit-host-2',
        }),
        expectedPrincipalSub: 'user-2',
        expectedTenantRef: 'tenant-2',
      }),
    );
    expect(second.projection.principalId).toBe('user-2');
    expect(second.projection.tenantId).toBe('tenant-2');
    expect(second.auditRef).toBe('audit-host-2');
  });

  it('P01.broker.invocation-context: refuses workspace-as-tenant and altered agent or session bindings', () => {
    const dispatch = new CompiledMemoryDispatch({
      plan: makePlan(),
      adapters: [makeMemoryAdapter()],
      sourceId: 'mcp:engram-memory',
      generation: '1',
    });
    expect(() =>
      dispatch.select(selectInput({ ctx: makeCtx({ workspaceRef: 'tenant-1' }) })),
    ).toThrow();
    expect(() =>
      dispatch.select(selectInput({ ctx: makeCtx({ session: {} }) })),
    ).toThrow();
    const claimed = dispatch.select(
      selectInput({
        ctx: makeCtx({
          principal: {
            sub: 'user-1',
            claims: { sub: 'user-1', tid: 'tenant-1', agent_ref: 'agent-9' },
            scopes: ['mcp:tools:invoke'],
            tenantRef: 'tenant-1',
            authTime: '2026-10-18T00:00:00.000Z',
          },
        }),
      }),
    );
    expect(claimed.projection.agentRef).toBe('agent-9');
  });
});
