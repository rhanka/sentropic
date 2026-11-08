import type { CachePorts } from './cache';
import type { IntegrityPin } from './integrity';
import { verifySri } from './integrity';
import { LiveError, type LiveRuntime } from './records';
import { INSTALL_RECIPE } from './recipes';
import { failure, type SupervisorCore } from './supervisor-channel';
import { TREE_LIMITS, type TransferFile } from './supervisor-transfer';

const LOCKFILE = 'package-lock.json';
/** Relay tarballs are bounded at 64 MiB each (npm-relay.ts); the pod scratch bounds the whole set (immo: 171 MiB). */
const TARBALL_LIMITS = Object.freeze({ files: 65_536, fileBytes: 64 * 1024 * 1024, totalBytes: 512 * 1024 * 1024 });
const stagingFailure = failure('builder_unavailable', 'staging_invalid');
const cacheFailure = failure('dependency_cache_invalid');
function unavailable(reason?: string): never { throw new LiveError('builder_unavailable', reason); }

/** W2 §2 clean installer: the trusted cache fetches and verifies each tarball; the supervisor streams them into
 * the pod npm cache (the bootstrap writes each one content-addressed by its integrity after re-verifying it) and
 * runs the frozen `npm ci --offline` with hooks disabled. A missing entry fails closed with
 * dependency_integrity_missing; the worker never fetches. Only regular dependency files are exported, each handed to the
 * cache sink as soon as it is read: the API holds one tarball or one installed file at a time. */
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
    await clear(runtime);
    const sourceSent = await core.transfer(runtime, 'install', files, TREE_LIMITS, stagingFailure);
    const staged: { path: string; integrity: string }[] = [];
    async function* tarballs(items: AsyncIterable<{ pin: IntegrityPin; bytes: Uint8Array }>) {
      for await (const tarball of items) {
        verifySri(tarball.bytes, tarball.pin.integrity);
        const path = `${staged.length}.tgz`;
        staged.push({ path, integrity: tarball.pin.integrity });
        yield { path, mode: 0o444, bytes: tarball.bytes };
      }
    }
    const cacheSent = await core.stream(runtime, 'npm-cache', tarballs(input.tarballs), TARBALL_LIMITS,
      failure('dependency_integrity_missing'));
    const runId = core.id();
    const data = await core.call(runtime, 'install', { recipe: 'install', runId, source: sourceSent, cache: cacheSent,
      tarballs: staged });
    if (data.exitCode !== 0) unavailable('install_failed');
    // npm bin and workspace links are re-derived at materialization; only regular files enter the cache.
    await core.drain(runtime, 'dependencies', TREE_LIMITS, 'skip', cacheFailure, file =>
      input.sink({ path: file.path, mode: file.mode & 0o111 ? 365 : 292, bytes: file.bytes }));
    await clear(runtime);
    return { runId };
  };
}
