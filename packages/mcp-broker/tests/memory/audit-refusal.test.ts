/**
 * MCP-L5 Lot 1 — audit refusal tests (M2-AUDIT-MISSING).
 *
 * Case: P02.broker.audit-refusal-32603. Invokes the real broker guard with
 * no audit context and asserts the pre-dispatch protocol error -32603 with
 * the constant message plus zero provider or effect calls. A controlled
 * mutation substituting the forbidden synthetic fallback must fail: the
 * guard throws instead of constructing a domain envelope. Valid audit
 * context survives byte-for-byte into the domain envelope.
 */
import { describe, expect, it, vi } from 'vitest';
import type {
  AppConnectorProviderAdapter,
  AppToolInvocation,
  AppToolResult,
} from '@sentropic/mcp-platform';
import { McpBrokerError, McpProviderBroker } from '../../src/broker.js';
import { bindMemoryInvocation } from '../../src/memory/index.js';
import { makeCtx, makeMemoryAdapter, makePlan } from './fixtures.js';

const MEMORY_OPTS = { purposeRef: 'purpose-1', idempotencyKey: '0123456789abcdef' };

function makeAuditedAdapter(calls: { count: number }): AppConnectorProviderAdapter {
  const base = makeMemoryAdapter();
  return {
    ...base,
    async invokeTool(req: AppToolInvocation): Promise<AppToolResult> {
      calls.count += 1;
      return {
        ok: true,
        output: { schema_version: 1, value: { auditId: req.ctx.auditId } },
        auditId: req.ctx.auditId,
        redactionClass: 'high',
      };
    },
  };
}

describe('P02.broker.audit-refusal-32603', () => {
  it('P02.broker.audit-refusal-32603: missing audit refuses with -32603 and zero provider calls', async () => {
    const calls = { count: 0 };
    const broker = new McpProviderBroker({
      plan: makePlan(['engram_memory_search']),
      adapters: [makeAuditedAdapter(calls)],
      sourceId: 'mcp:engram-memory',
      generation: '1',
    });
    for (const ctx of [
      undefined,
      makeCtx({ auditId: '' }),
      makeCtx({ auditId: 'audit_mcp_l0_default' }),
    ] as unknown[]) {
      await expect(
        broker.invoke('engram-memory', 'engram_memory_search', { purpose_ref: 'purpose-1' }, {
          ctx: ctx as never,
          ...MEMORY_OPTS,
        }),
      ).rejects.toMatchObject({
        name: 'McpBrokerError',
        code: '-32603',
        message: 'Trusted invocation context unavailable',
      });
    }
    expect(calls.count).toBe(0);
  });

  it('P02.broker.audit-refusal-32603: synthetic fallback mutation fails instead of enveloping', async () => {
    expect(() =>
      bindMemoryInvocation({
        ctx: makeCtx({ auditId: 'audit_mcp_l0_default' }),
        purposeRef: 'purpose-1',
        idempotencyKey: '0123456789abcdef',
      }),
    ).toThrow();
    await expect(
      (async () => {
        const calls = { count: 0 };
        const broker = new McpProviderBroker({
          plan: makePlan(['engram_memory_search']),
          adapters: [makeAuditedAdapter(calls)],
          sourceId: 'mcp:engram-memory',
          generation: '1',
        });
        return broker.invoke('engram-memory', 'engram_memory_search', { purpose_ref: 'purpose-1' }, {
          ctx: makeCtx({ auditId: 'audit_mcp_l0_default' }),
          ...MEMORY_OPTS,
        });
      })(),
    ).rejects.toBeInstanceOf(McpBrokerError);
  });

  it('P02.broker.audit-refusal-32603: valid audit survives byte-for-byte into the envelope', async () => {
    const calls = { count: 0 };
    const broker = new McpProviderBroker({
      plan: makePlan(['engram_memory_search']),
      adapters: [makeAuditedAdapter(calls)],
      sourceId: 'mcp:engram-memory',
      generation: '1',
    });
    const result = await broker.invoke('engram-memory', 'engram_memory_search', { purpose_ref: 'purpose-1' }, {
      ctx: makeCtx({ auditId: 'audit-survives-1', memory: { ...makeCtx().memory!,
        binding: { ...makeCtx().memory!.binding, audit_id: 'audit-survives-1' } } }),
      ...MEMORY_OPTS,
    });
    expect(result.ok).toBe(true);
    expect(result.auditId).toBe('audit-survives-1');
    expect(calls.count).toBe(1);
  });
});
