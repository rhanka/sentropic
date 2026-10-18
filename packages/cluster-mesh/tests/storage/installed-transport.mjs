import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { COMMAND_CAPABILITIES, hashRecord, commandPayloadDigest, commandIdempotencyKey } from '@sentropic/comments';
import { commentsAdmissibleManifestDigest, commentsUnitPayloadDigest, commentsImportBindingDigest, createCommentsFragment } from '@sentropic/cluster-mesh/comments';
import { conformanceResource } from './installed-oracle.mjs';

export const qualifyInstalledTransport = async (installedHost, grantFor) => {
  const source = await installedHost(); const destination = await installedHost();
  try {
    const records = []; let previous = null; let boundary; const chunks = []; let terminal;
    await source.module.withContext(source.grant, async () => {
      for (let index = 0; index < 28; index++) {
        const record = source.annotation('long', previous, `${index}:${'🦊"\\'.repeat(7000)}`);
        await source.module.store.appendAnnotationRevision(source.scope, 'long', record, previous ? { kind: 'revision', revisionHash: previous.hash } : { kind: 'creation', aggregateVersion: 0 });
        records.push(record); previous = record;
      }
      const selection = { scope: source.scope, exportId: 'long-unit', selections: [{ kind: 'annotation-revisions', annotationId: 'long' }] };
      let prep = await source.module.services.prepareExportBoundary(selection);
      for (let step = 0; prep.state !== 'prepared' && step < 100; step++) prep = await source.module.services.prepareExportBoundary(selection, prep.continuation);
      assert.equal(prep.state, 'prepared'); boundary = prep.boundary;
      let cursor = null; const seen = new Set(); let count = 0;
      do {
        assert.ok(count++ < 100, 'bounded export must advance');
        const page = await source.module.services.readExportFragments(boundary.request, cursor, 1);
        assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 1048576);
        for (const fragment of page.fragments) {
          if (fragment.manifest.terminal) terminal = fragment.manifest.terminal;
          else chunks.push(fragment.payload);
        }
        cursor = page.nextCursor;
        if (cursor !== null) { assert.ok(!seen.has(cursor)); seen.add(cursor); }
      } while (cursor !== null);
    });
    const encodedBytes = Buffer.byteLength(JSON.stringify(records)); assert.ok(encodedBytes > 1048576);
    assert.ok(chunks.length > 2); assert.deepEqual(chunks.flat(), records);
    assert.equal(terminal.unitRoots[0].records, '28');
    const units = [{ unitId: 'long-unit', unitKind: 'annotation', dependsOnUnitIds: [], manifestDigest: commandPayloadDigest({ unitId: 'long-unit' }), payloadDigest: commentsUnitPayloadDigest('long-unit', records) }];
    const envelope = { scope: destination.scope, importId: 'installed-manifest', sourceUnitCount: 1, admissibleManifestDigest: commentsAdmissibleManifestDigest(units), mappingVersion: 'mapping-v1' };
    const request = { scope: destination.scope, batchId: 'installed-batch', manifest: { kind: 'import-manifest', ...envelope, hash: hashRecord('import-manifest', envelope) }, units, expectedMappingVersion: 'mapping-v1', idempotencyKey: commandIdempotencyKey('installed-import') };
    const binding = { version: 'comments-transport-v1', operationId: 'installed-import', request, unitIds: ['long-unit'], sourceBoundary: boundary.boundaryDigest, targets: [conformanceResource(destination.scope)], capabilities: COMMAND_CAPABILITIES };
    const bindingDigest = commentsImportBindingDigest(binding); let ordinal = 0; let predecessorHash = null; let prepared; let interactiveMs;
    await destination.module.withContext(destination.grant, async () => {
      for (const chunk of chunks) {
        const fragment = createCommentsFragment({ scope: destination.scope, operationId: binding.operationId, bindingDigest, unitId: 'long-unit', ordinal: String(ordinal++), predecessorHash, terminal: null }, chunk);
        const acknowledgement = await destination.module.services.prepareImportFragment({ binding, fragment, fence: destination.fence });
        assert.deepEqual(await destination.module.services.prepareImportFragment({ binding, fragment, fence: destination.fence }), acknowledgement);
        predecessorHash = fragment.digest;
      }
      assert.equal(await destination.module.store.getAnnotationHead(destination.scope, 'long'), null);
      const progress = await destination.module.services.inspectPreparedImport({ scope: destination.scope, operationId: binding.operationId, bindingDigest });
      assert.equal(progress.prepared, null);
      const started = performance.now();
      await destination.module.store.appendAnnotationRevision(destination.scope, 'interactive', destination.annotation('interactive'), { kind: 'creation', aggregateVersion: 0 });
      interactiveMs = performance.now() - started;
      const fragment = createCommentsFragment({ scope: destination.scope, operationId: binding.operationId, bindingDigest, unitId: null, ordinal: String(ordinal), predecessorHash, terminal: { fragmentCount: String(ordinal + 1), unitRoots: terminal.unitRoots } }, []);
      prepared = (await destination.module.services.prepareImportFragment({ binding, fragment, fence: destination.fence })).prepared;
    });
    let receipt; let steps = 0; const limits = { maxRecords: 64, maxAppends: 16, maxEncodedBytes: 524288 };
    for (; steps < 200; steps++) {
      const reopened = await destination.restart();
      const result = await reopened.withContext(destination.grant, () => reopened.services.commitPreparedImport({ request, prepared, fence: destination.fence, limits }));
      if (result.state === 'committed') { receipt = result.receipt; break; }
      assert.ok(result.work.items <= limits.maxRecords && result.work.bytes <= limits.maxEncodedBytes);
    }
    assert.ok(receipt); assert.deepEqual(receipt.units, terminal.unitRoots);
    const reopened = await destination.restart();
    const reader = grantFor(destination.scope, { operations: ['read'] }); await destination.root.bindNew(reader);
    await reopened.withContext(reader, async () => {
      assert.deepEqual(await reopened.store.getAnnotationChain(destination.scope, 'long'), records);
      assert.deepEqual(await reopened.services.recoverBatchReceipts({ scope: destination.scope, batchId: request.batchId, manifestHash: request.manifest.hash }), [receipt]);
    });
    assert.equal((await destination.bound.journalRead(0, 100)).events.length, 2);
    destination.authority.allowed = false;
    await assert.rejects(reopened.withContext(reader, () => reopened.services.recoverBatchReceipts({ scope: destination.scope, batchId: request.batchId, manifestHash: request.manifest.hash })), (error) => error.code === 'denied');
    await destination.root.revoke(reader.token);
    await assert.rejects(reopened.withContext(reader, () => reopened.store.getAnnotationHead(destination.scope, 'long')), (error) => error.code === 'denied');
    return { encodedBytes, fragments: chunks.length, boundedSealSteps: steps + 1, hiddenBeforeTerminal: 'pass', wholeHistoryAndTerminal: 'pass', responseLossRecovery: 'pass', readOnlyRecovery: 'pass', currentAuthorityAndRevocation: 'pass', interactiveMs, source: source.metrics(), destination: destination.metrics() };
  } finally { await source.close(); await destination.close(); }
};
