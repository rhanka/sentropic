import { describe, expect, it, vi } from 'vitest';
import { HocuspocusHost } from '../../src/services/canvas-live/hocuspocus';
import { classifyStateless } from '../../src/services/canvas-live/ingress';
import { SessionRegistry } from '../../src/services/canvas-live/session-registry';
import { FRAME_CAP } from '../../src/services/canvas-live/sync-framing';

function record() {
  return {
    tenantId: 't', workspaceId: 'w', documentId: 'canvas:a', sessionId: 's',
    sessionEpoch: 'epoch-1', profileId: 'full@1', schemaEpoch: '2',
    fields: ['notes'], operations: ['read', 'edit'], closed: false,
    actor: { actorId: 'human-a', kind: 'human' as const, displayLabel: 'A', color: '#123456' },
  };
}

function contextFor(rec: ReturnType<typeof record>) {
  return {
    principal: { tenantId: 't', workspaceId: 'w', actorId: 'human-a', actorKind: 'human' as const },
    admission: rec,
  };
}

describe('canvas live hostile ingress', () => {
  it.each([
    ['reserved meta', ['meta'], { metaWrites: ['schemaEpoch'] }],
    ['foreign field', ['field:other'], {}],
    ['foreign meta map', ['fieldmeta:notes'], {}],
    ['unsupported mark', ['field:notes'], { marks: [{ name: 'underline', value: true }] }],
    ['unsupported embed', ['field:notes'], { embeds: [{ kind: 'image', payload: {} }] }],
  ])('should leave authoritative content, vector and journal untouched for %s', async (_label, types, extra) => {
    const rec = record();
    const applied: unknown[] = [];
    const broadcasts: unknown[] = [];
    const registry = new SessionRegistry({
      create: () => ({
        document: {
          getText: () => ({}),
          getMap: () => new Map() as unknown as { set(k: string, v: unknown): void },
        },
        awareness: { remove: vi.fn() },
        connect: () => () => {},
      }),
      clientId: () => 1,
    });
    registry.open(rec, 'notes');
    const host = new HocuspocusHost({
      authenticate: async () => contextFor(rec),
      authorizeUpdate: async () => {},
      classifyUpdate: (bytes) => classifyStateless(types, ['notes'], extra),
      applyValidated: async (update) => { applied.push(update); broadcasts.push(update); },
      refusals: () => {},
      hostileThreshold: 10,
    });
    const identity = { documentId: rec.documentId, sessionId: rec.sessionId, fieldKey: 'notes' };
    const result = await host.handleUpdate(contextFor(rec), identity, [new Uint8Array([1])], registry);
    expect(result.applied).toBe(false);
    expect(applied).toHaveLength(0);
    expect(broadcasts).toHaveLength(0);
  });

  it('should close the connection after repeated hostile updates and on revoked actors', async () => {
    const rec = record();
    const registry = new SessionRegistry({
      create: () => ({
        document: { getText: () => ({}), getMap: () => new Map() as unknown as { set(k: string, v: unknown): void } },
        awareness: { remove: vi.fn() },
        connect: () => () => {},
      }),
      clientId: () => 1,
    });
    const handle = registry.open(rec, 'notes');
    const host = new HocuspocusHost({
      authenticate: async () => contextFor(rec),
      authorizeUpdate: async () => {},
      classifyUpdate: () => classifyStateless(['meta'], ['notes'], { metaWrites: ['x'] }),
      applyValidated: async () => { throw new Error('must not apply'); },
      refusals: () => {},
      hostileThreshold: 2,
    });
    const ctx = contextFor(rec);
    expect((await host.handleUpdate(ctx, handle.identity, [new Uint8Array([1])], registry)).closed).toBe(false);
    expect((await host.handleUpdate(ctx, handle.identity, [new Uint8Array([1])], registry)).closed).toBe(true);
    const oversize = new Uint8Array(FRAME_CAP + 1);
    expect((await host.handleUpdate(ctx, handle.identity, [oversize], registry)).applied).toBe(false);
    await handle.dispose();
  });
});
