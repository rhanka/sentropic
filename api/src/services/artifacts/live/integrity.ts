import { createHash, timingSafeEqual } from 'node:crypto';
import { LiveError } from './records';

export const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
export interface IntegrityPin { path: string; url: string; version: string; integrity: string }
/** Cache evidence of one GB1-qualified commit (`integrityEvidence`): the exact lock, the qualification file digest and
 * the complete remote inventory, each pin covered by literal lockfile SRI or the host-sealed map before any fetch. */
export interface IntegrityEvidence { lockSha256: string; digest: string; inventory: readonly IntegrityPin[] }
function fail(code = 'dependency_integrity_missing'): never { throw new LiveError(code); }
const safe = (path: unknown): path is string => typeof path === 'string' && path.length <= 1024 && !path.startsWith('/') && !path.includes('\\')
  && !path.includes('\0') && path.split('/').every(p => p && p !== '.' && p !== '..');
export function verifySri(bytes: Uint8Array, sri: string) {
  const match = /^(sha256|sha384|sha512)-([A-Za-z0-9+/]+={0,2})$/.exec(sri);
  if (!match) fail();
  const expected = Buffer.from(match[2], 'base64');
  const actual = createHash(match[1]).update(bytes).digest();
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) fail('dependency_integrity_mismatch');
}
export const safeDependencyPath = safe;
