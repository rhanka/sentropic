import { describe, expect, it, vi } from 'vitest';
import { AdmissionAuthority, type AdmissionRecord } from '../../src/services/canvas-live/admission';
import { DraftRecovery, type PreservedDraft } from '../../src/services/canvas-live/recovery';
import { LiveSessionProvider } from '../../src/services/canvas-live/provider';
import { SessionRegistry } from '../../src/services/canvas-live/session-registry';

function fixture() {
  let actor = { actorId: 'a', kind: 'human' as 'human' | 'agent', displayLabel: 'A', color: '#123456' };
  const principal = () => ({ tenantId: 't', workspaceId: 'w', actor });
  const facts = { documentId: 'canvas:a', sessionId: 's', profileId: 'full@1', schemaEpoch: '2', fields: ['description', 'notes'] };
  let grantedFields = facts.fields;
  const records = new Map<string, AdmissionRecord>(); const drafts = new Map<string, PreservedDraft>(); const pending = new Map<string, string>();
  let epoch = 0; let client = 10;
  const ports = { authenticate: async () => structuredClone(principal()), document: async () => structuredClone(facts), authorize: async () => ({ ...principal(), documentId: facts.documentId, fields: grantedFields, operations: ['read', 'edit'] }), epoch: () => `epoch-${++epoch}`,
    update: async (key: string, change: (old?: AdmissionRecord) => AdmissionRecord) => { const result = change(records.get(key)); records.set(key, structuredClone(result)); return structuredClone(result); },
    captureDraft: async () => ({ draftId: 'capture-1', bytes: new Uint8Array([0, 255, 65]) }),
  };
  const recoveryPorts = {
    update: async (key: string, change: (old?: PreservedDraft) => PreservedDraft) => { const result = change(drafts.get(key)); drafts.set(key, structuredClone(result)); return structuredClone(result); },
    pending: async (key: string, id?: string | null, expected?: string) => { if (id === null && pending.get(key) === expected) pending.delete(key); else if (id) pending.set(key, id); return pending.get(key) ?? null; },
    migrate: async (bytes: Uint8Array) => bytes.slice(),
  };
  const types = new Map<string, unknown>(); const disconnected = vi.fn();
  const resource = { document: {
    getText(name: string) { if (!types.has(name)) types.set(name, { value: 'retained' }); return types.get(name); },
    getMap(name: string) { if (!types.has(name)) types.set(name, new Map()); return types.get(name) as Map<string, unknown>; },
  }, awareness: { remove: vi.fn() }, connect: vi.fn(() => disconnected) };
  const registry = new SessionRegistry({ create: () => resource, clientId: () => ++client });
  const authority = new AdmissionAuthority(ports); const recovery = new DraftRecovery(recoveryPorts);
  const provider = new LiveSessionProvider(authority, registry, recovery, ports);
  return { provider, registry, authority, facts, records, resource, disconnected, drafts, pending,
    input: () => ({ binding: { documentId: facts.documentId, fieldKey: 'notes' }, actor, profileId: facts.profileId, schemaEpoch: facts.schemaEpoch }),
    use: (id: string, kind: 'human' | 'agent' = 'human') => { actor = { ...actor, actorId: id, kind }; },
    allowFields: (fields: string[]) => { grantedFields = fields; },
  };
}
describe('canvas live composed lifetime', () => {
  it('should release a denied field and its listener while another authorized field stays live', async () => {
    const f = fixture(); const notes = await f.provider.openLiveSession(f.input());
    const descriptionInput = () => ({ ...f.input(), binding: { ...f.input().binding, fieldKey: 'description' } });
    const description = await f.provider.openLiveSession(descriptionInput());
    const notesUpdates = vi.fn(); const descriptionUpdates = vi.fn();
    await f.provider.subscribeActors(notes.identity, notesUpdates); await f.provider.subscribeActors(description.identity, descriptionUpdates);
    f.allowFields(['description']);
    await expect(f.provider.resolveBinding(notes.identity)).rejects.toMatchObject({ code: 'scope-denied' });
    expect(notesUpdates.mock.lastCall![0]).toEqual([]);
    expect((await f.provider.resolveBinding(description.identity)).text).toBeDefined();
    await expect(f.provider.authorizeBinding(description.identity, 'edit')).resolves.toBeUndefined();
    const stoppedCount = notesUpdates.mock.calls.length;
    f.use('b', 'agent'); const b = await f.provider.openLiveSession(descriptionInput());
    expect(descriptionUpdates.mock.lastCall![0]).toHaveLength(2); expect(notesUpdates).toHaveBeenCalledTimes(stoppedCount);
    expect(f.disconnected).not.toHaveBeenCalled(); await notes.dispose(); await b.dispose(); await description.dispose();
  });
  it('should invalidate a remotely closed admission on the next edit authorization without requiring a read', async () => {
    const f = fixture(); const handle = await f.provider.openLiveSession(f.input()); const updates = vi.fn();
    await f.provider.subscribeActors(handle.identity, updates);
    for (const record of f.records.values()) record.closed = true;
    await expect(f.provider.authorizeBinding(handle.identity, 'edit')).rejects.toMatchObject({ code: 'revoked' });
    expect(updates.mock.lastCall![0]).toEqual([]); expect(f.disconnected).toHaveBeenCalledTimes(1);
  });
  it('should support explicit host session close and rotation without stale handles disturbing the new session', async () => {
    const f = fixture(); const old = await f.provider.openLiveSession(f.input()); const record = [...f.records.values()][0];
    const text = (await f.provider.resolveBinding(old.identity)).text;
    f.registry.closeSession(record);
    expect(() => f.registry.open(record, 'notes')).toThrow('invalid-binding');
    expect(() => f.registry.subscribeActors(record, vi.fn())).toThrow('invalid-binding');
    f.facts.sessionId = 'new-session'; const current = await f.provider.openLiveSession(f.input());
    await expect(f.provider.resolveBinding(old.identity)).rejects.toMatchObject({ code: 'revoked' });
    await old.dispose(); expect((await f.provider.resolveBinding(current.identity)).text).toBe(text);
    expect(f.disconnected).toHaveBeenCalledTimes(1); await current.dispose();
    expect(f.disconnected).toHaveBeenCalledTimes(2);
  });
  it('should rejoin the retained resource after an authoritative schema migration and consume the acknowledged pending draft', async () => {
    const f = fixture(); const oldInput = f.input(); const old = await f.provider.openLiveSession(oldInput);
    const text = f.registry.resolveBinding([...f.records.values()][0], old.identity).text;
    await old.dispose(); f.facts.schemaEpoch = '3'; f.facts.profileId = 'full@2';
    f.resource.document.getMap('meta').set('schemaEpoch', '3');
    await expect(f.provider.openLiveSession(oldInput)).rejects.toMatchObject({ code: 'incompatible-schema' });
    await f.provider.prepareDraftRecovery(f.input(), 'capture-1', 'client-upgrade');
    await f.provider.acknowledgeDraftRecovery(f.input(), 'capture-1');
    const current = await f.provider.openLiveSession(f.input());
    expect((await f.provider.resolveBinding(current.identity)).text).toBe(text);
    expect(f.pending.size).toBe(0); expect(f.drafts.size).toBe(1);
    await current.dispose(); f.facts.schemaEpoch = '4';
    await expect(f.provider.openLiveSession(f.input())).resolves.toMatchObject({ kind: 'live-session' });
  });
  it('should cascade admission closure to every binding and subscriber while leaving another actor live', async () => {
    const f = fixture(); const a = await f.provider.openLiveSession(f.input()); const record = [...f.records.values()][0];
    const updates = vi.fn(); await f.provider.subscribeActors(a.identity, updates);
    f.use('b', 'agent'); const b = await f.provider.openLiveSession(f.input());
    f.use('a'); await f.authority.close(record);
    await expect(f.provider.resolveBinding(a.identity)).rejects.toMatchObject({ code: 'revoked' });
    expect(() => f.registry.open(record, 'notes')).toThrow('revoked');
    expect(() => f.registry.subscribeActors(record, vi.fn())).toThrow('revoked');
    const count = updates.mock.calls.length;
    f.use('b', 'agent'); expect((await f.provider.resolveBinding(b.identity)).text).toBeDefined();
    await b.dispose(); expect(updates).toHaveBeenCalledTimes(count);
    expect(f.disconnected).toHaveBeenCalledTimes(1); await a.dispose();
  });
  it('should reject a different actor kind reusing an existing host actor id without corrupting the admission', async () => {
    const f = fixture(); await f.provider.openLiveSession(f.input()); const before = structuredClone([...f.records.values()]);
    f.use('a', 'agent'); await expect(f.provider.openLiveSession(f.input())).rejects.toMatchObject({ code: 'actor-denied' });
    await expect(f.provider.openLiveSession({ ...f.input(), schemaEpoch: '1' })).rejects.toMatchObject({ code: 'actor-denied' });
    expect(f.drafts.size).toBe(0); expect(f.pending.size).toBe(0);
    expect([...f.records.values()]).toEqual(before);
  });
});
