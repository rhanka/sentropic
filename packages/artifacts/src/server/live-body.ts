import { ArtifactOperationError } from './failures.js';

export function isLiveBodyStream(value: unknown): value is AsyncIterable<Uint8Array> {
  return value !== null && typeof value === 'object' && Symbol.asyncIterator in value &&
    typeof (value as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] === 'function';
}
/** Count decompressed wire bytes before allocation/parse; host adapters may pass the request stream. */
export async function readBoundedLiveJson(body: AsyncIterable<Uint8Array>, operation: string): Promise<Record<string, unknown>> {
  const maximum = (operation === 'git_commit' ? 64 : 16) * 1024 * 1024;
  const chunks: Uint8Array[] = []; let size = 0;
  for await (const chunk of body) {
    if (!(chunk instanceof Uint8Array)) throw new ArtifactOperationError('invalid_request');
    size += chunk.byteLength;
    if (size > maximum) throw new ArtifactOperationError('limit_exceeded');
    chunks.push(chunk.slice());
  }
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks)));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required');
    return value as Record<string, unknown>;
  } catch { throw new ArtifactOperationError('invalid_request'); }
}
