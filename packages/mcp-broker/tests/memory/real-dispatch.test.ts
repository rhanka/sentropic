import { describe, expect, it, vi } from 'vitest';
import { McpProviderBroker } from '../../src/broker.js';
import { hostContext } from '../../../mcp-platform/tests/memory/host-fixture.js';
import { makeMemoryAdapter, makePlan } from './fixtures.js';

function setup(plan = makePlan()) {
  const adapter = makeMemoryAdapter();
  const invoke = vi.spyOn(adapter, 'invokeTool');
  const broker = new McpProviderBroker({ plan, adapters: [adapter], sourceId: 'mcp:engram-memory', generation: '1' });
  const options = { ctx: hostContext(), purposeRef: 'purpose-1', idempotencyKey: '0123456789abcdef', elicitationRef: 'elicit-1' };
  return { broker, invoke, options };
}
describe('real broker memory path', () => {
  it.each(['requiresHumanConfirmation', 'requiresElicitation'])('enforces strengthened %s on a read tool before provider contact', async gate => {
    const plan = makePlan();
    (plan.resolveTool('engram_memory_search')!.entry.gates as any)[gate] = true;
    const { broker, invoke, options } = setup(plan);
    delete (options as any).elicitationRef;
    expect((await broker.invoke('engram-memory', 'engram_memory_search', { query: 'query', purpose_ref: 'purpose-1' }, options)).ok).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
    options.elicitationRef = 'elicit-1';
    expect((await broker.invoke('engram-memory', 'engram_memory_search', { query: 'query', purpose_ref: 'purpose-1' }, options)).ok).toBe(true);
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke.mock.calls[0][0]).toMatchObject({ memoryConfirmationRequired: true, elicitationRef: 'elicit-1' });
  });
  it('enforces the current host confirmation requirement even without a plan gate', async () => {
    const { broker, invoke, options } = setup();
    (options.ctx.memory as any).confirmationRequired = true;
    delete (options as any).elicitationRef;
    expect((await broker.invoke('engram-memory', 'engram_memory_search', { query: 'query', purpose_ref: 'purpose-1' }, options)).ok).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });
  it('delivers the exact A03 projection and out-of-arguments envelope to the provider', async () => {
    const { broker, invoke, options } = setup();
    expect((await broker.invoke('engram-memory', 'engram_memory_search', { query: 'query', purpose_ref: 'purpose-1' }, options)).ok).toBe(true);
    expect(invoke).toHaveBeenCalledOnce();
    const envelope = invoke.mock.calls[0][0] as any;
    expect(envelope.idempotencyKey).toBe(options.idempotencyKey);
    expect(envelope.elicitationRef).toBe(options.elicitationRef);
    expect(envelope.memoryContext.envelope_bindings).toEqual({ idempotency_key: options.idempotencyKey,
      elicitation_ref: options.elicitationRef, audit_id: 'audit-host-1', correlation_ref: 'corr-1' });
    expect(envelope.memoryContext.trusted_context).toMatchObject({ store_id: 'store-1', scope_ref: 'scope-1', tenant_id: 'tenant-1' });
  });
  it.each(['selected_source_id', 'active_generation', 'connector_instance_ref'])('refuses substituted %s before provider contact', async key => {
    const { broker, invoke, options } = setup();
    (options.ctx.memory!.binding as any)[key] = 'substitution';
    await broker.invoke('engram-memory', 'engram_memory_search', { purpose_ref: 'purpose-1' }, options).catch(() => undefined);
    expect(invoke).not.toHaveBeenCalled();
  });
  it('refuses a tool purpose differing from the trusted purpose', async () => {
    const { broker, invoke, options } = setup();
    const result = await broker.invoke('engram-memory', 'engram_memory_search', { purpose_ref: 'purpose-9' }, options);
    expect(result.ok).toBe(false); expect(invoke).not.toHaveBeenCalled();
  });
});
