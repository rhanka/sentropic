/**
 * Gateway evolution helper (L0, spec 8.1/GWRC-CI-V1).
 *
 * Pure Node validation for the shared closed v1 consumer contract: input
 * schema (both program arms), indexed candidate bundles, phase
 * classification (incl. GW8-m1 merge-parent verification), receipt
 * verification, and external-closure comparison. No network, no Docker, no
 * credential access; filesystem/git access only through injected resolvers
 * so every refusal is unit-testable with synthetic fixtures.
 */
import { createHash } from 'node:crypto';

export class GatewayInputError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'GatewayInputError';
    this.code = code;
  }
}

export const SCHEMA_VERSION = 1;

const GATEWAY_PHASES = new Set([
  'none',
  'baseline-662',
  'pr1-candidate',
  'pr2-candidate',
  'pr3-candidate',
  'pr1-published',
  'pr2-published',
  'pr3-published',
]);

const REGISTRY_PHASES = new Set([
  'none',
  'r4-candidate',
  'r5-candidate',
  'r6-candidate',
  'r7b-candidate',
  'r4-published',
  'r5-published',
  'r6-published',
  'r7b-published',
]);

const PROFILE_MAP = new Set([
  'gateway-runtime',
  'gateway-messaging',
  'registry-focus',
  'registry-runtime',
  'registry-renderer',
  'registry-hosts',
]);

const HEX64 = /^[0-9a-f]{64}$/;

const isRecord = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Reject duplicate JSON object members (JSON.parse keeps the last one
 * silently). Scans the raw text so `{"a":1,"a":2}` fails closed before any
 * schema check. String escapes are honored; braces inside strings are not
 * structure.
 */
export const assertNoDuplicateKeys = (text) => {
  const stack = [];
  let i = 0;
  const pushKey = (key) => {
    const top = stack[stack.length - 1];
    if (top.has(key)) {
      throw new GatewayInputError(
        `duplicate JSON member: ${key}`,
        'duplicate-member',
      );
    }
    top.add(key);
  };
  while (i < text.length) {
    const ch = text[i];
    if (ch === '{') {
      stack.push(new Set());
      i += 1;
    } else if (ch === '}') {
      stack.pop();
      i += 1;
    } else if (ch === '"') {
      const start = i;
      let j = i + 1;
      let out = '';
      while (j < text.length && text[j] !== '"') {
        if (text[j] === '\\') {
          out += text[j + 1] ?? '';
          j += 2;
        } else {
          out += text[j];
          j += 1;
        }
      }
      i = j + 1;
      let k = i;
      while (k < text.length && /\s/.test(text[k])) k += 1;
      if (text[k] === ':' && stack.length > 0) {
        pushKey(JSON.parse(text.slice(start, i)));
        i = k + 1;
      }
    } else {
      i += 1;
    }
  }
};

/** Parse consumer input text with duplicate-member and closed-shape checks. */
export const parseConsumerInput = (text) => {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new GatewayInputError('input is not valid JSON', 'invalid-json');
  }
  assertNoDuplicateKeys(text);
  return validateConsumerInput(parsed);
};

const assertHex64 = (value, field) => {
  if (typeof value !== 'string' || !HEX64.test(value)) {
    throw new GatewayInputError(`${field} must be a full lowercase 64-hex sha256`, 'bad-digest');
  }
};

const phasesFor = (program) => {
  if (program === 'gateway') return GATEWAY_PHASES;
  if (program === 'registry') return REGISTRY_PHASES;
  throw new GatewayInputError(`unknown program: ${program}`, 'unknown-program');
};

const assertProfiles = (profiles) => {
  if (!Array.isArray(profiles) || profiles.length === 0) {
    throw new GatewayInputError('profiles must be a nonempty list', 'bad-profiles');
  }
  const sorted = [...profiles].sort();
  for (let n = 0; n < profiles.length; n += 1) {
    if (profiles[n] !== sorted[n]) {
      throw new GatewayInputError('profiles must be sorted unique', 'bad-profiles');
    }
    if (!PROFILE_MAP.has(profiles[n])) {
      throw new GatewayInputError(`unknown profile: ${profiles[n]}`, 'unknown-profile');
    }
    if (profiles.indexOf(profiles[n]) !== n) {
      throw new GatewayInputError('profiles must be unique', 'bad-profiles');
    }
  }
};

const assertCoverage = (coverage, program, phase, contractSha256, profiles) => {
  if (!Array.isArray(coverage) || coverage.length === 0) {
    throw new GatewayInputError('programCoverage must be a nonempty list', 'bad-coverage');
  }
  const union = new Set();
  let activeFound = false;
  let previousProgram = '';
  for (const row of coverage) {
    if (!isRecord(row)) throw new GatewayInputError('coverage row must be an object', 'bad-coverage');
    const keys = Object.keys(row).sort().join(',');
    if (keys !== 'contractSha256,phase,profiles,program') {
      throw new GatewayInputError('coverage row has unknown or missing fields', 'bad-coverage');
    }
    if (!phasesFor(row.program).has(row.phase) || row.program <= previousProgram
      || (row.program !== program && !row.phase.endsWith('-published'))) {
      throw new GatewayInputError('coverage must be sorted unique programs with retained published phases', 'bad-coverage');
    }
    previousProgram = row.program;
    if (!Array.isArray(row.profiles) || row.profiles.length === 0) {
      throw new GatewayInputError('coverage row profiles must be nonempty', 'bad-coverage');
    }
    assertHex64(row.contractSha256, 'coverage contractSha256');
    assertProfiles(row.profiles);
    if (row.program === 'gateway' && !['gateway-messaging', 'gateway-runtime'].every((p) => row.profiles.includes(p))) {
      throw new GatewayInputError('gateway coverage requires both runtime and messaging', 'bad-profiles');
    }
    for (const profile of row.profiles) {
      if (!PROFILE_MAP.has(profile)) {
        throw new GatewayInputError(`unknown coverage profile: ${profile}`, 'unknown-profile');
      }
      union.add(profile);
    }
    if (row.program === program && row.phase === phase) {
      activeFound = true;
      if (row.contractSha256 !== contractSha256) {
        throw new GatewayInputError('active coverage row must match top-level contract', 'bad-coverage');
      }
    }
  }
  if (!activeFound) {
    throw new GatewayInputError('programCoverage must contain the active program row', 'bad-coverage');
  }
  const topUnion = [...union].sort().join(',');
  if (topUnion !== [...profiles].sort().join(',')) {
    throw new GatewayInputError('top-level profiles must be the union of coverage rows', 'bad-coverage');
  }
};

const NONE_KEYS = new Set(['schemaVersion', 'program', 'phase']);
const ACTIVE_KEYS = new Set([
  'schemaVersion',
  'program',
  'phase',
  'artifactKind',
  'contractSha256',
  'artifactManifest',
  'artifactManifestText',
  'packages',
  'candidateBundle',
  'releaseLockSha256',
  'mode',
  'scopes',
  'profiles',
  'programCoverage',
]);

const sha256Text = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

const assertPackageRow = (row) => {
  if (!isRecord(row)) throw new GatewayInputError('package row must be an object', 'bad-packages');
  const keys = Object.keys(row).sort().join(',');
  const want = 'integrity,lockLocation,name,resolved,sourceIdentity,tarballSha256,version';
  if (keys !== want) {
    throw new GatewayInputError('package row has unknown or missing fields', 'bad-packages');
  }
  if (typeof row.name !== 'string' || !row.name.startsWith('@sentropic/')) {
    throw new GatewayInputError(`package row name must be external @sentropic/*: ${row.name}`, 'bad-packages');
  }
  assertHex64(row.tarballSha256, 'package tarballSha256');
  for (const field of ['lockLocation', 'version', 'sourceIdentity']) {
    if (typeof row[field] !== 'string' || !row[field]) {
      throw new GatewayInputError(`package row ${field} must be nonempty`, 'bad-packages');
    }
  }
  if (typeof row.resolved !== 'string' || !row.resolved) {
    throw new GatewayInputError(`external row unpinned: ${row.lockLocation} ${row.name} resolved`, 'external-row-unpinned');
  }
  if (typeof row.integrity !== 'string' || !row.integrity) {
    throw new GatewayInputError(`external row unpinned: ${row.lockLocation} ${row.name} integrity`, 'external-row-unpinned');
  }
};

/** Closed v1 validation for both program arms. Unknown keys/values fail. */
export const validateConsumerInput = (input) => {
  if (!isRecord(input)) throw new GatewayInputError('input must be an object', 'bad-input');
  if (input.schemaVersion !== 1) throw new GatewayInputError('schemaVersion must be 1', 'bad-input');
  const phases = phasesFor(input.program);
  if (!phases.has(input.phase)) {
    throw new GatewayInputError(`mismatched program/phase pair: ${input.program}/${input.phase}`, 'bad-phase');
  }
  if (input.phase === 'none') {
    for (const key of Object.keys(input)) {
      if (!NONE_KEYS.has(key)) {
        throw new GatewayInputError(`none phase forbids field: ${key}`, 'bad-phase');
      }
    }
    return input;
  }
  for (const key of Object.keys(input)) {
    if (!ACTIVE_KEYS.has(key)) {
      throw new GatewayInputError(`unknown input key: ${key}`, 'unknown-key');
    }
  }
  const isCandidate = String(input.phase).endsWith('-candidate');
  const wantKind = isCandidate ? 'candidate' : 'published';
  if (input.artifactKind !== wantKind) {
    throw new GatewayInputError(`artifactKind must be ${wantKind} for phase ${input.phase}`, 'bad-kind');
  }
  assertHex64(input.contractSha256, 'contractSha256');
  assertHex64(input.releaseLockSha256, 'releaseLockSha256');
  if (!isRecord(input.artifactManifest)) {
    throw new GatewayInputError('artifactManifest must be an object', 'bad-manifest');
  }
  if (Object.keys(input.artifactManifest).some((key) => !['sha256', 'path'].includes(key))) {
    throw new GatewayInputError('unknown artifactManifest field', 'bad-manifest');
  }
  assertHex64(input.artifactManifest.sha256, 'artifactManifest.sha256');
  if (isCandidate) {
    if (input.artifactManifestText !== undefined) {
      throw new GatewayInputError('candidate forbids artifactManifestText', 'bad-manifest');
    }
    if (typeof input.artifactManifest.path !== 'string' || !input.artifactManifest.path) {
      throw new GatewayInputError('candidate artifactManifest requires path', 'bad-manifest');
    }
    if (!isRecord(input.candidateBundle)) {
      throw new GatewayInputError('candidate requires candidateBundle', 'bad-bundle');
    }
    if (Object.keys(input.candidateBundle).sort().join(',') !== 'bundleSha256,indexPath,root') {
      throw new GatewayInputError('unknown or missing candidateBundle field', 'bad-bundle');
    }
    const { root, indexPath, bundleSha256 } = input.candidateBundle;
    assertHex64(bundleSha256, 'candidateBundle.bundleSha256');
    const wantRoot = `.github/gateway-candidates/${input.phase}/${bundleSha256}/`;
    if (root !== wantRoot) {
      throw new GatewayInputError(`candidate root must be ${wantRoot}`, 'bad-bundle');
    }
    if (indexPath !== `${wantRoot}bundle-index.json`) {
      throw new GatewayInputError('candidate indexPath must be <root>bundle-index.json', 'bad-bundle');
    }
    if (input.artifactManifest.path !== `${wantRoot}manifest.json`) {
      throw new GatewayInputError('candidate manifest path must resolve under the bundle root', 'bad-manifest');
    }
  } else {
    if (input.artifactManifest.path !== undefined) {
      throw new GatewayInputError('published forbids artifactManifest.path', 'bad-manifest');
    }
    if (input.candidateBundle !== undefined) {
      throw new GatewayInputError('published forbids candidateBundle', 'bad-bundle');
    }
    if (typeof input.artifactManifestText !== 'string' || !input.artifactManifestText) {
      throw new GatewayInputError('published requires embedded artifactManifestText', 'bad-manifest');
    }
    if (sha256Text(input.artifactManifestText) !== input.artifactManifest.sha256) {
      throw new GatewayInputError('artifactManifestText bytes must hash to artifactManifest.sha256', 'bad-manifest');
    }
  }
  if (!Array.isArray(input.packages) || input.packages.length === 0) {
    throw new GatewayInputError('packages must be a nonempty closure', 'bad-packages');
  }
  input.packages.forEach(assertPackageRow);
  if (input.mode !== 'scoped' && input.mode !== 'aggregate') {
    throw new GatewayInputError('mode must be scoped or aggregate', 'bad-mode');
  }
  if (input.mode === 'scoped') {
    if (!Array.isArray(input.scopes) || input.scopes.length === 0) {
      throw new GatewayInputError('scoped mode requires nonempty exact selectors', 'bad-mode');
    }
  } else if (input.scopes !== undefined) {
    throw new GatewayInputError('aggregate mode forbids scopes', 'bad-mode');
  }
  assertProfiles(input.profiles);
  assertCoverage(input.programCoverage, input.program, input.phase, input.contractSha256, input.profiles);
  return input;
};

const MANIFEST_KEYS = new Set(['kind', 'image', 'pythonFree', 'createdBy', 'notes',
  'sourceSha', 'contractSha256', 'releaseLockSha256', 'packages', 'artifacts',
  'profiles', 'programCoverage', 'scopes']);

/** Closed run-manifest validation. Pure mode accepts tool-only manifests. */
export const checkManifest = (manifest, { kind, expectImageReference, expectImageDigest } = {}) => {
  if (!isRecord(manifest)) throw new GatewayInputError('manifest must be an object', 'bad-manifest');
  for (const key of Object.keys(manifest)) {
    if (!MANIFEST_KEYS.has(key)) throw new GatewayInputError(`unknown manifest key: ${key}`, 'bad-manifest');
  }
  if (!['tool-only', 'candidate', 'published'].includes(manifest.kind)) {
    throw new GatewayInputError('manifest kind must be tool-only, candidate, or published', 'bad-manifest');
  }
  if (kind !== undefined && manifest.kind !== kind) {
    throw new GatewayInputError(`manifest kind must be ${kind}, got ${manifest.kind}`, 'bad-manifest');
  }
  if (!isRecord(manifest.image)) throw new GatewayInputError('manifest image must be an object', 'bad-manifest');
  if (manifest.pythonFree !== true || Object.keys(manifest.image).sort().join(',') !== 'digest,reference') {
    throw new GatewayInputError('manifest requires a closed image and pythonFree=true', 'bad-manifest');
  }
  if (typeof manifest.image.reference !== 'string' || !manifest.image.reference) {
    throw new GatewayInputError('manifest image.reference must be nonempty', 'bad-manifest');
  }
  assertHex64(manifest.image.digest, 'manifest image.digest');
  if (expectImageReference !== undefined && manifest.image.reference !== expectImageReference) {
    throw new GatewayInputError('manifest image reference drift', 'image-drift');
  }
  if (expectImageDigest !== undefined && manifest.image.digest !== expectImageDigest) {
    throw new GatewayInputError('manifest image digest drift', 'image-drift');
  }
  return manifest;
};

const readJson = async (fs, path) => {
  const text = await fs.readFile(path, 'utf8');
  try {
    return JSON.parse(text);
  } catch {
    throw new GatewayInputError(`unreadable JSON: ${path}`, 'unreadable-manifest');
  }
};

const usageError = (message) => {
  throw new GatewayInputError(message, 'usage');
};

/** Minimal CLI dispatcher. Later lots add packed-gate, consumer-gate,
// release-check, candidate-bundle, client-fixtures, and client-e2e. Until
// then those commands fail closed as not implemented (never a pass). */
export const main = async (argv, { fs, out } = {}) => {
  const [command, ...rest] = argv;
  const flag = (name) => {
    const index = rest.indexOf(`--${name}`);
    if (index < 0 || index + 1 >= rest.length) usageError(`missing --${name}`);
    return rest[index + 1];
  };
  if (command === 'check-manifest') {
    const manifest = await readJson(fs, flag('manifest'));
    checkManifest(manifest, {
      kind: rest.includes('--kind') ? flag('kind') : undefined,
      expectImageReference: rest.includes('--expect-image-reference')
        ? flag('expect-image-reference')
        : undefined,
      expectImageDigest: rest.includes('--expect-image-digest') ? flag('expect-image-digest') : undefined,
    });
    out?.(`manifest ok: ${manifest.kind}\n`);
    return 0;
  }
  if (command === 'candidate-bundle') {
    const { transferCandidate } = await import('./transfer.mjs');
    const result = await transferCandidate({ program: flag('program'), delivery: flag('delivery'),
      manifestPath: flag('manifest'), worktree: flag('worktree'), mode: flag('mode'), sourceSha: flag('source-sha') });
    out?.(`${JSON.stringify(result)}\n`);
    return 0;
  }
  if (command === 'packed-gate') {
    const { preparePackedGate } = await import('./packed.mjs');
    const result = await preparePackedGate({ manifestPath: flag('manifest'), scope: flag('scope'), output: flag('output') });
    out?.(`${JSON.stringify(result)}\n`);
    return 0;
  }
  if (
    command === 'packed-gate' ||
    command === 'consumer-gate' ||
    command === 'release-check' ||
    command === 'candidate-bundle' ||
    command === 'client-fixtures' ||
    command === 'client-e2e'
  ) {
    throw new GatewayInputError(`blocked (${command} not implemented in this lot)`, 'not-implemented');
  }
  usageError(`unknown command: ${command}`);
  return 1;
};

/** Canonical index bytes: deterministic UTF-8 over sorted relative POSIX paths. */
export const buildBundleIndex = (entries) => {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new GatewayInputError('bundle entries must be nonempty', 'bad-bundle');
  }
  const seen = new Set();
  const files = entries.map((entry) => {
    if (!isRecord(entry) || typeof entry.path !== 'string') {
      throw new GatewayInputError('bundle entry must carry a path', 'bad-bundle');
    }
    const { path, size, sha256 } = entry;
    if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) {
      throw new GatewayInputError(`unsafe bundle path: ${path}`, 'bad-path');
    }
    if (seen.has(path)) throw new GatewayInputError(`duplicate bundle path: ${path}`, 'bad-bundle');
    seen.add(path);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new GatewayInputError(`bad bundle size: ${path}`, 'bad-bundle');
    }
    assertHex64(sha256, `bundle sha256: ${path}`);
    return { path, size, sha256 };
  });
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const canonical = JSON.stringify({ version: 1, files });
  return { version: 1, files, bundleSha256: sha256Text(canonical) };
};

/**
 * Verify a committed candidate bundle against listed directory entries.
 * listDir(root) yields {path, size, sha256, kind} with kind file|symlink|lfs.
 * Missing/extra/altered files, symlinks, and LFS pointers fail closed.
 */
export const verifyBundleIndex = (index, listed) => {
  if (!isRecord(index) || index.version !== 1 || !Array.isArray(index.files)) {
    throw new GatewayInputError('bundle index must be a v1 index', 'bad-index');
  }
  const expected = new Map(index.files.map((file) => [file.path, file]));
  const seen = new Set();
  for (const entry of listed) {
    if (entry.path === 'bundle-index.json') continue;
    if (entry.kind === 'symlink' || entry.kind === 'lfs') {
      throw new GatewayInputError(`unsafe bundle member: ${entry.path} (${entry.kind})`, 'unsafe-member');
    }
    const want = expected.get(entry.path);
    if (!want) throw new GatewayInputError(`extra bundle file: ${entry.path}`, 'bundle-mismatch');
    if (want.size !== entry.size || want.sha256 !== entry.sha256) {
      throw new GatewayInputError(`altered bundle file: ${entry.path}`, 'bundle-mismatch');
    }
    seen.add(entry.path);
  }
  for (const path of expected.keys()) {
    if (!seen.has(path)) throw new GatewayInputError(`missing bundle file: ${path}`, 'bundle-mismatch');
  }
  return { files: expected.size };
};

/** Dependency-free phase classifier: candidate phases never build committed-lock jobs. */
export const classifyPhase = (program, phase) => {
  phasesFor(program);
  if (!phasesFor(program).has(phase)) {
    throw new GatewayInputError(`mismatched program/phase pair: ${program}/${phase}`, 'bad-phase');
  }
  if (String(phase).endsWith('-candidate')) {
    return { buildCommittedLock: false, reason: 'not-applicable (candidate-phase, committed lock)' };
  }
  if (phase === 'none') return { buildCommittedLock: true, reason: 'inert (no consumer preparation)' };
  if (phase === 'baseline-662') return { buildCommittedLock: true, reason: 'h0-baseline (committed lock)' };
  return { buildCommittedLock: true, reason: 'published (committed lock)' };
};

const defaultParentOf = async (mergeSha, n) => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  try {
    const { stdout } = await promisify(execFile)('git', ['rev-parse', `${mergeSha}^${n}`]);
    return stdout.trim();
  } catch {
    throw new GatewayInputError(`unreadable merge parent ^${n} of ${mergeSha}`, 'unreadable-base-evidence');
  }
};

/**
 * GW8-m1: verify the tested merge commit's parents equal the pinned base and
 * head before any base/head tree read. Fetch failure (or any unresolvable
 * parent) is unreadable base evidence and refuses inheritance.
 */
export const verifyMergeParents = async ({ mergeSha, baseSha, headSha }, git = {}) => {
  if (!mergeSha || !baseSha || !headSha) {
    throw new GatewayInputError('merge/base/head SHAs are all required', 'bad-source');
  }
  const parentOf = git.parentOf ?? defaultParentOf;
  let first;
  let second;
  try {
    first = await parentOf(mergeSha, 1);
    second = await parentOf(mergeSha, 2);
  } catch (error) {
    if (error instanceof GatewayInputError) throw error;
    throw new GatewayInputError('unreadable base evidence (parent fetch failed)', 'unreadable-base-evidence');
  }
  if (first !== baseSha || second !== headSha) {
    throw new GatewayInputError('merge parents do not match pinned base/head', 'unrelated-merge');
  }
  return { mergeSha, baseSha, headSha };
};

/**
 * External-closure projection (GW7-M1 = RC7-M1): resolve every lock row by
 * actual package identity. Workspace-name copies are excluded by name at any
 * location or version; the @sentropic scope alone never exempts a package.
 */
export const externalProjection = (lockEntries, workspaceNames) => {
  const names = new Set(workspaceNames);
  return lockEntries
    .filter((row) => typeof row.name === 'string' && row.name.startsWith('@sentropic/') && !names.has(row.name))
    .map((row) => ({
      location: row.location,
      name: row.name,
      version: row.version,
      resolved: row.resolved,
      integrity: row.integrity,
    }))
    .sort((a, b) => (`${a.location}${a.name}` < `${b.location}${b.name}` ? -1 : 1));
};

/** Truly external rows must be pinned before drift comparison or install. */
export const assertPinnedProjection = (projection) => {
  for (const row of projection) {
    if (typeof row.resolved !== 'string' || !row.resolved) {
      throw new GatewayInputError(
        `external row unpinned: ${row.location} ${row.name} resolved`,
        'external-row-unpinned',
      );
    }
    if (typeof row.integrity !== 'string' || !row.integrity) {
      throw new GatewayInputError(
        `external row unpinned: ${row.location} ${row.name} integrity`,
        'external-row-unpinned',
      );
    }
  }
  return projection;
};

/** Missing, extra, or changed external rows fail before installation. */
export const compareExternalProjection = (actual, declared) => {
  assertPinnedProjection(actual);
  assertPinnedProjection(declared);
  const keyOf = (row) => `${row.location}${row.name}`;
  const want = new Map(declared.map((row) => [keyOf(row), row]));
  for (const row of actual) {
    const expected = want.get(keyOf(row));
    if (!expected) throw new GatewayInputError(`external drift (extra): ${keyOf(row)}`, 'external-drift');
    for (const field of ['version', 'resolved', 'integrity']) {
      if (row[field] !== expected[field]) {
        throw new GatewayInputError(`external drift (changed ${field}): ${keyOf(row)}`, 'external-drift');
      }
    }
    want.delete(keyOf(row));
  }
  if (want.size > 0) {
    throw new GatewayInputError(`external drift (missing): ${[...want.keys()].join(',')}`, 'external-drift');
  }
  return actual;
};

/**
 * Receipt verification (GW6-M1 = RC6-M1 run identity). Companion-own runs
 * enforce full-lock equality; inherited/main runs allow a changed full lock
 * only with an equal external projection. User JSON or a green title never
 * replaces server metadata (the caller supplies the fetched receipt).
 */
export const verifyConsumerReceipt = (receipt, expected) => {
  if (!isRecord(receipt)) throw new GatewayInputError('blocked (ci-receipt-unavailable)', 'ci-receipt-unavailable');
  if (receipt.program !== expected.program || receipt.phase !== expected.phase) {
    throw new GatewayInputError('wrong program/phase in receipt', 'wrong-phase');
  }
  if (receipt.conclusion !== 'success') {
    throw new GatewayInputError('receipt conclusion is not success', 'incomplete-evidence');
  }
  for (const job of receipt.jobs ?? []) {
    if (job.conclusion !== 'success') {
      throw new GatewayInputError(`job not successful: ${job.name}`, 'incomplete-evidence');
    }
  }
  if (String(receipt.runId) !== String(expected.runId) || String(receipt.attempt) !== String(expected.attempt)) {
    throw new GatewayInputError('receipt run/attempt does not match expected', 'stale-receipt');
  }
  if (receipt.headSha !== expected.headSha) throw new GatewayInputError('stale head', 'stale-head');
  if (receipt.baseSha !== undefined && expected.baseSha !== undefined && receipt.baseSha !== expected.baseSha) {
    throw new GatewayInputError('stale base', 'stale-base');
  }
  if (receipt.mergeSha !== undefined && expected.mergeSha !== undefined && receipt.mergeSha !== expected.mergeSha) {
    throw new GatewayInputError('unrelated merge checkout', 'unrelated-merge');
  }
  if (expected.inputSha256 !== undefined && receipt.inputSha256 !== expected.inputSha256) {
    throw new GatewayInputError('input digest mismatch', 'digest-mismatch');
  }
  if (expected.manifestSha256 !== undefined && receipt.manifestSha256 !== expected.manifestSha256) {
    throw new GatewayInputError('manifest digest mismatch', 'digest-mismatch');
  }
  if (expected.allowLockChange === true) {
    if (!expected.actualProjection || !expected.declaredProjection) {
      throw new GatewayInputError('inherited runs require both projections', 'incomplete-evidence');
    }
    compareExternalProjection(expected.actualProjection, expected.declaredProjection);
  } else {
    if (receipt.releaseLockSha256 !== expected.releaseLockSha256) {
      throw new GatewayInputError('companion-own run requires full-lock equality', 'lock-mismatch');
    }
    if (receipt.declaredReleaseLockSha256 !== expected.releaseLockSha256) {
      throw new GatewayInputError('declared full-lock hash mismatch', 'lock-mismatch');
    }
  }
  return { verified: true, program: receipt.program, phase: receipt.phase };
};

import { pathToFileURL } from 'node:url';

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fs = await import('node:fs/promises');
  main(process.argv.slice(2), { fs, out: (text) => process.stdout.write(text) }).then(
    (code) => process.exit(code ?? 0),
    (error) => {
      process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
      process.exit(error instanceof GatewayInputError ? 2 : 1);
    },
  );
}
