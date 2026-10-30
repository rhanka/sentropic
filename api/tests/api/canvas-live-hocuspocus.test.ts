import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { AdmissionError } from '../../src/services/canvas-live/contracts';
import {
  admissionRecord, contextFor, docOf, deltaFrom, framesOf, hostFixture, registryFixture,
} from '../helpers/canvas-live-h3';

describe('canvas live hocuspocus provider witness', () => {
  it('should resolve by full handle.identity and pass R-BIND-3 two-fields', async () => {
    const record = admissionRecord();
    const { registry } = registryFixture();
    const first = registry.open(record, 'description');
    const second = registry.open(record, 'notes');
    expect(registry.resolveBinding(record, first.identity).identity).toBe(first.identity);
    expect(registry.resolveBinding(record, second.identity).identity).toBe(second.identity);
    await first.dispose();
    expect(() => registry.resolveBinding(record, second.identity)).not.toThrow();
    await second.dispose();
  });

  it('should fail closed on missing coordinates and wrong field/document/session', async () => {
    const record = admissionRecord();
    const { registry } = registryFixture();
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

  it('should apply a validated update through the real pre-apply path and checkpoint it via onStoreDocument', async () => {
    const record = admissionRecord(['notes']);
    const { registry } = registryFixture();
    const handle = registry.open(record, 'notes');
    const checkpoints: { encodedState: string; stateVector: string; journalWatermark: number }[] = [];
    const store = {
      loadDocument: async () => null,
      storeCheckpoint: async (_id: object, checkpoint: { encodedState: string; stateVector: string; journalWatermark: number }) => {
        checkpoints.push(checkpoint);
      },
    };
    const { host, applied } = hostFixture({
      record, registry, store,
      authorizeUpdate: async () => {},
    });
    const authoritative = docOf(registry, record, 'notes');
    const bytes = deltaFrom(authoritative, (client) => client.getText('field:notes').insert(0, 'hello'));
    const result = await host.handleUpdate(contextFor(record), handle.identity, framesOf(bytes));
    expect(result.applied).toBe(true);
    expect(applied).toHaveLength(1);
    expect(authoritative.getText('field:notes').toString()).toBe('hello');
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0].journalWatermark).toBe(1);
    expect(Buffer.from(checkpoints[0].encodedState, 'base64').byteLength).toBeGreaterThan(0);
    await handle.dispose();
  });

  it('should refuse a hostile real update whole without journal entry or broadcast', async () => {
    const record = admissionRecord(['notes']);
    const { registry } = registryFixture();
    const handle = registry.open(record, 'notes');
    const { host, applied, refusals } = hostFixture({ record, registry });
    const authoritative = docOf(registry, record, 'notes');
    const hostile = deltaFrom(authoritative, (client) => client.getMap('meta').set('schemaEpoch', '3'));
    const result = await host.handleUpdate(contextFor(record), handle.identity, framesOf(hostile));
    expect(result.applied).toBe(false);
    expect(applied).toHaveLength(0);
    expect(authoritative.getText('field:notes').toString()).toBe('');
    expect(Y.encodeStateVector(authoritative).byteLength).toBeGreaterThan(0);
    expect(refusals.at(-1)?.refusal).toBe('reserved-meta');
    await handle.dispose();
  });

  it('should close on a revoked actor without applying queued input', async () => {
    const record = admissionRecord(['notes']);
    const { registry } = registryFixture();
    const handle = registry.open(record, 'notes');
    const revoked = { current: false };
    const { host, applied } = hostFixture({
      record, registry,
      authorizeUpdate: async () => {
        if (revoked.current) throw new AdmissionError('revoked');
      },
    });
    const authoritative = docOf(registry, record, 'notes');
    const bytes = deltaFrom(authoritative, (client) => client.getText('field:notes').insert(0, 'first'));
    expect((await host.handleUpdate(contextFor(record), handle.identity, framesOf(bytes))).applied).toBe(true);
    revoked.current = true;
    const queued = deltaFrom(authoritative, (client) => client.getText('field:notes').insert(0, 'queued'));
    const refused = await host.handleUpdate(contextFor(record), handle.identity, framesOf(queued));
    expect(refused).toEqual({ applied: false, closed: true });
    const afterClose = await host.handleUpdate(contextFor(record), handle.identity, framesOf(queued));
    expect(afterClose).toEqual({ applied: false, closed: true });
    expect(applied).toHaveLength(1);
    expect(authoritative.getText('field:notes').toString()).toBe('first');
    await handle.dispose();
  });

  it('should close on a submission for a different document', async () => {
    const record = admissionRecord(['notes']);
    const { registry } = registryFixture();
    const handle = registry.open(record, 'notes');
    const { host, applied } = hostFixture({ record, registry });
    const authoritative = docOf(registry, record, 'notes');
    const bytes = deltaFrom(authoritative, (client) => client.getText('field:notes').insert(0, 'x'));
    const result = await host.handleUpdate(
      contextFor(record),
      { documentId: 'canvas:other', sessionId: record.sessionId, fieldKey: 'notes' },
      framesOf(bytes),
    );
    expect(result).toEqual({ applied: false, closed: true });
    expect(applied).toHaveLength(0);
    await handle.dispose();
  });

  it('should refuse a viewer edit without closing on a single denial', async () => {
    const record = admissionRecord(['notes']);
    const { registry } = registryFixture();
    const handle = registry.open(record, 'notes');
    const { host, applied, refusals } = hostFixture({
      record, registry,
      authorizeUpdate: async () => { throw new AdmissionError('scope-denied'); },
    });
    const authoritative = docOf(registry, record, 'notes');
    const bytes = deltaFrom(authoritative, (client) => client.getText('field:notes').insert(0, 'viewer'));
    const result = await host.handleUpdate(contextFor(record), handle.identity, framesOf(bytes));
    expect(result).toEqual({ applied: false, closed: false });
    expect(applied).toHaveLength(0);
    expect(refusals.at(-1)?.refusal).toBe('scope-denied');
    await handle.dispose();
  });
});
