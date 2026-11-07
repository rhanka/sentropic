// RegistryPort over the build-generated Registry.js (mode (b), metadata only, no bytes). Pure and synchronous.
// ONE version predicate serves both gates: build-time publish and runtime registry load (spec §5, N3 r3 OQ13).
import { StoreRefusedError, VersionConflictError } from './errors.js';

export const ID_RE = /^[a-z0-9][a-z0-9-]{2,63}$/;
export const VERSION_PARAM_RE = /^[1-9][0-9]{0,8}$/;
const SHA_RE = /^[0-9a-f]{64}$/;

export interface RegistryEntry {
  readonly id: string;
  readonly version: number;
  readonly tenantId: string;
  readonly file: string;
  readonly title: string;
  readonly createdAt: string;
  readonly payloadSha256: string;
  readonly bytes: number;
}

/** The single predicate: versions per id are contiguous 1..latest; only latest + 1 is accepted (latest = 0 when absent). */
export function acceptsVersion(latest: number, version: unknown): boolean {
  return typeof version === 'number' && Number.isInteger(version) && version === latest + 1;
}

export function assertNextVersion(id: string, latest: number, version: unknown): void {
  if (!acceptsVersion(latest, version)) throw new VersionConflictError(`${id}: got ${String(version)}, expected ${latest + 1}`);
}

function assertEntryShape(e: RegistryEntry): void {
  const ok =
    typeof e.id === 'string' && ID_RE.test(e.id) &&
    typeof e.tenantId === 'string' && e.tenantId.length > 0 &&
    typeof e.file === 'string' && e.file.length > 0 &&
    typeof e.title === 'string' && e.title.length >= 1 && e.title.length <= 200 &&
    typeof e.createdAt === 'string' && e.createdAt.length > 0 &&
    typeof e.payloadSha256 === 'string' && SHA_RE.test(e.payloadSha256) &&
    typeof e.bytes === 'number' && Number.isInteger(e.bytes) && e.bytes > 0;
  if (!ok) throw new StoreRefusedError('registry_invalid', `bad entry shape for ${JSON.stringify(e && e.id)}`);
}

export interface RegistryPort {
  get(tenantId: string, id: string, version: number): RegistryEntry | null;
  latest(tenantId: string, id: string): RegistryEntry | null;
  list(tenantId: string): RegistryEntry[];
  /** Parses `?a=<id>&v=<n>` (absent v = latest). Null on malformed input or when the tenant cannot read it. */
  resolve(tenantId: string, params: { readonly a?: unknown; readonly v?: unknown }): RegistryEntry | null;
}

/** Refuses to start (throws) on gaps, duplicates, disorder, 0/negative/non-integer versions or malformed entries. */
export function loadRegistry(entries: readonly RegistryEntry[]): RegistryPort {
  const latestById: { [id: string]: number } = {};
  const tenantById: { [id: string]: string } = {};
  entries.forEach((e) => {
    assertEntryShape(e);
    const prev = Object.prototype.hasOwnProperty.call(latestById, e.id) ? latestById[e.id] : 0;
    assertNextVersion(e.id, prev, e.version);
    if (prev > 0 && tenantById[e.id] !== e.tenantId) throw new StoreRefusedError('registry_invalid', `${e.id}: tenant changed between versions`);
    latestById[e.id] = e.version;
    tenantById[e.id] = e.tenantId;
  });
  const all = entries.slice();
  const get = (tenantId: string, id: string, version: number): RegistryEntry | null => {
    for (let i = 0; i < all.length; i++) {
      const e = all[i];
      if (e.id === id && e.version === version && e.tenantId === tenantId) return e;
    }
    return null;
  };
  const latest = (tenantId: string, id: string): RegistryEntry | null =>
    Object.prototype.hasOwnProperty.call(latestById, id) ? get(tenantId, id, latestById[id]) : null;
  return {
    get,
    latest,
    list: (tenantId) => all.filter((e) => e.tenantId === tenantId),
    resolve(tenantId, params) {
      if (typeof params.a !== 'string' || !ID_RE.test(params.a)) return null;
      if (params.v === undefined || params.v === null || params.v === '') return latest(tenantId, params.a);
      if (typeof params.v !== 'string' || !VERSION_PARAM_RE.test(params.v)) return null;
      return get(tenantId, params.a, Number(params.v));
    },
  };
}
