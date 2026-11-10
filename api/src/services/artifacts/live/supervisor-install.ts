import type { CachePorts } from './cache';
import type { IntegrityPin } from './integrity';
import { verifySri } from './integrity';
import { classifyRecipeFailure, readRecipeDiagnostics } from './recipe-diagnostics';
import { LiveError, type LiveRuntime } from './records';
import { isInstallRecipe } from './recipes';
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
  async function clear(runtime: LiveRuntime, signal?: AbortSignal) {
    if (JSON.stringify((await core.call(runtime, 'clear', { paths: ['/tmp'] }, { signal })).cleared) !== '["/tmp"]') unavailable('install_clean_unconfirmed');
  }
  return async input => {
    const runtime = input.runtime;
    const signal = input.signal;
    const workspaces = [...(input.identity.installWorkspaces ?? [])].sort();
    if (!runtime || !isInstallRecipe(input.recipe, workspaces)) unavailable('install_recipe_invalid');
    signal?.throwIfAborted();
    const files = await source(input.stagingRef);
    signal?.throwIfAborted();
    const lock = files.find(file => file.path === LOCKFILE);
    if (!lock || !Buffer.from(lock.bytes).equals(Buffer.from(input.lockfile))) unavailable('staging_invalid');
    await clear(runtime, signal);
    // Every sent frame and drained page reports progress, so a large source tree or tarball never trips the stall
    // watchdog mid-transfer; the abort signal cuts a superseded install at the next frame or file instead of
    // leaving it running against a pod the teardown already deleted.
    const bounds = { signal, onProgress: () => input.progress?.report() };
    const sourceSent = await core.transfer(runtime, 'install', files, TREE_LIMITS, stagingFailure, bounds);
    const staged: { path: string; integrity: string }[] = [];
    async function* tarballs(items: AsyncIterable<{ pin: IntegrityPin; bytes: Uint8Array }>) {
      for await (const tarball of items) {
        signal?.throwIfAborted();
        verifySri(tarball.bytes, tarball.pin.integrity);
        const path = `${staged.length}.tgz`;
        staged.push({ path, integrity: tarball.pin.integrity });
        input.progress?.report();
        yield { path, mode: 0o444, bytes: tarball.bytes };
      }
    }
    const cacheSent = await core.stream(runtime, 'npm-cache', tarballs(input.tarballs), TARBALL_LIMITS,
      failure('dependency_integrity_missing'), bounds);
    const runId = core.id();
    // The offline `npm ci` emits no observable progress; the stall timer suspends across it (the ceiling still
    // applies) and resumes for the drain below.
    input.progress?.suspendStall(true);
    try {
      const data = await core.call(runtime, 'install', { recipe: 'install', runId, source: sourceSent, cache: cacheSent,
        tarballs: staged, workspaces }, { signal });
      // The pod returns its bounded scrubbed tail with the exit code and signal; the classified cause rides the
      // job reason while the tail stays a log-only detail, never ledger material.
      const diagnostics = readRecipeDiagnostics(data);
      if (!diagnostics || (diagnostics.exitCode === 0 && diagnostics.signal !== null)) unavailable('install_unconfirmed');
      if (diagnostics.exitCode !== 0) {
        const detail = diagnostics.output === '' ? undefined : diagnostics.output;
        throw new LiveError('builder_unavailable', `install_failed:${classifyRecipeFailure(diagnostics)}`, detail);
      }
    } finally { input.progress?.suspendStall(false); }
    signal?.throwIfAborted();
    // npm bin and workspace links are re-derived at materialization; only regular files enter the cache.
    await core.drain(runtime, 'dependencies', TREE_LIMITS, 'skip', cacheFailure, async file => {
      await input.sink({ path: file.path, mode: file.mode & 0o111 ? 365 : 292, bytes: file.bytes });
      input.progress?.report();
    }, bounds);
    await clear(runtime, signal);
    return { runId };
  };
}
