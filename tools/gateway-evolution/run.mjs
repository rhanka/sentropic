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
        pushKey(out);
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
  for (const row of coverage) {
    if (!isRecord(row)) throw new GatewayInputError('coverage row must be an object', 'bad-coverage');
    const keys = Object.keys(row).sort().join(',');
    if (keys !== 'contractSha256,phase,profiles,program') {
      throw new GatewayInputError('coverage row has unknown or missing fields', 'bad-coverage');
    }
    phasesFor(row.program);
    if (!Array.isArray(row.profiles) || row.profiles.length === 0) {
      throw new GatewayInputError('coverage row profiles must be nonempty', 'bad-coverage');
    }
    assertHex64(row.contractSha256, 'coverage contractSha256');
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
  const want = 'integrity,lockLocation,name,resolved,source,version';
  if (keys !== want) {
    throw new GatewayInputError('package row has unknown or missing fields', 'bad-packages');
  }
  if (typeof row.name !== 'string' || !row.name.startsWith('@sentropic/')) {
    throw new GatewayInputError(`package row name must be external @sentropic/*: ${row.name}`, 'bad-packages');
  }
  for (const field of ['lockLocation', 'version', 'source']) {
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

const MANIFEST_KEYS = new Set(['kind', 'image', 'pythonFree', 'createdBy', 'notes']);

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
