import { describe, expect, it, vi } from 'vitest';
import { UnresolvedQuarantine, type QuarantinedInput } from '../../src/services/canvas-live/quarantine';

const item = (id: string): QuarantinedInput => ({
  id,
  actorId: 'human-a',
  sessionEpoch: 'epoch-1',
  fieldKey: 'body',
  documentId: 'canvas:a',
  encodedUpdate: 'dXBkYXRl',
});

describe('canvas live unresolved-input quarantine', () => {
  it('should retain structs outside authoritative state with actor and admission', async () => {
    const revalidate = vi.fn(async () => 'retain' as const);
    const quarantine = new UnresolvedQuarantine({ revalidate });
    quarantine.add(item('q-1'));
    expect(quarantine.has('q-1')).toBe(true);
    expect(quarantine.size).toBe(1);
    expect(quarantine.pendingFor('human-a')).toHaveLength(1);
    expect(revalidate).not.toHaveBeenCalled();
  });

  it('should rerun checks on dependency arrival before integration', async () => {
    const revalidate = vi.fn(async () => 'integrate' as const);
    const quarantine = new UnresolvedQuarantine({ revalidate });
    quarantine.add(item('q-2'));
    const result = await quarantine.dependenciesArrived();
    expect(result).toEqual({ integrated: ['q-2'], refused: [], retained: [] });
    expect(quarantine.size).toBe(0);
    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  it('should refuse rejected dependencies without leaking them', async () => {
    const onRefuse = vi.fn();
    const revalidate = vi.fn(async () => 'refuse' as const);
    const quarantine = new UnresolvedQuarantine({ revalidate, onRefuse });
    quarantine.add(item('q-3'));
    const result = await quarantine.dependenciesArrived();
    expect(result.refused).toEqual(['q-3']);
    expect(onRefuse).toHaveBeenCalledTimes(1);
    expect(quarantine.refusalsByClass()).toEqual({ 'unresolved-struct': 1 });
  });

  it('should reject duplicate quarantine ids', () => {
    const quarantine = new UnresolvedQuarantine({ revalidate: async () => 'retain' as const });
    quarantine.add(item('q-4'));
    expect(() => quarantine.add(item('q-4'))).toThrow('duplicate-paragraph');
  });
});
