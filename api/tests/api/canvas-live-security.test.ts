import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { FRAME_CAP } from '../../src/services/canvas-live/sync-framing';
import {
  admissionRecord, contextFor, docOf, deltaFrom, framesOf, hostFixture, registryFixture,
} from '../helpers/canvas-live-h3';

const hostileEdits: [label: string, edit: (client: Y.Doc) => void][] = [
  ['reserved meta write', (client) => client.getMap('meta').set('schemaEpoch', '3')],
  ['foreign field', (client) => client.getText('field:other').insert(0, 'x')],
  ['foreign meta map', (client) => client.getMap('fieldmeta:notes').set('k', 1)],
  ['unsupported mark', (client) => client.getText('field:notes').format(0, 3, { underline: true })],
  ['unsupported embed', (client) => client.getText('field:notes').insert(0, { type: 'image' } as unknown as string)],
];

describe('canvas live hostile ingress', () => {
  it.each(hostileEdits)('should leave authoritative content and vector untouched for %s', async (_label, edit) => {
    const record = admissionRecord(['notes']);
    const { registry } = registryFixture();
    const handle = registry.open(record, 'notes');
    const { host, applied, refusals } = hostFixture({ record, registry });
    const authoritative = docOf(registry, record, 'notes');
    authoritative.getText('field:notes').insert(0, 'authoritative');
    const vectorBefore = Y.encodeStateVector(authoritative);
    const bytes = deltaFrom(authoritative, edit);
    const result = await host.handleUpdate(contextFor(record), handle.identity, framesOf(bytes));
    expect(result.applied).toBe(false);
    expect(applied).toHaveLength(0);
    expect(authoritative.getText('field:notes').toString()).toBe('authoritative');
    expect(Buffer.from(Y.encodeStateVector(authoritative)).equals(Buffer.from(vectorBefore))).toBe(true);
    expect(refusals.length).toBeGreaterThan(0);
    await handle.dispose();
  });

  it('should close the connection after repeated hostile updates', async () => {
    const record = admissionRecord(['notes']);
    const { registry } = registryFixture();
    const handle = registry.open(record, 'notes');
    const { host, applied } = hostFixture({ record, registry });
    const authoritative = docOf(registry, record, 'notes');
    const hostile = () => deltaFrom(authoritative, (client) => client.getMap('meta').set('schemaEpoch', '3'));
    const ctx = contextFor(record);
    expect((await host.handleUpdate(ctx, handle.identity, framesOf(hostile()))).closed).toBe(false);
    expect((await host.handleUpdate(ctx, handle.identity, framesOf(hostile()))).closed).toBe(true);
    expect((await host.handleUpdate(ctx, handle.identity, framesOf(hostile()))).applied).toBe(false);
    expect(applied).toHaveLength(0);
    await handle.dispose();
  });

  it('should refuse oversize frames without applying or closing before the hostile threshold', async () => {
    const record = admissionRecord(['notes']);
    const { registry } = registryFixture();
    const handle = registry.open(record, 'notes');
    const { host, applied, refusals } = hostFixture({ record, registry });
    const oversize = new Uint8Array(FRAME_CAP + 1);
    const result = await host.handleUpdate(contextFor(record), handle.identity, [oversize]);
    expect(result.applied).toBe(false);
    expect(refusals.at(-1)?.refusal).toBe('frame-too-large');
    expect(applied).toHaveLength(0);
    await handle.dispose();
  });

  it('should refuse a hostile reconnect replay and accept an applied replay without duplication (vii)', async () => {
    const record = admissionRecord(['notes']);
    const { registry } = registryFixture();
    const handle = registry.open(record, 'notes');
    const { host, applied, refusals } = hostFixture({ record, registry });
    const authoritative = docOf(registry, record, 'notes');
    const legitimate = deltaFrom(authoritative, (client) => client.getText('field:notes').insert(0, 'kept'));
    expect((await host.handleUpdate(contextFor(record), handle.identity, framesOf(legitimate))).applied).toBe(true);
    const vectorBefore = Y.encodeStateVector(authoritative);
    const hostile = deltaFrom(authoritative, (client) => client.getMap('meta').set('schemaEpoch', '3'));
    const replay = await host.handleUpdate(contextFor(record), handle.identity, framesOf(hostile));
    expect(replay.applied).toBe(false);
    expect(refusals.at(-1)?.refusal).toBe('reserved-meta');
    // Reconnect replay of already-acknowledged bytes: re-validated and re-admitted as a
    // harmless duplicate (H2 duplicate-replay rule); state and vector stay unchanged.
    const acknowledged = await host.handleUpdate(contextFor(record), handle.identity, framesOf(legitimate));
    expect(acknowledged.applied).toBe(true);
    expect(authoritative.getText('field:notes').toString()).toBe('kept');
    expect(Buffer.from(Y.encodeStateVector(authoritative)).equals(Buffer.from(vectorBefore))).toBe(true);
    expect(applied).toHaveLength(2);
    await handle.dispose();
  });

  it('should frame, validate and apply a legitimate catch-up above the 256 KiB MCP cap whole', async () => {
    const record = admissionRecord(['notes']);
    const { registry } = registryFixture();
    const handle = registry.open(record, 'notes');
    const { host, applied } = hostFixture({ record, registry });
    const authoritative = docOf(registry, record, 'notes');
    const payload = 'x'.repeat(300 * 1024);
    const bytes = deltaFrom(authoritative, (client) => client.getText('field:notes').insert(0, payload));
    expect(bytes.byteLength).toBeGreaterThan(256 * 1024);
    const result = await host.handleUpdate(contextFor(record), handle.identity, framesOf(bytes));
    expect(result.applied).toBe(true);
    expect(authoritative.getText('field:notes').toString()).toBe(payload);
    expect(applied).toHaveLength(1);
    await handle.dispose();
  });
});
