import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { ArtifactOperationError } from './failures.js';
import type { LiveDraftRecord, LiveEnvelope, LiveIdentity, LiveOverlayEntry } from './live-store.js';

export interface LiveKeyPort {
  /** Host envelope custody returns a per-binding data key, never a worker credential. */
  current(identity: LiveIdentity): Promise<{ version: string; key: Uint8Array }>;
  resolve(identity: LiveIdentity, version: string): Promise<Uint8Array>;
}
export const liveDigest = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
export const liveTextValid = (text: string): boolean => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]|\u0000/.test(text);
export function overlayBytes(overlay: LiveOverlayEntry[]): number {
  const paths = new Set<string>();
  if (overlay.length > 255) throw new ArtifactOperationError('limit_exceeded');
  for (const entry of overlay) {
    if (!entry.path || Buffer.byteLength(entry.path) > 1024 || paths.has(entry.path) ||
      !['100644', '100755'].includes(entry.mode) || (entry.text !== null && !liveTextValid(entry.text))) {
      throw new ArtifactOperationError('invalid_request');
    }
    paths.add(entry.path);
    if (entry.text !== null && Buffer.byteLength(entry.text) > 1024 * 1024) throw new ArtifactOperationError('limit_exceeded');
  }
  const bytes = Buffer.byteLength(JSON.stringify(overlay));
  if (bytes > 8 * 1024 * 1024) throw new ArtifactOperationError('limit_exceeded');
  return bytes;
}
function aad(record: LiveDraftRecord): Buffer {
  return Buffer.from(JSON.stringify([record.storageScopeId, record.artifactId, record.bindingGeneration,
    record.revision, record.baseHeadSha, record.expiresAt, record.digest, record.keyVersion]));
}
export async function encryptLiveDraft(record: LiveDraftRecord, text: string, keys: LiveKeyPort): Promise<LiveEnvelope> {
  const key = await keys.current(record);
  if (key.key.byteLength !== 32 || !key.version) throw new Error('invalid draft key');
  record.keyVersion = key.version;
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key.key, nonce);
  cipher.setAAD(aad(record));
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return { nonce: nonce.toString('base64'), ciphertext: encrypted.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}
export async function decryptLiveDraft(record: LiveDraftRecord, envelope: LiveEnvelope, keys: LiveKeyPort): Promise<LiveOverlayEntry[]> {
  const key = await keys.resolve(record, record.keyVersion!);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.nonce, 'base64'));
  decipher.setAAD(aad(record)); decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const bytes = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]);
  if (liveDigest(bytes) !== record.digest) throw new Error('invalid draft digest');
  const overlay = JSON.parse(bytes.toString('utf8')) as LiveOverlayEntry[];
  if (overlayBytes(overlay) !== record.draftBytes || overlay.length !== record.changedPaths) throw new Error('invalid draft size');
  return overlay;
}
