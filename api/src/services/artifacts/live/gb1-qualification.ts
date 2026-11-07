import {
  validateArtifactBuild, type ArtifactBuildSnapshot, type DependencyIntegrityInventory, type ScriptQualificationRecord,
} from '@sentropic/artifacts/server/build-contract';
import { sha256, type IntegrityEvidence } from './integrity';
import { LiveError } from './records';

/** GB1 host qualification file, read at the repository root of the job's pinned commit (s-archi 07/11 16:00 §1). */
export const GB1_QUALIFICATION_PATH = 'artifact-build/gb1-qualification.json';
export const GB1_QUALIFICATION_MAX_BYTES = 64 * 1024;
/** GB1 inputs at the pinned commit from the trusted forge port, never the live draft: the descriptor, the manifests, the
 * lock and the qualification file. `integrityMap` is the host-sealed map (A-LIVE §7.2), never a branch file. */
export type Gb1Source = Omit<ArtifactBuildSnapshot, 'postinstallAllowlist' | 'scriptQualification'>;
export interface BuildQualification {
  descriptorDigest: string; lockfileDigest: string;
  /** SHA-256 of the qualification file; of zero bytes when a lock without script entries carries no file. */
  digest: string;
  scriptQualification: readonly ScriptQualificationRecord[]; integrity: DependencyIntegrityInventory;
}
interface Row { package: string; version: string; integrity: string }
const FILE_KEYS = 'lockSha256,postinstallAllowlist,scriptQualification,v';
const ROW_KEYS = 'integrity,package,version';
const invalid = (): never => { throw new LiveError('build_descriptor_invalid', 'qualification_invalid'); };
const unqualified = (reason: string): never => { throw new LiveError('install_script_not_allowlisted', reason); };
const closed = (value: unknown, keys: string): value is Record<string, unknown> => typeof value === 'object'
  && value !== null && !Array.isArray(value) && Object.keys(value).sort().join() === keys;
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 1024;
const triple = (row: Row) => JSON.stringify([row.package, row.version, row.integrity]);
function json(source: string): unknown {
  try { return JSON.parse(source); } catch { return invalid(); }
}

function parse(source: string): { lockSha256: string; rows: Row[] } {
  if (Buffer.byteLength(source, 'utf8') > GB1_QUALIFICATION_MAX_BYTES) invalid();
  const value = json(source);
  if (!closed(value, FILE_KEYS) || value.v !== 1 || typeof value.lockSha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.lockSha256) || !Array.isArray(value.postinstallAllowlist)
    || !Array.isArray(value.scriptQualification)) return invalid();
  // No install hook runs in this train (A-LIVE §7.3): the G0 execution allowlist stays empty.
  if (value.postinstallAllowlist.length > 0) unqualified('execution_allowlist_not_empty');
  const rows = value.scriptQualification.map((row: unknown): Row => (closed(row, ROW_KEYS) && text(row.package)
    && text(row.version) && text(row.integrity) ? { package: row.package, version: row.version, integrity: row.integrity } : invalid()));
  if (new Set(rows.map(triple)).size !== rows.length) invalid();
  return { lockSha256: value.lockSha256, rows };
}

/** GB1 at the pinned commit: the qualification rows enter the W5 port as disabled hooks with an empty execution
 * allowlist, then must cover the lock's script entries exactly and name this exact lock. */
export function qualifyBuild(source: Gb1Source): BuildQualification {
  const content = Object.hasOwn(source.files, GB1_QUALIFICATION_PATH) ? source.files[GB1_QUALIFICATION_PATH] : undefined;
  const file = content === undefined ? undefined : parse(content);
  let build: ReturnType<typeof validateArtifactBuild>;
  try { build = validateArtifactBuild({ ...source, postinstallAllowlist: [], scriptQualification: file?.rows ?? [] }); }
  catch (error) {
    const kind = error instanceof Error && error.name === 'ArtifactOperationError' ? (error as { kind?: unknown }).kind : undefined;
    if (kind === 'install_script_not_allowlisted') return unqualified(file ? 'qualification_rows_mismatch' : 'qualification_missing');
    throw typeof kind === 'string' ? new LiveError(kind) : error;
  }
  if (file && file.lockSha256 !== build.lockfileDigest) unqualified('qualification_lock_mismatch');
  const covered = new Set(build.scriptQualification.map(triple));
  if (covered.size !== (file?.rows.length ?? 0) || file?.rows.some(row => !covered.has(triple(row)))) {
    unqualified('qualification_rows_mismatch');
  }
  return { descriptorDigest: build.descriptorDigest, lockfileDigest: build.lockfileDigest, digest: sha256(content ?? ''),
    scriptQualification: build.scriptQualification, integrity: build.integrity };
}

/** Cache evidence of one qualified commit: the qualification digest (the cache identity's `integrityDigest`) and the
 * complete remote inventory W5 covered by literal SRI or the sealed host map. */
export function integrityEvidence(qualification: BuildQualification): IntegrityEvidence {
  const inventory = qualification.integrity.entries.map(entry => ({ path: entry.path, url: entry.registryUrl,
    version: entry.version, integrity: entry.integrity }));
  inventory.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { lockSha256: qualification.lockfileDigest, digest: qualification.digest, inventory };
}
