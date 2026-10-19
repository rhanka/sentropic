import { isValidOpaqueRef, isWellFormed, utf8ByteLength } from './contracts.js';
/** M2 candidate IDs preserve opaque Unicode bytes; record IDs use the canonical prefix. */
export function isCandidateId(value: unknown): value is string {
  return typeof value === 'string' && isWellFormed(value) && utf8ByteLength(value) >= 1 && utf8ByteLength(value) <= 512;
}
export function isRecordId(value: unknown): value is string {
  return isValidOpaqueRef(value) && /^mem_[a-z2-7]+$/.test(value);
}
