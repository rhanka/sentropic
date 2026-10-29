import { describe, expect, it, vi } from 'vitest';
import type { AdmissionRecord } from '../../src/services/canvas-live/admission';
import { SessionRegistry } from '../../src/services/canvas-live/session-registry';
import { AdmissionAuthority } from '../../src/services/canvas-live/admission';
import { DraftRecovery, type PreservedDraft } from '../../src/services/canvas-live/recovery';
import { LiveSessionProvider } from '../../src/services/canvas-live/provider';

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
  it.each([{ fields: [''] }, { fields: ['notes', 'notes'] }, { fields: ['field:notes'] }, { fields: ['description', ''] }])('should reject malformed descriptor fields %j before any shared type is created', ({ fields }) => {
    const f = fixture();
    expect(() => f.registry.open({ ...f.record, fields }, fields[0])).toThrow('invalid-binding');
    expect(f.create).not.toHaveBeenCalled(); expect(f.createdNames).toEqual([]);
  });
  it('should keep notes live when description unmounts, close only after the last mount, and retain state', async () => {
    const f = fixture(); const a = f.registry.open(f.record, 'description'); const b = f.registry.open(f.record, 'notes');
    const notes = f.registry.resolveBinding(f.record, b.identity); const text = notes.text as { value: string };
    text.value = 'remote'; await a.dispose(); await a.dispose();
    expect(f.registry.resolveBinding(f.record, b.identity)).toBe(notes);
    text.value += '+local'; expect(text.value).toBe('remote+local'); expect(f.disconnected).not.toHaveBeenCalled();
    await b.dispose(); expect(f.disconnected).toHaveBeenCalledTimes(1);
    expect(() => f.registry.resolveBinding(f.record, b.identity)).toThrow('revoked');
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
    expect(updates.mock.lastCall![0]).toEqual([]);
    expect(f.removed).toHaveBeenCalled(); expect(f.disconnected).not.toHaveBeenCalled();
    expect(() => f.registry.resolveBinding(f.record, b.identity)).toThrow('invalid-binding');
    expect(() => f.registry.resolveBinding(agent, b.identity)).not.toThrow(); stop();
  });
});

describe('canvas live provider admission composition', () => {
  it.each(['client-upgrade', 'draft-migration'] as const)('should refuse before binding, preserve draft bytes and admit only acknowledged %s recovery', async (branch) => {
    const f = fixture(); const records = new Map<string, AdmissionRecord>(); const drafts = new Map<string, PreservedDraft>(); const pending = new Map<string, string>();
    const facts = { documentId: f.record.documentId, sessionId: f.record.sessionId, fields: f.record.fields, profileId: 'new@1', schemaEpoch: '3' };
    const bytes = new Uint8Array([255, 0, 10, 65]); const authoritativeBefore = structuredClone(facts);
    const ports = { authenticate: async () => f.record, document: async () => facts, authorize: async () => f.record, epoch: () => 'persisted-epoch',
      update: async (key: string, change: (old?: AdmissionRecord) => AdmissionRecord) => { const result = change(records.get(key)); records.set(key, result); return result; },
      captureDraft: vi.fn(async () => ({ draftId: 'draft-b', bytes })),
    };
    const recoveryPorts = {
      update: async (key: string, change: (old?: PreservedDraft) => PreservedDraft) => { const result = change(drafts.get(key)); drafts.set(key, result); return result; },
      pending: async (key: string, id?: string | null, expected?: string) => { if (id === null && pending.get(key) === expected) pending.delete(key); else if (id) pending.set(key, id); return pending.get(key) ?? null; },
      migrate: vi.fn(async (copy: Uint8Array) => new Uint8Array([...copy, 42])),
    };
    const recovery = new DraftRecovery(recoveryPorts); const authority = new AdmissionAuthority(ports);
    const provider = new LiveSessionProvider(authority, f.registry, recovery, ports);
    const old = { binding: { documentId: facts.documentId, fieldKey: 'notes' }, actor: f.record.actor, profileId: 'old@1', schemaEpoch: '2' };
    await expect(provider.openLiveSession(old)).rejects.toMatchObject({ code: 'incompatible-schema' });
    expect(f.create).not.toHaveBeenCalled(); expect([...drafts.values()][0].bytes).toEqual(bytes);
    const upgraded = { ...old, profileId: facts.profileId, schemaEpoch: facts.schemaEpoch };
    await expect(provider.openLiveSession(upgraded)).rejects.toMatchObject({ code: 'incompatible-schema' });
    const prepared = await recovery.prepare(f.record, facts, 'draft-b', branch);
    await expect(provider.openLiveSession(upgraded)).rejects.toMatchObject({ code: 'incompatible-schema' });
    expect(f.create).not.toHaveBeenCalled();
    await recovery.acknowledge(f.record, facts, 'draft-b');
    const reopened = new LiveSessionProvider(new AdmissionAuthority(ports), f.registry, new DraftRecovery(recoveryPorts), ports);
    const handle = await reopened.openLiveSession(upgraded);
    expect(handle.identity).toEqual({ ...upgraded.binding, sessionId: facts.sessionId });
    expect(prepared.bytes).toEqual(bytes); expect(facts).toEqual(authoritativeBefore);
    expect(recoveryPorts.migrate).toHaveBeenCalledTimes(branch === 'draft-migration' ? 1 : 0);
    expect(f.create).toHaveBeenCalledTimes(1); await handle.dispose();
  });
});
