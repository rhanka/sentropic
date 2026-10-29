import { describe, expect, it } from 'vitest';
import { AdmissionAuthority, type AdmissionRecord } from '../../src/services/canvas-live/admission';

export function admissionFixture() {
  const actor = { actorId: 'human-a', kind: 'human' as const, displayLabel: 'Alice', color: '#123456' };
  const principal = { tenantId: 'tenant-a', workspaceId: 'workspace-a', actor };
  const document = { documentId: 'canvas:a', sessionId: 'session-a', profileId: 'full@1', schemaEpoch: '2', fields: ['description', 'notes'] };
  let grant = { ...principal, documentId: document.documentId, fields: document.fields, operations: ['read', 'edit'] };
  const records = new Map<string, AdmissionRecord>();
  let epoch = 0;
  const ports = {
    authenticate: async () => structuredClone(principal),
    authorize: async () => structuredClone(grant),
    document: async () => structuredClone(document),
    // The durable adapter must implement this atomically; fixture callbacks are synchronous.
    update: async (key: string, change: (old?: AdmissionRecord) => AdmissionRecord) => {
      const value = change(records.get(key)); records.set(key, structuredClone(value)); return structuredClone(value);
    },
    epoch: () => `admission-${++epoch}`,
  };
  const authority = new AdmissionAuthority(ports);
  const input = { binding: { documentId: document.documentId, fieldKey: 'description' }, actor, profileId: document.profileId, schemaEpoch: document.schemaEpoch };
  return { authority, ports, principal, document, input, records, setGrant: (value: typeof grant) => { grant = value; }, get grant() { return grant; } };
}

describe('canvas live admission', () => {
  it('should retain the admission epoch across reconnect and service restart, rotating only after close', async () => {
    const f = admissionFixture();
    const first = await f.authority.open(f.input);
    expect((await new AdmissionAuthority(f.ports).open(f.input)).sessionEpoch).toBe(first.sessionEpoch);
    await f.authority.close(first);
    expect((await f.authority.open(f.input)).sessionEpoch).not.toBe(first.sessionEpoch);
    expect(first.sessionEpoch).not.toBe(f.document.schemaEpoch);
  });
  it.each(['tenantId', 'workspaceId', 'documentId'] as const)('should deny a foreign %s grant before admission', async (key) => {
    const f = admissionFixture(); f.setGrant({ ...f.grant, [key]: 'foreign' });
    await expect(f.authority.open(f.input)).rejects.toMatchObject({ code: 'scope-denied' });
    expect(f.records.size).toBe(0);
  });
  it('should deny a forged actor and field outside the current grant', async () => {
    const f = admissionFixture();
    await expect(f.authority.open({ ...f.input, actor: { ...f.input.actor, actorId: 'agent-forged', kind: 'agent' } })).rejects.toMatchObject({ code: 'actor-denied' });
    f.setGrant({ ...f.grant, fields: ['notes'] });
    await expect(f.authority.open(f.input)).rejects.toMatchObject({ code: 'scope-denied' });
  });
  it('should allow viewers to read while denying edit, including after a rights downgrade', async () => {
    const f = admissionFixture(); const editor = await f.authority.open(f.input);
    f.setGrant({ ...f.grant, operations: ['read'] });
    await expect(f.authority.check(editor, 'description', 'edit')).rejects.toMatchObject({ code: 'scope-denied' });
    const viewer = await f.authority.open(f.input);
    await expect(f.authority.check(viewer, 'description', 'read')).resolves.toBeDefined();
    await expect(f.authority.check(viewer, 'description', 'edit')).rejects.toMatchObject({ code: 'scope-denied' });
  });
  it('should deny cross-field operations and closed or revoked admissions on the next operation', async () => {
    const f = admissionFixture(); f.setGrant({ ...f.grant, fields: ['description'] });
    const record = await f.authority.open(f.input);
    await expect(f.authority.check(record, 'notes', 'edit')).rejects.toMatchObject({ code: 'scope-denied' });
    await f.authority.close(record);
    await expect(f.authority.check(record, 'description', 'edit')).rejects.toMatchObject({ code: 'revoked' });
    const fresh = await f.authority.open(f.input);
    f.setGrant({ ...f.grant, operations: [] });
    await expect(f.authority.check(fresh, 'description', 'read')).rejects.toMatchObject({ code: 'scope-denied' });
  });
  it.each([{ profileId: 'old@1' }, { schemaEpoch: '1' }, { schemaEpoch: '3' }])('should refuse incompatible facts %j before admission', async (facts) => {
    const f = admissionFixture();
    await expect(f.authority.open({ ...f.input, ...facts })).rejects.toMatchObject({ code: 'incompatible-schema' });
    expect(f.records.size).toBe(0);
  });
});
