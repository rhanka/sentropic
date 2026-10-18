import { describe, expect, it } from 'vitest';
import { createAnnotationRevision, createOperationAuditEvent, commandIdempotencyKey } from '@sentropic/comments';
import { pgEnabled } from './storage/pg-driver.js';
import { commentsHost, importRequest, prepareImport, commitImport } from './storage/comments-host.js';
import { conformanceScope, conformanceTarget, conformanceResource } from '../assets/storage/comments/oracle/conformance.mjs';
describe.skipIf(!pgEnabled)('neutral host copy/move composition using actual comments services', () => {
  it('refuses byte reuse across scopes without any destination publication', async () => {
    const source = await commentsHost(); const destination = await commentsHost({ ...conformanceScope(), workspaceId: 'destination' });
    try {
      const units = [{ unitId: 'unit', records: [source.annotation('a')] }]; const request = importRequest(destination, units);
      await destination.module.withContext(destination.grant, async () => {
        await expect(prepareImport(destination, request, 'foreign-bytes', units)).rejects.toThrow(/scope|denied/i);
        expect(await destination.module.store.getAnnotationHead(destination.scope, 'a')).toBeNull();
      });
      expect((await destination.bound.journalRead(0, 100)).events).toHaveLength(0);
    } finally { await source.fixture.close(); await destination.fixture.close(); }
  });
  it('preserves documentary attribution in a newly hashed derivative and retains source after denied move retirement', async () => {
    const source = await commentsHost(); const destination = await commentsHost({ ...conformanceScope(), workspaceId: 'destination' });
    try {
      const original = source.annotation('a');
      await source.module.withContext(source.grant, () => source.module.store.appendAnnotationRevision(source.scope, 'a', original, { kind: 'creation', aggregateVersion: 0 }));
      const { kind: _kind, hash: _hash, link: _link, ...input } = original;
      const copied = createAnnotationRevision(null, { ...input, scope: destination.scope, annotationId: 'copy-a', primary: conformanceTarget(conformanceResource(destination.scope)),
        provenance: { ...original.provenance, registration: { principal: destination.grant.principalId, registeredAt: 1717000000123 }, importExecution: {
          sourceNamespace: 'comments', sourceRecordId: original.annotationId, sourceVersion: original.hash, sourceDigest: original.hash, parserVersion: 'parser-v1', mappingVersion: 'mapping-v1', conversionVersion: 'conversion-v1', executorService: 'neutral-host', executorRun: 'copy-operation' } } }, destination.capacity);
      const derivation = createOperationAuditEvent([], { scope: destination.scope, subject: 'account-association', subjectId: copied.annotationId, operation: 'copy-derivation', principal: destination.grant.principalId, audience: [destination.grant.principalId],
        detail: { sourceScope: source.scope, sourceId: original.annotationId, sourceHash: original.hash, destinationId: copied.annotationId, destinationHash: copied.hash } }, destination.capacity);
      expect(copied.hash).not.toBe(original.hash); expect(copied.provenance.attribution).toEqual(original.provenance.attribution);
      await destination.module.withContext(destination.grant, async () => {
        const units = [{ unitId: 'copy-unit', records: [copied, derivation] }]; const request = importRequest(destination, units);
        const receipt = await commitImport(destination, request, await prepareImport(destination, request, 'copy-operation', units));
        expect(await destination.module.services.recoverBatchReceipts({ scope: destination.scope, batchId: request.batchId, manifestHash: request.manifest.hash })).toEqual([receipt]);
        expect(await destination.module.store.getAnnotationHead(destination.scope, 'copy-a')).toEqual(copied);
        await expect(destination.module.store.getAnnotationHead(source.scope, 'a')).rejects.toMatchObject({ code: 'denied' });
      });
      source.authority.allowed = false;
      await source.module.withContext(source.grant, async () => {
        await expect(source.module.services.lifecycle({ scope: source.scope, objectKind: 'annotation', objectId: 'a', action: 'tombstone', archiveKind: null, reason: null, decisionRef: '', idempotencyKey: commandIdempotencyKey('move-retirement'), expected: { kind: 'creation', aggregateVersion: 0 } })).rejects.toMatchObject({ code: 'denied' });
        expect(await source.module.store.getAnnotationHead(source.scope, 'a')).toEqual(original);
      });
      expect((await source.bound.journalRead(0, 100)).events).toHaveLength(1);
    } finally { await source.fixture.close(); await destination.fixture.close(); }
  });
});
