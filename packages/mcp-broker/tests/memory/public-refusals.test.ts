import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { isPublicMemoryErrorCode, MEMORY_TOOL_NAMES } from '@sentropic/mcp-platform/memory';
import { validateSchema } from '../../../mcp-platform/src/memory/schema-validation.js';
import { McpProviderBroker } from '../../src/broker.js';
import { makeCtx, makeMemoryAdapter, makePlan } from './fixtures.js';

const oracle = JSON.parse(readFileSync(new URL('../../../../tools/memory-mcp-l5/fixtures/l0/tool-schemas.json', import.meta.url), 'utf8'));
const refusals = [
  ['scope', 'UNAUTHORIZED'], ['source', 'UNAUTHORIZED'],
  ['generation', 'AUTHORIZATION_REVOKED'], ['unplanned', 'CAPABILITY_UNAVAILABLE'],
  ['undeclared', 'CAPABILITY_UNAVAILABLE'],
] as const;

describe.each(MEMORY_TOOL_NAMES)('%s public broker refusals', tool => {
  it.each(refusals)('maps %s to the frozen %s envelope with zero provider calls', async (cause, code) => {
    const adapter = makeMemoryAdapter(), invoke = vi.spyOn(adapter, 'invokeTool'), ctx = makeCtx();
    const plan = makePlan(cause === 'unplanned' ? [] : [tool]);
    if (cause === 'undeclared') adapter.manifest.tools = adapter.manifest.tools.filter(t => t.name !== tool);
    if (cause === 'scope') ctx.principal.scopes = [];
    if (cause === 'source') ctx.memory!.binding = { ...ctx.memory!.binding, selected_source_id: 'other' as any };
    if (cause === 'generation') ctx.memory!.binding = { ...ctx.memory!.binding, active_generation: '2' };
    const broker = new McpProviderBroker({ plan, adapters: [adapter], sourceId: 'mcp:engram-memory', generation: '1' });
    const result = await broker.invoke('engram-memory', tool, { purpose_ref: 'purpose-1' }, {
      ctx, purposeRef: 'purpose-1', idempotencyKey: '0123456789abcdef', elicitationRef: 'elicit-1',
    });
    expect(result.error?.code).toBe(code);
    expect(isPublicMemoryErrorCode(result.error?.code)).toBe(true);
    expect(validateSchema(result, oracle.schemas[tool].outputSchema)).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });
});

it('preserves the constant protocol refusal for an unavailable trusted audit', async () => {
  const adapter = makeMemoryAdapter(), invoke = vi.spyOn(adapter, 'invokeTool');
  const broker = new McpProviderBroker({ plan: makePlan(), adapters: [adapter], sourceId: 'mcp:engram-memory', generation: '1' });
  await expect(broker.invoke('engram-memory', 'engram_memory_search', {}, { ctx: makeCtx({ auditId: '' }) }))
    .rejects.toMatchObject({ code: '-32603', message: 'Trusted invocation context unavailable' });
  expect(invoke).not.toHaveBeenCalled();
});
