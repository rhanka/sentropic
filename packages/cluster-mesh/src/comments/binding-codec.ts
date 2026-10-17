import { canonicalJson, sha256Hex, isCommandCapability, isResourceRef } from '@sentropic/comments';
import type { CanonicalImportUnit } from '@sentropic/comments';
import { sameScope, validateRecordHash } from './storage-schema.js';
import { commentsTransportBytes } from './fragment-codec.js';
import { COMMENTS_TRANSPORT_LIMITS as limits, COMMENTS_TRANSPORT_VERSION, CommentsTransportError, type CommentsImportBinding } from './transport-contracts.js';
const fail = (message: string): never => { throw new CommentsTransportError('invalid-request', message); };
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256 && !value.includes('\0');
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const commentsAdmissibleManifestDigest = (units: readonly CanonicalImportUnit[]): string => sha256Hex(canonicalJson(['comments-admissible-manifest', 'v1',
  [...units].sort((a, b) => a.unitId < b.unitId ? -1 : a.unitId > b.unitId ? 1 : 0).map((unit) => [unit.unitId, unit.unitKind, [...unit.dependsOnUnitIds].sort(), unit.manifestDigest, unit.payloadDigest]),
]));
export const commentsImportBindingDigest = (binding: CommentsImportBinding): string => sha256Hex(canonicalJson(['comments-import-binding', 'v1', binding]));
export const validateCommentsImportBinding = (binding: CommentsImportBinding): void => {
  if (!binding || binding.version !== COMMENTS_TRANSPORT_VERSION || !id(binding.operationId) || !binding.request || !Array.isArray(binding.unitIds) || !Array.isArray(binding.targets) || !Array.isArray(binding.capabilities)) fail('invalid import binding');
  const request = binding.request;
  if (!id(request.batchId) || !id(request.idempotencyKey) || !Array.isArray(request.units) || !request.manifest || request.manifest.kind !== 'import-manifest' ||
    !sameScope(request.scope, request.manifest.scope) || !id(request.manifest.importId) || !id(request.expectedMappingVersion) || request.expectedMappingVersion !== request.manifest.mappingVersion ||
    typeof binding.sourceBoundary !== 'string' || !binding.sourceBoundary || binding.sourceBoundary.length > 4096) fail('import manifest or mapping binding differs');
  if (request.units.length > limits.requestItems || binding.unitIds.length < 1 || binding.unitIds.length > limits.requestItems ||
    commentsTransportBytes({ manifest: request.manifest, units: request.units }) > limits.batchManifestBytes ||
    commentsTransportBytes({ operationId: binding.operationId, unitIds: binding.unitIds, sourceBoundary: binding.sourceBoundary, targets: binding.targets, capabilities: binding.capabilities }) > limits.manifestBytes ||
    commentsTransportBytes(binding) > limits.requestBytes) throw new CommentsTransportError('capacity-exceeded', 'Import binding exceeds its declared metadata limits');
  const known = new Set(request.units.map((unit) => unit.unitId));
  if (known.size !== request.units.length || request.manifest.sourceUnitCount !== request.units.length || new Set(binding.unitIds).size !== binding.unitIds.length || binding.unitIds.some((unit) => !known.has(unit))) fail('import unit inventory differs');
  for (const unit of request.units) {
    if (!id(unit.unitId) || !['annotation', 'discussion', 'review'].includes(unit.unitKind) || !hash(unit.manifestDigest) || !hash(unit.payloadDigest) ||
      !Array.isArray(unit.dependsOnUnitIds) || new Set(unit.dependsOnUnitIds).size !== unit.dependsOnUnitIds.length || unit.dependsOnUnitIds.some((dependency) => !known.has(dependency))) fail('invalid declared import unit');
  }
  if (!binding.targets.length || binding.targets.some((target) => !isResourceRef(target) || !sameScope(target.scope, request.scope)) || !binding.capabilities.length ||
    new Set(binding.capabilities).size !== binding.capabilities.length || binding.capabilities.some((capability) => !isCommandCapability(capability))) fail('invalid import domain authorization declaration');
  validateRecordHash(request.manifest);
  if (request.manifest.admissibleManifestDigest !== commentsAdmissibleManifestDigest(request.units)) fail('admissible manifest digest differs');
};
