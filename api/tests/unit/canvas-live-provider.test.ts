import { describe, expect, it, vi } from 'vitest';
import type { AdmissionRecord } from '../../src/services/canvas-live/admission';
import { SessionRegistry } from '../../src/services/canvas-live/session-registry';

function fixture() {
  const record: AdmissionRecord = { tenantId: 't', workspaceId: 'w', documentId: 'canvas:a', sessionId: 's', sessionEpoch: 'admission-1', profileId: 'full@1', schemaEpoch: '2', fields: ['description', 'notes', 'meta'], operations: ['read', 'edit'], closed: false, actor: { actorId: 'a', kind: 'human', displayLabel: 'A', color: '#123456' } };
  const disconnected = vi.fn(); const removed = vi.fn(); const createdNames: string[] = [];
  const connect = vi.fn(() => disconnected);
  const create = vi.fn(() => {
    const types = new Map<string, unknown>();
    return { document: {
      getText(name: string) { createdNames.push(name); if (!types.has(name)) types.set(name, { value: '' }); return types.get(name); },
      getMap(name: string) { createdNames.push(name); if (!types.has(name)) types.set(name, new Map()); return types.get(name) as Map<string, unknown>; },
    }, awareness: { remove: removed }, connect };
  });
  let clientId = 10;
  return { record, registry: new SessionRegistry({ create, clientId: () => ++clientId }), create, connect, disconnected, removed, createdNames };
}
describe('canvas live binding registry', () => {
  it('should keep notes live when description unmounts, close only after the last mount, and retain state', async () => {
    const f = fixture(); const a = f.registry.open(f.record, 'description'); const b = f.registry.open(f.record, 'notes');
    const notes = f.registry.resolveBinding(f.record, b.identity); const text = notes.text as { value: string };
    text.value = 'remote'; await a.dispose(); await a.dispose();
    expect(f.registry.resolveBinding(f.record, b.identity)).toBe(notes);
    text.value += '+local'; expect(text.value).toBe('remote+local'); expect(f.disconnected).not.toHaveBeenCalled();
    await b.dispose(); expect(f.disconnected).toHaveBeenCalledTimes(1);
    expect(() => f.registry.resolveBinding(f.record, b.identity)).toThrow('invalid-binding');
    const reopened = f.registry.open(f.record, 'notes');
    expect(f.registry.resolveBinding(f.record, reopened.identity).text).toBe(text);
    expect(f.create).toHaveBeenCalledTimes(1); expect(f.connect).toHaveBeenCalledTimes(2);
  });
  it('should reference-count repeated mounts of the same field and share one awareness per document', async () => {
    const f = fixture(); const a = f.registry.open(f.record, 'notes'); const b = f.registry.open(f.record, 'notes');
    const meta = f.registry.open(f.record, 'meta');
    expect(f.registry.resolveBinding(f.record, a.identity).awareness).toBe(f.registry.resolveBinding(f.record, meta.identity).awareness);
    await a.dispose(); expect(() => f.registry.resolveBinding(f.record, b.identity)).not.toThrow();
    expect(f.createdNames).toEqual(expect.arrayContaining(['meta', 'field:notes', 'fieldmeta:notes', 'field:meta', 'fieldmeta:meta']));
  });
  it.each([{ documentId: 'other', sessionId: 's', fieldKey: 'notes' }, { documentId: 'canvas:a', sessionId: 'other', fieldKey: 'notes' }, { documentId: 'canvas:a', sessionId: 's', fieldKey: 'other' }, { documentId: 'canvas:a', fieldKey: 'notes' }])('should refuse incomplete or mismatched identity %j', (identity) => {
    const f = fixture(); f.registry.open(f.record, 'notes');
    expect(() => f.registry.resolveBinding(f.record, identity as never)).toThrow('invalid-binding');
  });
  it('should isolate identical document/session identifiers across tenants', () => {
    const f = fixture(); const a = f.registry.open(f.record, 'notes'); const other = { ...f.record, tenantId: 'other' };
    expect(() => f.registry.resolveBinding(other, a.identity)).toThrow('invalid-binding');
    const b = f.registry.open(other, 'notes');
    expect(f.registry.resolveBinding(other, b.identity).text).not.toBe(f.registry.resolveBinding(f.record, a.identity).text);
  });
  it('should deliver actor/client registry updates and remove revoked actors without disconnecting peers', () => {
    const f = fixture(); const updates = vi.fn(); const stop = f.registry.subscribeActors(f.record, updates);
    f.registry.open(f.record, 'notes');
    const agent = { ...f.record, actor: { ...f.record.actor, actorId: 'agent-b', kind: 'agent' as const } };
    const b = f.registry.open(agent, 'notes');
    const actors = updates.mock.lastCall![0]; expect(actors).toHaveLength(2);
    expect(new Set(actors.map((a: { awarenessClientId: number }) => a.awarenessClientId)).size).toBe(2);
    f.registry.revoke(f.record);
    expect(updates.mock.lastCall![0].map((a: { actor: { actorId: string } }) => a.actor.actorId)).toEqual(['agent-b']);
    expect(f.removed).toHaveBeenCalled(); expect(f.disconnected).not.toHaveBeenCalled();
    expect(() => f.registry.resolveBinding(f.record, b.identity)).toThrow('invalid-binding');
    expect(() => f.registry.resolveBinding(agent, b.identity)).not.toThrow(); stop();
  });
});
