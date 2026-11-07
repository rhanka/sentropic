import { createHash } from 'node:crypto';
import { ArtifactOperationError } from './failures.js';

/** A-LIVE §7.2: host-sealed value for one lock entry; never supplied by the branch or the cache. */
export interface HostIntegrityMapEntry {
  readonly path: string;
  readonly name: string;
  readonly version: string;
  readonly registryUrl: string;
  readonly integrity: string;
}
/** Immutable host map tied to the exact lock bytes; the host authenticates its seal before use. */
export interface HostIntegrityMap {
  readonly lockfileDigest: string;
  readonly entries: readonly HostIntegrityMapEntry[];
}
/** Remote lock entry fields the coverage rule reads; `resolved` is already an approved URL. */
export interface RemoteLockEntry {
  readonly path: string;
  readonly name: string;
  readonly version: string;
  readonly resolved?: string;
  readonly integrity?: unknown;
}
export interface DependencyIntegrityRecord {
  readonly path: string;
  readonly name: string;
  readonly version: string;
  readonly registryUrl: string;
  readonly integrity: string;
  readonly source: 'lockfile' | 'host_map';
}
/** Complete remote-package inventory; `mapDigest` binds the approved map into cache and build receipts. */
export interface DependencyIntegrityInventory {
  readonly mapDigest: string | null;
  readonly lockfileSri: number;
  readonly hostMap: number;
  readonly entries: readonly DependencyIntegrityRecord[];
}

export const sha256Hex = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
/** SHA-256 of the exact lockfile text read at the pinned commit. */
export const lockfileSha256 = (lockText: string): string => sha256Hex(lockText);

const SRI_BYTES: Readonly<Record<string, number>> = { sha256: 32, sha384: 48, sha512: 64 };
/** npm SRI carrying at least one SHA-256-or-stronger digest; SHA-1-only or malformed values never qualify. */
export function approvedIntegrity(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 1024) return false;
  let strong = false;
  for (const token of value.split(' ')) {
    const match = /^(sha1|sha256|sha384|sha512)-([A-Za-z0-9+/]+={0,2})$/.exec(token);
    if (!match) return false;
    const bytes = SRI_BYTES[match[1]];
    if (bytes === undefined) continue;
    if (match[2].length !== Math.ceil(bytes / 3) * 4 || Buffer.from(match[2], 'base64').length !== bytes) return false;
    strong = true;
  }
  return strong;
}

/** Canonical map digest: entries ordered by path, fixed field order. */
export function hostIntegrityMapDigest(map: HostIntegrityMap): string {
  const rows = map.entries.map(entry => [entry.path, entry.name, entry.version, entry.registryUrl, entry.integrity]);
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return sha256Hex(JSON.stringify(['sentropic.integrity-map/v1', map.lockfileDigest, rows]));
}

/**
 * Cover every remote lock entry by literal lockfile SRI or the sealed host map, before any fetch.
 * No trust on first use, no reuse across versions or paths, no SHA-1-only pin, no contradicting value.
 */
export function dependencyIntegrity(
  remote: readonly RemoteLockEntry[], lockfileDigest: string,
  map: HostIntegrityMap | undefined, approvedRegistryUrl: (url: unknown) => boolean,
): DependencyIntegrityInventory {
  const mismatch = (): never => { throw new ArtifactOperationError('dependency_integrity_mismatch'); };
  const mapped = new Map<string, HostIntegrityMapEntry>();
  if (map !== undefined) {
    if (map?.lockfileDigest !== lockfileDigest || !Array.isArray(map.entries)) mismatch();
    const locked = new Map(remote.map(entry => [entry.path, entry]));
    for (const entry of map.entries) {
      const lock = locked.get(entry?.path);
      if (lock === undefined || mapped.has(entry.path) || entry.name !== lock.name || entry.version !== lock.version
        || !approvedRegistryUrl(entry.registryUrl) || !approvedIntegrity(entry.integrity)
        || (lock.resolved !== undefined && lock.resolved !== entry.registryUrl)
        || (approvedIntegrity(lock.integrity) && lock.integrity !== entry.integrity)) mismatch();
      mapped.set(entry.path, entry);
    }
  }
  const entries = remote.map((lock): DependencyIntegrityRecord => {
    const host = mapped.get(lock.path);
    const literal = approvedIntegrity(lock.integrity) ? lock.integrity : undefined;
    if (literal === undefined && host === undefined) throw new ArtifactOperationError('dependency_integrity_missing');
    const registryUrl = lock.resolved ?? host?.registryUrl;
    // A literal pin without a locked URL names no approved registry location.
    if (registryUrl === undefined) throw new ArtifactOperationError('dep_outside_lock');
    const base = { path: lock.path, name: lock.name, version: lock.version, registryUrl };
    return literal !== undefined ? { ...base, integrity: literal, source: 'lockfile' }
      : { ...base, integrity: host!.integrity, source: 'host_map' };
  });
  const lockfileSri = entries.filter(entry => entry.source === 'lockfile').length;
  return {
    mapDigest: map === undefined ? null : hostIntegrityMapDigest(map),
    lockfileSri, hostMap: entries.length - lockfileSri, entries,
  };
}
