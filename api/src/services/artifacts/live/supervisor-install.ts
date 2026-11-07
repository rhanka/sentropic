import type { CachePorts } from './cache';
import { verifySri } from './integrity';
import { LiveError, type LiveRuntime } from './records';
import { INSTALL_RECIPE } from './recipes';
import { failure, type SupervisorCore } from './supervisor-channel';
import { TREE_LIMITS, type TransferFile } from './supervisor-transfer';

const LOCKFILE = 'package-lock.json';
/** Relay tarballs are bounded at 64 MiB each (npm-relay.ts); the pod scratch bounds the whole set. */
const TARBALL_LIMITS = Object.freeze({ files: 65_536, fileBytes: 64 * 1024 * 1024, totalBytes: 512 * 1024 * 1024 });
const stagingFailure = failure('builder_unavailable', 'staging_invalid');
const cacheFailure = failure('dependency_cache_invalid');
function unavailable(reason?: string): never { throw new LiveError('builder_unavailable', reason); }

/** W2 §2 clean installer: the trusted cache fetched and verified every tarball; the supervisor stages them into
 * the pod npm cache (the bootstrap writes each one content-addressed by its integrity after re-verifying it) and
 * runs the frozen `npm ci --offline` with hooks disabled. A missing entry fails closed with
 * dependency_integrity_missing; the worker never fetches. Only regular dependency files are exported. */
export function createCleanInstall(core: SupervisorCore,
  source: (stagingRef: string) => Promise<readonly TransferFile[]>): CachePorts['cleanInstall'] {
  async function clear(runtime: LiveRuntime) {
    if (JSON.stringify((await core.call(runtime, 'clear', { paths: ['/tmp'] })).cleared) !== '["/tmp"]') unavailable();
  }
  return async input => {
    const runtime = input.runtime;
    if (!runtime || JSON.stringify(input.recipe) !== JSON.stringify(INSTALL_RECIPE)) unavailable();
    const files = await source(input.stagingRef);
    const lock = files.find(file => file.path === LOCKFILE);
    if (!lock || !Buffer.from(lock.bytes).equals(Buffer.from(input.lockfile))) unavailable('staging_invalid');
    const tarballs = input.tarballs.map((tarball, index) => {
      verifySri(tarball.bytes, tarball.pin.integrity);
      return { file: { path: `${index}.tgz`, mode: 0o444, bytes: tarball.bytes }, integrity: tarball.pin.integrity };
    });
    await clear(runtime);
    const sourceSent = await core.transfer(runtime, 'install', files, TREE_LIMITS, stagingFailure);
    const cacheSent = await core.transfer(runtime, 'npm-cache', tarballs.map(t => t.file), TARBALL_LIMITS,
      failure('dependency_integrity_missing'));
    const runId = core.id();
    const data = await core.call(runtime, 'install', { recipe: 'install', runId, source: sourceSent, cache: cacheSent,
      tarballs: tarballs.map(t => ({ path: t.file.path, integrity: t.integrity })) });
    if (data.exitCode !== 0) unavailable('install_failed');
    // npm bin and workspace links are re-derived at materialization; only regular files enter the cache.
    const exported = await core.snapshot(runtime, 'dependencies', TREE_LIMITS, 'skip', cacheFailure);
    await clear(runtime);
    return { runId, files: exported.map(file => ({ path: file.path, type: 'file' as const,
      mode: file.mode & 0o111 ? 365 as const : 292 as const, bytes: Buffer.from(file.bytes).toString('base64') })) };
  };
}
