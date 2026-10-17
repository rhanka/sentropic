import { SHA256 } from '@stablelib/sha256';
import { StorageUnavailableError } from '../errors.js';

/** Versioned serialization of the library's documented save/restore API.
 * This is hashing state, not a cryptographic implementation or a new codec. */
export interface PortableDigestState {
  readonly version: 'sha256-state-v1';
  readonly implementation: '@stablelib/sha256@2.0.1';
  readonly words: readonly number[];
  readonly remainder: string | null;
  readonly bufferLength: number;
  readonly bytesHashed: number;
}
const corrupt = (): never => { throw new StorageUnavailableError('corrupt or unsupported persisted digest state'); };
const save = (hash: SHA256): PortableDigestState => {
  const state = hash.saveState();
  const saved: PortableDigestState = Object.freeze({
    version: 'sha256-state-v1', implementation: '@stablelib/sha256@2.0.1', words: Object.freeze(Array.from(state.state)),
    // Persist only the active remainder, never stale bytes in the library's
    // larger scratch buffer.
    remainder: state.bufferLength === 0 ? null : Buffer.from(state.buffer!.subarray(0, state.bufferLength)).toString('base64'),
    bufferLength: state.bufferLength, bytesHashed: state.bytesHashed,
  });
  hash.cleanSavedState(state); hash.clean();
  return saved;
};
const restore = (state: PortableDigestState): SHA256 => {
  if (!state || state.version !== 'sha256-state-v1' || state.implementation !== '@stablelib/sha256@2.0.1' ||
    !Array.isArray(state.words) || state.words.length !== 8 || !state.words.every((word) => Number.isInteger(word) && word >= -2147483648 && word <= 2147483647) ||
    !Number.isSafeInteger(state.bytesHashed) || state.bytesHashed < 0 || !Number.isSafeInteger(state.bufferLength) ||
    state.bufferLength < 0 || state.bufferLength >= 64 || state.bufferLength !== state.bytesHashed % 64) return corrupt();
  const remainder = state.remainder === null ? Buffer.alloc(0) : typeof state.remainder === 'string' ? Buffer.from(state.remainder, 'base64') : corrupt();
  if (remainder.length !== state.bufferLength || (state.remainder !== null && remainder.toString('base64') !== state.remainder) ||
    (state.bufferLength === 0 && state.remainder !== null)) return corrupt();
  return new SHA256().restoreState({ state: Int32Array.from(state.words), buffer: remainder.length > 0 ? remainder : undefined,
    bufferLength: state.bufferLength, bytesHashed: state.bytesHashed,
  });
};
export const startPortableDigest = (): PortableDigestState => save(new SHA256());
export const updatePortableDigest = (state: PortableDigestState, bytes: Uint8Array): PortableDigestState => {
  if (!Number.isSafeInteger(state.bytesHashed + bytes.length)) return corrupt();
  return save(restore(state).update(bytes));
};
export const finishPortableDigest = (state: PortableDigestState): string => {
  const hash = restore(state);
  try { return Buffer.from(hash.digest()).toString('hex'); } finally { hash.clean(); }
};
