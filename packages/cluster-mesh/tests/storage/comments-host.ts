import { createAnnotationRevision, hashRecord, commandPayloadDigest, commandIdempotencyKey, COMMAND_CAPABILITIES } from '@sentropic/comments';
import type { CanonicalChainRecord } from '@sentropic/comments';
import { createCommentsModule, createCommentsPostgresRegistration, commentsAdmissibleManifestDigest, commentsImportBindingDigest, createCommentsFragment, commentsUnitPayloadDigest } from '../../src/comments/index.js';
import { createPgFixture } from './pg-fixture.js';
import { grantFor } from './authority-corpus.js';
import { conformanceCapacity, conformanceScope, conformanceResource, conformanceTarget, conformanceBody, conformanceProvenance } from '../../assets/storage/comments/oracle/conformance.mjs';
export const commentsHost = async () => {
  const scope = conformanceScope(); const capacity = conformanceCapacity(); const authority = { allowed: true };
  const options = { capacity, capabilities: { check: async () => authority.allowed }, resolver: { resolve: async () => 'exact' as const }, clock: { now: () => 1717000000123 } };
  const fixture = await createPgFixture(await createCommentsPostgresRegistration({ services: options })); const root = await fixture.open();
  const grant = grantFor({ scope, operations: ['read', 'write', 'maintain'] }); const bound = await root.bindNew(grant);
  const fence = { fenceId: 'comments-import', epoch: '1' }; await root.provisionFence(grant, fence);
  const module = createCommentsModule({ storage: root.adapter(), capacity });
  const annotation = (id: string, previous = null, body = 'content') => createAnnotationRevision(previous, { scope, annotationId: id, primary: conformanceTarget(conformanceResource(scope)), secondary: [], visualAnchors: [], body: conformanceBody(body), provenance: conformanceProvenance() }, capacity);
  return { fixture, root, grant, bound, fence, module, scope, capacity, authority, annotation };
};
export const importRequest = (host: Awaited<ReturnType<typeof commentsHost>>, units: readonly { unitId: string; records: readonly CanonicalChainRecord[] }[]) => {
  const declared = units.map((unit) => ({ unitId: unit.unitId, unitKind: 'annotation' as const, dependsOnUnitIds: [], manifestDigest: commandPayloadDigest({ unitId: unit.unitId }), payloadDigest: commentsUnitPayloadDigest(unit.unitId, unit.records) }));
  const envelope = { scope: host.scope, importId: 'manifest', sourceUnitCount: units.length, admissibleManifestDigest: commentsAdmissibleManifestDigest(declared), mappingVersion: 'mapping-v1' };
  return { scope: host.scope, batchId: 'batch', manifest: { kind: 'import-manifest' as const, ...envelope, hash: hashRecord('import-manifest', envelope) }, units: declared, expectedMappingVersion: 'mapping-v1', idempotencyKey: commandIdempotencyKey('batch-command') };
};
export const prepareImport = async (host: Awaited<ReturnType<typeof commentsHost>>, request: ReturnType<typeof importRequest>, operationId: string, units: readonly { unitId: string; records: readonly CanonicalChainRecord[] }[], chunks?: readonly (readonly CanonicalChainRecord[])[]) => {
  const binding = { version: 'comments-transport-v1' as const, operationId, request, unitIds: units.map((unit) => unit.unitId), sourceBoundary: 'frozen-source', targets: [conformanceResource(host.scope)], capabilities: COMMAND_CAPABILITIES };
  const bindingDigest = commentsImportBindingDigest(binding); let ordinal = 0; let predecessorHash = null;
  const send = async (unitId: string, payload: readonly CanonicalChainRecord[]) => {
    const fragment = createCommentsFragment({ scope: host.scope, operationId, bindingDigest, unitId, ordinal: String(ordinal++), predecessorHash, terminal: null }, payload);
    await host.module.services.prepareImportFragment({ binding, fragment, fence: host.fence }); predecessorHash = fragment.digest;
  };
  if (chunks) for (const chunk of chunks) await send(units[0].unitId, chunk);
  else for (const unit of units) for (const record of unit.records) await send(unit.unitId, [record]);
  const fragment = createCommentsFragment({ scope: host.scope, operationId, bindingDigest, unitId: null, ordinal: String(ordinal), predecessorHash,
    terminal: { fragmentCount: String(ordinal + 1), unitRoots: units.map((unit) => ({ unitId: unit.unitId, records: String(unit.records.length), payloadDigest: commentsUnitPayloadDigest(unit.unitId, unit.records) })) } }, []);
  return (await host.module.services.prepareImportFragment({ binding, fragment, fence: host.fence })).prepared!;
};
export const commitImport = async (host: Awaited<ReturnType<typeof commentsHost>>, request: ReturnType<typeof importRequest>, prepared: Awaited<ReturnType<typeof prepareImport>>) => {
  for (let step = 0; step < 500; step++) {
    const result = await host.module.services.commitPreparedImport({ request, prepared, fence: host.fence, limits: { maxRecords: 16, maxAppends: 2, maxEncodedBytes: 262144 } });
    if (result.state === 'committed') return result.receipt;
    if (result.work.items > 16 || result.work.bytes > 262144) throw new Error('preparation exceeded its work budget');
  }
  throw new Error('import did not advance within the measured fixture work');
};
