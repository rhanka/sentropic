import { createHash } from 'node:crypto';
import { LiveHostError } from './errors.js';

/** One output file of a clean build (G0 §2.3 candidate). Modes are not served, so they are not digested. */
export interface CandidateFile { readonly path: string; readonly bytes: Uint8Array }
/** A-LIVE §8.3 stable output snapshot ceilings. */
export const CANDIDATE_LIMITS = Object.freeze({ files: 255, fileBytes: 16_777_216, totalBytes: 67_108_864 });
export const CANDIDATE_DIGEST_TAG = 'sentropic.candidate.v1\n';

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const FORBIDDEN = /[\\\u0000-\u001f\u007f]|\p{Cs}/u;
/** Relative, `/`-separated, no empty, `.` or `..` segment, no backslash, control character or lone surrogate. */
export function candidatePath(path: unknown): path is string {
  return typeof path === 'string' && path.length > 0 && Buffer.byteLength(path) <= 1024 && !FORBIDDEN.test(path)
    && path.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..');
}
const invalid = (): never => { throw new LiveHostError('candidate_invalid'); };

/**
 * THE canonical candidate digest, shared by the supervisor snapshot, the builder handoff and the host verifier:
 * sha256 hex of `sentropic.candidate.v1\n` + JSON of `[path, byteLength, sha256 hex]` entries sorted by path in
 * UTF-16 code unit order (the JSON is UTF-8 encoded). Refuses with `candidate_invalid` an empty or over-limit set,
 * an unsafe or duplicate path, and a path that is both a file and a directory.
 */
export function candidateDigest(files: readonly CandidateFile[]): string {
  if (!Array.isArray(files) || files.length < 1 || files.length > CANDIDATE_LIMITS.files) invalid();
  const paths = new Set<string>(); let total = 0;
  const entries = files.map(file => {
    if (!file || !candidatePath(file.path) || paths.has(file.path) || !(file.bytes instanceof Uint8Array)
      || file.bytes.byteLength > CANDIDATE_LIMITS.fileBytes) invalid();
    paths.add(file.path); total += file.bytes.byteLength;
    return [file.path, file.bytes.byteLength, sha256(file.bytes)] as const;
  }).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  if (total > CANDIDATE_LIMITS.totalBytes) invalid();
  for (const path of paths) {
    for (let at = path.indexOf('/'); at !== -1; at = path.indexOf('/', at + 1)) if (paths.has(path.slice(0, at))) invalid();
  }
  return sha256(CANDIDATE_DIGEST_TAG + JSON.stringify(entries));
}
