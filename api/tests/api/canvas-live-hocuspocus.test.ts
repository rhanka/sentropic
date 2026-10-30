import { describe, expect, it, vi } from 'vitest';
import { AdmissionAuthority } from '../../src/services/canvas-live/admission';
import { SessionRegistry } from '../../src/services/canvas-live/session-registry';
import { HocuspocusHost } from '../../src/services/canvas-live/hocuspocus';
import { classifyStateless } from '../../src/services/canvas-live/ingress';

function admissionRecord() {
  return {
    tenantId: 't', workspaceId: 'w', documentId: 'canvas:a', sessionId: 's',
    sessionEpoch: 'epoch-1', profileId: 'full@1', schemaEpoch: '2',
    fields: ['description', 'notes'], operations: ['read', 'edit'], closed: false,
    actor: { actorId: 'human-a', kind: 'human' as const, displayLabel: 'A', color: '#123456' },
  };
}

function registryFixture() {
  const record = admissionRecord();
  const factory = {
    create: () => {
      const types = new Map<string, unknown>();
      return {
        document: {
          getText: (name: string) => {
            if (!types.has(name)) types.set(name, { value: '' });
            return types.get(name);
          },
          getMap: (name: string) => {
            if (!types.has(name)) types.set(name, new Map());
            return types.get(name) as Map<string, unknown>;
          },
        },
        awareness: { remove: vi.fn() },
        connect: () => () => {},
      };
    },
    clientId: (() => { let id = 0; return () => ++id; })(),
  };
  return { record, registry: new SessionRegistry(factory) };
}

describe('canvas live hocuspocus provider witness', () => {
  it('should resolve by full handle.identity and pass R-BIND-3 two-fields', async () => {
    const { record, registry } = registryFixture();
    const first = registry.open(record, 'description');
    const second = registry.open(record, 'notes');
    expect(registry.resolveBinding(record, first.identity).identity).toBe(first.identity);
    expect(registry.resolveBinding(record, second.identity).identity).toBe(second.identity);
    await first.dispose();
    expect(() => registry.resolveBinding(record, second.identity)).not.toThrow();
    await second.dispose();
  });

  it('should fail closed on missing coordinates and wrong field/document/session', async () => {
    const { record, registry } = registryFixture();
    registry.open(record, 'notes');
    for (const identity of [
      { documentId: record.documentId, sessionId: record.sessionId, fieldKey: '' },
      { documentId: record.documentId, sessionId: record.sessionId, fieldKey: 'other' },
      { documentId: 'other', sessionId: record.sessionId, fieldKey: 'notes' },
      { documentId: record.documentId, sessionId: 'other', fieldKey: 'notes' },
    ]) {
      expect(() => registry.resolveBinding(record, identity)).toThrow();
    }
  });

  it('should validate updates through the pre-apply path before application', async () => {
    const { record, registry } = registryFixture();
    const handle = registry.open(record, 'notes');
    const refusals: { refusal: string }[] = [];
    const host = new HocuspocusHost({
      authenticate: async () => ({ principal: { tenantId: 't', workspaceId: 'w', actorId: 'human-a', actorKind: 'human' }, admission: record }),
      authorizeUpdate: async () => {},
      classifyUpdate: (bytes) => classifyStateless(['field:notes'], ['description', 'notes']),
      applyValidated: async () => {},
      refusals: (entry) => { refusals.push(entry); },
      hostileThreshold: 3,
    });
    const ok = await host.handleUpdate(
      { principal: { tenantId: 't', workspaceId: 'w', actorId: 'human-a', actorKind: 'human' }, admission: record },
      handle.identity,
      [new Uint8Array([1, 2, 3])],
      registry,
    );
    expect(ok).toEqual({ applied: true, closed: false });
    const hostile = new HocuspocusHost({
      authenticate: async () => ({ principal: { tenantId: 't', workspaceId: 'w', actorId: 'human-a', actorKind: 'human' }, admission: record }),
      authorizeUpdate: async () => {},
      classifyUpdate: () => classifyStateless(['meta'], ['description', 'notes'], { metaWrites: ['schemaEpoch'] }),
      applyValidated: async () => { throw new Error('must not apply refused input'); },
      refusals: (entry) => { refusals.push(entry); },
      hostileThreshold: 1,
    });
    const refused = await hostile.handleUpdate(
      { principal: { tenantId: 't', workspaceId: 'w', actorId: 'human-a', actorKind: 'human' }, admission: record },
      handle.identity,
      [new Uint8Array([9])],
      registry,
    );
    expect(refused).toEqual({ applied: false, closed: true });
    expect(refusals.length).toBeGreaterThan(0);
    await handle.dispose();
  });
});
