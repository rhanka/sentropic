import { describe, expect, it, vi } from 'vitest';
import { DraftRecovery, type PreservedDraft } from '../../src/services/canvas-live/recovery';

function fixture() {
  const principal = { tenantId: 't', workspaceId: 'w', actor: { actorId: 'b', kind: 'human' as const, displayLabel: 'B', color: '#123456' } };
  const facts = { documentId: 'canvas:a', sessionId: 's', profileId: 'current@1', schemaEpoch: '2', fields: ['description'] };
  const original = new Uint8Array([0, 255, 13, 10, 127]);
  const drafts = new Map<string, PreservedDraft>();
  const pending = new Map<string, string>();
  const migrate = vi.fn(async (bytes: Uint8Array) => new Uint8Array([...bytes, 42]));
  const ports = {
    pending: async (key: string, id?: string) => { if (id) pending.set(key, id); return pending.get(key) ?? null; },
    update: async (key: string, change: (old?: PreservedDraft) => PreservedDraft) => {
      const value = change(drafts.get(key)); drafts.set(key, structuredClone(value)); return structuredClone(value);
    }, migrate,
  };
  return { principal, facts, original, migrate, drafts, ports, recovery: new DraftRecovery(ports) };
}
describe('canvas incompatible draft recovery', () => {
  it.each(['client-upgrade', 'draft-migration'] as const)('should require explicit actor/draft acknowledgement for %s', async (branch) => {
    const f = fixture(); const before = structuredClone(f.facts);
    const preserved = await f.recovery.preserve(f.principal, f.facts.documentId, 'draft-b', { bytes: f.original, profileId: 'old@1', schemaEpoch: '1' });
    expect(preserved.bytes).toEqual(f.original);
    const prepared = await f.recovery.prepare(f.principal, f.facts, 'draft-b', branch);
    expect(prepared.bytes).toEqual(f.original);
    expect(prepared.prepared?.bytes).toEqual(branch === 'draft-migration' ? new Uint8Array([...f.original, 42]) : f.original);
    await expect(f.recovery.requireAcknowledged(f.principal, f.facts, 'draft-b')).rejects.toMatchObject({ code: 'incompatible-schema' });
    await expect(f.recovery.requirePendingAcknowledged(f.principal, f.facts)).rejects.toMatchObject({ code: 'incompatible-schema' });
    await f.recovery.acknowledge(f.principal, f.facts, 'draft-b');
    await expect(new DraftRecovery(f.ports).requireAcknowledged(f.principal, f.facts, 'draft-b')).resolves.toBeUndefined();
    await expect(new DraftRecovery(f.ports).requirePendingAcknowledged(f.principal, f.facts)).resolves.toBeUndefined();
    expect(f.facts).toEqual(before);
    expect(f.migrate).toHaveBeenCalledTimes(branch === 'draft-migration' ? 1 : 0);
    await expect(f.recovery.requireAcknowledged({ ...f.principal, tenantId: 'other' }, f.facts, 'draft-b')).rejects.toMatchObject({ code: 'incompatible-schema' });
    await expect(f.recovery.requireAcknowledged({ ...f.principal, actor: { ...f.principal.actor, actorId: 'other' } }, f.facts, 'draft-b')).rejects.toMatchObject({ code: 'incompatible-schema' });
    await expect(f.recovery.requireAcknowledged(f.principal, { ...f.facts, schemaEpoch: '3' }, 'draft-b')).rejects.toMatchObject({ code: 'incompatible-schema' });
  });
  it('should preserve bytes across repeated incompatible retries without overwriting or acknowledging them', async () => {
    const f = fixture();
    await f.recovery.preserve(f.principal, f.facts.documentId, 'draft-b', { bytes: f.original, profileId: 'old@1', schemaEpoch: '1' });
    const retry = await f.recovery.preserve(f.principal, f.facts.documentId, 'draft-b', { bytes: new Uint8Array([1]), profileId: 'old@1', schemaEpoch: '1' });
    expect(retry.bytes).toEqual(f.original);
    await expect(f.recovery.acknowledge(f.principal, f.facts, 'draft-b')).rejects.toMatchObject({ code: 'incompatible-schema' });
  });
});
