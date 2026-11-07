import { sha256Hex } from './build-integrity.js';
import { ArtifactOperationError } from './failures.js';
import { isGitSha } from './git-port-policy.js';
import { SERVER_MAX_FILES_PER_RELEASE, SERVER_MAX_FILE_BYTES } from './publication-limits.js';

/** One candidate output file as hashed by the trusted supervisor from the stable output snapshot. */
export interface CandidateFileDigest {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}
/**
 * A-LIVE §8.4 builder-attested evidence, sealed outside repository code. Every field is mandatory;
 * unknown fields are additive and ignored. releaseId/manifestDigest stay null until publication.
 */
export interface BuilderAttestedEvidence {
  readonly storageScopeId: string;
  readonly artifactId: string;
  readonly bindingGeneration: number;
  readonly jobId: string;
  readonly runId: string;
  readonly attempt: number;
  readonly commitSha: string;
  readonly treeSha: string;
  readonly descriptorDigest: string;
  readonly lockfileDigest: string;
  /** Digest of the integrity-map/cache receipt that admitted the dependency closure. */
  readonly integrityReceiptDigest: string;
  readonly builderImageDigest: string;
  readonly platform: string;
  readonly nodeVersion: string;
  readonly npmVersion: string;
  readonly publicEnvHashes: Readonly<Record<string, string>>;
  readonly stagingPolicy: string;
  readonly stagingDigest: string;
  readonly candidateDigest: string;
  readonly candidateFiles: readonly CandidateFileDigest[];
  readonly releaseId: string | null;
  readonly manifestDigest: string | null;
}
/** Server-resolved job, sealed handoff and admitted inputs the evidence must join exactly. */
export type BuilderReceiptExpectation = Pick<BuilderAttestedEvidence, typeof JOINS[number][0]>;
/** Closed `git_build_job_mismatch` reasons; no foreign job, scope or digest value is disclosed. */
export type BuilderReceiptMismatch = 'scope' | 'job' | 'source' | 'inputs' | 'candidate';

const JOINS = [
  ['storageScopeId', 'scope'], ['artifactId', 'scope'], ['bindingGeneration', 'scope'],
  ['jobId', 'job'], ['runId', 'job'], ['attempt', 'job'], ['commitSha', 'source'], ['treeSha', 'source'],
  ['descriptorDigest', 'inputs'], ['lockfileDigest', 'inputs'], ['integrityReceiptDigest', 'inputs'],
  ['builderImageDigest', 'inputs'], ['platform', 'inputs'], ['publicEnvHashes', 'inputs'],
  ['stagingPolicy', 'inputs'], ['stagingDigest', 'inputs'], ['candidateDigest', 'candidate'],
] as const;
const HEX = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const id = (value: unknown): boolean => typeof value === 'string' && value.length > 0 && value.length <= 256
  && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
const count = (value: unknown, min: number): boolean => Number.isSafeInteger(value) && (value as number) >= min;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const path = (value: unknown): boolean => typeof value === 'string' && Buffer.byteLength(value) <= 1024
  && !/[\\%?#:\u0000-\u001f\u007f]/.test(value) && value.split('/').every(part => part !== '' && part !== '.' && part !== '..');
const canonicalEnv = (hashes: Readonly<Record<string, string>>): string =>
  JSON.stringify(Object.entries(hashes).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/** Canonical candidate manifest digest over every file (path, size, SHA-256); file order is irrelevant. */
export function candidateInventoryDigest(files: readonly CandidateFileDigest[]): string {
  const rows = files.map(file => [file.path, file.bytes, file.sha256] as const);
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return sha256Hex(JSON.stringify(['sentropic.build-candidate/v1', rows]));
}

function schema(value: unknown): value is BuilderAttestedEvidence {
  if (!record(value)) return false;
  const files = value.candidateFiles;
  const env = value.publicEnvHashes;
  return id(value.storageScopeId) && typeof value.artifactId === 'string' && UUID.test(value.artifactId)
    && count(value.bindingGeneration, 1) && id(value.jobId) && id(value.runId) && count(value.attempt, 1)
    && typeof value.commitSha === 'string' && isGitSha(value.commitSha)
    && typeof value.treeSha === 'string' && isGitSha(value.treeSha)
    && [value.descriptorDigest, value.lockfileDigest, value.integrityReceiptDigest, value.stagingDigest,
      value.candidateDigest].every(digest => typeof digest === 'string' && HEX.test(digest))
    && typeof value.builderImageDigest === 'string' && /^sha256:[a-f0-9]{64}$/.test(value.builderImageDigest)
    && typeof value.platform === 'string' && /^[a-z0-9]+\/[a-z0-9_]+(?:\/[a-z0-9]+)?$/.test(value.platform)
    && typeof value.nodeVersion === 'string' && VERSION.test(value.nodeVersion)
    && typeof value.npmVersion === 'string' && VERSION.test(value.npmVersion)
    && record(env) && Object.entries(env).every(([name, hash]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
      && typeof hash === 'string' && HEX.test(hash))
    && id(value.stagingPolicy)
    && (value.releaseId === null || (typeof value.releaseId === 'string' && UUID.test(value.releaseId)))
    && (value.manifestDigest === null || (typeof value.manifestDigest === 'string' && HEX.test(value.manifestDigest)))
    && Array.isArray(files) && files.length > 0 && files.length <= SERVER_MAX_FILES_PER_RELEASE
    && new Set(files.map(file => file?.path)).size === files.length
    && files.every(file => record(file) && path(file.path) && count(file.bytes, 0)
      && (file.bytes as number) <= SERVER_MAX_FILE_BYTES && typeof file.sha256 === 'string' && HEX.test(file.sha256));
}

/**
 * Pure verdict (BR-82 pattern, G0 §4.3): mandatory schema, candidate digest recomputed from the complete
 * file inventory, then the exact join against server evidence. Authentication, single use and expiry of
 * the supervisor handoff belong to the SG4b handoff, not to this function.
 */
export function verifyBuilderReceipt(evidence: unknown, expected: BuilderReceiptExpectation): BuilderAttestedEvidence {
  if (!schema(evidence) || candidateInventoryDigest(evidence.candidateFiles) !== evidence.candidateDigest) {
    throw new ArtifactOperationError('verification_failed');
  }
  for (const [key, reason] of JOINS) {
    const same = key === 'publicEnvHashes'
      ? record(expected.publicEnvHashes) && canonicalEnv(evidence.publicEnvHashes) === canonicalEnv(expected.publicEnvHashes)
      : evidence[key] === expected[key];
    if (!same) throw new ArtifactOperationError('git_build_job_mismatch', { publicDetails: { reason } });
  }
  return Object.freeze({ ...evidence });
}

/** Anti-repack: the re-read uploaded bytes must hash to the sealed candidate digest. */
export function verifyServedCandidate(evidence: BuilderAttestedEvidence, served: readonly CandidateFileDigest[]): void {
  if (!Array.isArray(served) || candidateInventoryDigest(served) !== evidence.candidateDigest) {
    throw new ArtifactOperationError('verification_failed');
  }
}
