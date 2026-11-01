// ACT-L05 (r6 wave W2): L5-C isolated rebuild contract. Only an admitted pinned
// builder may run, with no shared daemon, no credentials, no Python and no
// inherited registry configuration. Fail-closed: no builder is admitted yet.
import { isAbsolute } from 'node:path';
import { digest, isDigest, policy, requireEvidence } from './toolchain-contract.mjs';
import { COHORT_KEYS } from './target-custody.mjs';

// Empty by default: an admitted isolated builder requires its own reviewed
// promotion receipt before any digest is listed here.
export const ADMITTED_BUILDERS = Object.freeze([]);

const SOCKET_PATH = /\.sock($|\/)|docker\.sock|buildkitd/i;
const HOST_ESCAPE_ROOTS = new Set(['/', '/etc', '/root', '/home', '/var', '/usr', '/bin', '/sbin', '/lib', '/proc', '/sys', '/dev']);
const CREDENTIAL_ENV = /TOKEN|PASSWORD|PASSWD|SECRET|CREDENTIAL|DOCKER_CONFIG|REGISTRY/i;
const PYTHON_ENTRY = /(^|\/)(python([0-9.]*)?|pip([0-9.]*)?)(\/|$)|site-packages|libpython/i;
const ALLOWED_MOUNT_ROOTS = ['/workspace', '/run/rebuild-work'];

// Plan a rebuild in an isolated ephemeral builder. Any shared socket, host
// escape, registry-config inheritance, Python entry or unadmitted builder
// refuses before the build starts.
export function planRebuild({ builder, sourceSha, target, recipeDigest, mounts = [], env = {},
  admittedBuilders = ADMITTED_BUILDERS }) {
  requireEvidence(/^[a-f0-9]{40}$/.test(sourceSha || ''), 'immutable main source SHA');
  requireEvidence(builder && isDigest(builder.digest), 'admitted builder digest');
  requireEvidence(Array.isArray(admittedBuilders) && admittedBuilders.includes(builder.digest),
    'unadmitted builder refuses before build');
  requireEvidence(Array.isArray(builder.inventory) && !builder.inventory.some((entry) => PYTHON_ENTRY.test(entry)),
    'Python in builder image refuses before build');
  requireEvidence(isDigest(recipeDigest), 'reviewed recipe digest');
  requireEvidence(target && COHORT_KEYS.includes(target.key), 'cohort target required');
  requireEvidence(target.sourceSha === sourceSha, 'target source SHA mismatch');
  requireEvidence(target.platform === policy.platform && isDigest(target.configDigest), 'target platform/config');
  requireEvidence(/@sha256:[a-f0-9]{64}$/.test(target.ref || ''), 'immutable digest target ref required');
  requireEvidence(env && typeof env === 'object' && !Array.isArray(env), 'builder env');
  for (const [name, value] of Object.entries(env)) {
    requireEvidence(name !== 'DOCKER_CONFIG', `registry config inheritance via env: ${name}`);
    requireEvidence(!CREDENTIAL_ENV.test(name), `credential env key: ${name}`);
    requireEvidence(typeof value === 'string' && !/\.docker|config\.json/i.test(value), `registry config inheritance via env: ${name}`);
  }
  requireEvidence(Array.isArray(mounts) && mounts.length > 0, 'builder mounts');
  for (const mount of mounts) {
    requireEvidence(mount && typeof mount.src === 'string' && isAbsolute(mount.src), 'absolute mount source');
    requireEvidence(!SOCKET_PATH.test(mount.src) && !SOCKET_PATH.test(mount.dst || ''), 'shared daemon socket mount refuses');
    requireEvidence(!HOST_ESCAPE_ROOTS.has(mount.src), `host escape mount: ${mount.src}`);
    requireEvidence(!/\.docker|config\.json$/i.test(mount.src), 'registry config inheritance via mount');
    requireEvidence(ALLOWED_MOUNT_ROOTS.some((root) => mount.src === root || mount.src.startsWith(`${root}/`)),
      `mount outside allowed roots: ${mount.src}`);
    if (mount.src === '/workspace') requireEvidence(mount.readonly === true, 'read-only source mount required');
  }
  const args = ['run', '--rm', '--pull=never', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
    '--network', 'none', '--user', '65532:65532', '--pids-limit', '128', '--memory', '4g', '--cpus', '1',
    ...mounts.flatMap((mount) => ['--mount',
      `type=bind,src=${mount.src},dst=${mount.dst},${mount.readonly ? 'readonly' : 'rw'}`]),
    '--env', 'HOME=/tmp', '--env', 'PATH=/usr/bin:/bin',
    `${builder.digest}`, 'build', '--recipe', recipeDigest, '--source-sha', sourceSha, '--target', target.key];
  return { command: 'docker', args, builderDigest: builder.digest, recipeDigest, sourceSha,
    target, mounts, env: { HOME: '/tmp', PATH: '/usr/bin:/bin' } };
}

// L5-C: the rebuild produces a newly verified source/target receipt from the
// trusted builder. A forged receipt, swapped producer run/attempt or a
// source-controlled receipt cannot stand in for it.
export function validateRebuildReceipt(receipt, { sourceSha, target, builderDigest, runId, runAttempt }) {
  requireEvidence(receipt && typeof receipt === 'object', 'rebuild receipt');
  requireEvidence(receipt.schemaVersion === 1, 'receipt schema');
  requireEvidence(receipt.origin === 'trusted-builder', 'source-controlled receipt refuses');
  requireEvidence(receipt.builderDigest === builderDigest && isDigest(builderDigest), 'builder identity');
  requireEvidence(receipt.sourceSha === sourceSha, 'receipt source SHA');
  requireEvidence(receipt.target?.key === target.key && receipt.target?.configDigest === target.configDigest,
    'receipt target config');
  requireEvidence(isDigest(receipt.outputDigest), 'output archive digest');
  requireEvidence(receipt.runId === String(runId) && receipt.runAttempt === Number(runAttempt), 'run/attempt binding');
  const { receiptHash, ...body } = receipt;
  requireEvidence(isDigest(receiptHash) && receiptHash === digest(JSON.stringify(body)), 'forged receipt refuses');
  return true;
}
