import { createHash, timingSafeEqual } from 'node:crypto';
import { LiveError } from './records';

export const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
export interface IntegrityPin { path: string; url: string; version: string; integrity: string }
export interface IntegrityEvidence {
  lockSha256: string; digest: string;
  /** A pre-approved host record, authenticated before this port returns it. Never populated by a job download. */
  approved: readonly IntegrityPin[];
  disabledHooks: readonly { path: string; version: string; integrity: string }[];
}
const fail = (code = 'dependency_integrity_missing'): never => { throw new LiveError(code); };
const safe = (path: string) => path.length <= 1024 && !path.startsWith('/') && !path.includes('\\')
  && !path.includes('\0') && path.split('/').every(p => p && p !== '.' && p !== '..');
export function verifySri(bytes: Uint8Array, sri: string) {
  const match = /^(sha256|sha384|sha512)-([A-Za-z0-9+/]+={0,2})$/.exec(sri);
  if (!match) fail();
  const expected = Buffer.from(match[2], 'base64');
  const actual = createHash(match[1]).update(bytes).digest();
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) fail('dependency_integrity_mismatch');
}
export function integrityInventory(lockBytes: Uint8Array, evidence: IntegrityEvidence): IntegrityPin[] {
  if (sha256(lockBytes) !== evidence.lockSha256 || !/^[a-f0-9]{64}$/.test(evidence.digest)) fail();
  let lock: { lockfileVersion: number; packages: Record<string, Record<string, unknown>> };
  try { lock = JSON.parse(Buffer.from(lockBytes).toString('utf8')); } catch { return fail(); }
  if (![2, 3].includes(lock.lockfileVersion) || !lock.packages || !lock.packages['']) fail();
  const workspacePaths = new Set<string>();
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (path && !safe(path)) fail();
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail();
    if (entry.link === true) {
      if (!path.includes('node_modules/') || typeof entry.resolved !== 'string' || !safe(entry.resolved)
        || entry.resolved.split('/').includes('node_modules') || !lock.packages[entry.resolved]) fail();
      workspacePaths.add(entry.resolved);
    }
  }
  const inventory: IntegrityPin[] = [];
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path || entry.link === true || workspacePaths.has(path)) continue;
    if (!path.includes('node_modules/') || typeof entry.resolved !== 'string' || typeof entry.version !== 'string') fail();
    let url: URL;
    try { url = new URL(entry.resolved); } catch { return fail(); }
    if (url.origin !== 'https://registry.npmjs.org' || url.username || url.password || url.search || url.hash) fail();
    const approved = evidence.approved.find(pin => pin.path === path && pin.version === entry.version && pin.url === url.href);
    const integrity = typeof entry.integrity === 'string' && entry.integrity ? entry.integrity : approved?.integrity;
    if (!integrity || !/^(sha256|sha384|sha512)-[A-Za-z0-9+/]+={0,2}$/.test(integrity)) fail();
    if (approved && approved.integrity !== integrity) fail('dependency_integrity_mismatch');
    // G0's exact script-package triple requires literal lockfile integrity even when hooks are disabled.
    if (entry.hasInstallScript && (entry.integrity !== integrity || !evidence.disabledHooks.some(pin =>
      pin.path === path && pin.version === entry.version && pin.integrity === integrity))) fail();
    inventory.push({ path, url: url.href, version: entry.version, integrity });
  }
  return inventory.sort((a, b) => a.path.localeCompare(b.path));
}
export const safeDependencyPath = safe;
