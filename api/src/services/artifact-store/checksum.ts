import { createHash } from 'node:crypto';

/** Lowercase hex SHA-256 of the given bytes. */
export function sha256Hex(bytes: Uint8Array | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
