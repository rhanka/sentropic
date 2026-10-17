import { canonicalJson, sha256Hex } from '@sentropic/comments';
import type { CanonicalChainRecord } from '@sentropic/comments';
import { isDecimalCounter, validateStorageScope } from '../storage/contracts.js';
import { own, validateRecordHash } from './storage-schema.js';
import { COMMENTS_TRANSPORT_LIMITS as limits, COMMENTS_TRANSPORT_VERSION, CommentsTransportError, type CommentsFragment, type CommentsFragmentManifest } from './transport-contracts.js';
export const commentsTransportBytes = (value: unknown): number => Buffer.byteLength(canonicalJson(value), 'utf8');
const fail = (message: string): never => { throw new CommentsTransportError('invalid-request', message); };
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256 && !value.includes('\0');
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const commentsFragmentDigest = (manifest: CommentsFragmentManifest, payload: readonly CanonicalChainRecord[]): string => sha256Hex(canonicalJson(['comments-fragment', 'v1', manifest, payload]));
export const commentsUnitPayloadDigest = (unitId: string, records: readonly CanonicalChainRecord[]): string => sha256Hex(canonicalJson(['comments-unit-payload', 'v1', unitId, records.map((record) => [record.kind, record.hash])]));
export const validateCommentsFragment = (fragment: CommentsFragment): void => {
  if (!fragment || fragment.version !== COMMENTS_TRANSPORT_VERSION || !fragment.manifest || !Array.isArray(fragment.payload)) fail('invalid comments fragment envelope');
  const manifest = fragment.manifest;
  if (commentsTransportBytes(manifest) > limits.manifestBytes) throw new CommentsTransportError('capacity-exceeded', 'Fragment manifest exceeds its byte limit');
  if (commentsTransportBytes(fragment.payload) > limits.payloadBytes) throw new CommentsTransportError('capacity-exceeded', 'Fragment payload exceeds its byte limit');
  if (commentsTransportBytes(fragment) > limits.requestBytes) throw new CommentsTransportError('capacity-exceeded', 'Fragment envelope exceeds its byte limit');
  if (!validateStorageScope(manifest.scope).ok || !id(manifest.operationId) || !hash(manifest.bindingDigest) || !isDecimalCounter(manifest.ordinal) ||
    (manifest.ordinal === '0' ? manifest.predecessorHash !== null : !hash(manifest.predecessorHash))) fail('invalid fragment identity or frontier');
  if (fragment.payload.length > limits.requestItems) throw new CommentsTransportError('capacity-exceeded', 'Fragment item limit exceeded');
  if (manifest.terminal === null) {
    if (!id(manifest.unitId) || fragment.payload.length === 0) fail('data fragment requires a unit and complete records');
  } else {
    const terminal = manifest.terminal;
    if (!terminal || typeof terminal !== 'object') return fail('invalid terminal fragment declaration');
    if (manifest.unitId !== null || fragment.payload.length !== 0 || terminal.fragmentCount !== String(BigInt(manifest.ordinal) + 1n) || !Array.isArray(terminal.unitRoots) ||
      terminal.unitRoots.length < 1 || terminal.unitRoots.length > limits.requestItems || new Set(terminal.unitRoots.map((unit) => unit.unitId)).size !== terminal.unitRoots.length ||
      terminal.unitRoots.some((unit) => !id(unit.unitId) || !isDecimalCounter(unit.records) || !hash(unit.payloadDigest))) fail('invalid terminal fragment declaration');
  }
  if (!hash(fragment.digest) || commentsFragmentDigest(manifest, fragment.payload) !== fragment.digest) fail('fragment digest mismatch');
  for (const record of fragment.payload) validateRecordHash(record);
};
export const createCommentsFragment = (manifest: CommentsFragmentManifest, payload: readonly CanonicalChainRecord[]): CommentsFragment => {
  const owned = own({ manifest, payload });
  const fragment = { version: COMMENTS_TRANSPORT_VERSION, ...owned, digest: commentsFragmentDigest(owned.manifest, owned.payload) };
  validateCommentsFragment(fragment); return fragment;
};
