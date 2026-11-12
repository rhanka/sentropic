import { createHash } from 'node:crypto';
import type { CachePorts } from './cache';
import type { IntegrityPin } from './integrity';
import { verifySri } from './integrity';
import { classifyRecipeFailure, readRecipeDiagnostics } from './recipe-diagnostics';
import { LiveError, type LiveRuntime } from './records';
import { isInstallRecipe } from './recipes';
import { failure, type SupervisorCore } from './supervisor-channel';
import { runInstallStep, type InstallStepLogger } from './deadline';
import { TREE_LIMITS, type TransferFile } from './supervisor-transfer';

const LOCKFILE = 'package-lock.json';
/** Relay tarballs are bounded at 64 MiB each (npm-relay.ts); the pod scratch bounds the whole set (immo: 171 MiB). */
const TARBALL_LIMITS = Object.freeze({ files: 65_536, fileBytes: 64 * 1024 * 1024, totalBytes: 512 * 1024 * 1024 });
const stagingFailure = failure('builder_unavailable', 'staging_invalid');
const cacheFailure = failure('dependency_cache_invalid');
function unavailable(reason?: string): never { throw new LiveError('builder_unavailable', reason); }

/** Manifest closure for a prewarm seal (§7.1.6.1): root + workspace manifests only (kilobytes, no full
 * source tree). `npm ci --offline` reads only these; the 187 MiB source transfer becomes ~0 on the seal path. */
function sealManifests(files: readonly TransferFile[]): TransferFile[] {
  return files.filter(file => file.path === 'package.json' || file.path === 'package-lock.json'
    || file.path.endsWith('/package.json'));
}
/** W2 §2 clean installer: the trusted cache fetches and verifies each tarball; the supervisor streams them into
 * the pod npm cache (the bootstrap writes each one content-addressed by its integrity after re-verifying it) and
 * runs the frozen `npm ci --offline` with hooks disabled. A missing entry fails closed with
 * dependency_integrity_missing; the worker never fetches. Only regular dependency files are exported, each handed to the
 * cache sink as soon as it is read: the API holds one tarball or one installed file at a time. */
export function createCleanInstall(core: SupervisorCore,
  source: (stagingRef: string) => Promise<readonly TransferFile[]>,
  options: { log?: InstallStepLogger; now?: () => number } = {}): CachePorts['cleanInstall'] {
  async function clear(runtime: LiveRuntime, signal?: AbortSignal) {
    if (JSON.stringify((await core.call(runtime, 'clear', { paths: ['/tmp'] }, { signal })).cleared) !== '["/tmp"]') unavailable('install_clean_unconfirmed');
  }
  return async input => {
    const runtime = input.runtime;
    const signal = input.signal;
    const workspaces = [...(input.identity.installWorkspaces ?? [])].sort();
    if (!runtime || !isInstallRecipe(input.recipe, workspaces)) unavailable('install_recipe_invalid');
    signal?.throwIfAborted();
    const files = await runInstallStep(input.progress, 'forge_redownload', () => source(input.stagingRef),
      { signal, log: options.log, now: options.now,
        counts: tree => ({ files: tree?.length ?? 0,
          bytes: (tree ?? []).reduce((total, file) => total + file.bytes.byteLength, 0) }) });
    signal?.throwIfAborted();
    const lock = files.find(file => file.path === LOCKFILE);
    if (!lock || !Buffer.from(lock.bytes).equals(Buffer.from(input.lockfile))) unavailable('staging_invalid');
    await runInstallStep(input.progress, 'clear', () => clear(runtime, signal),
      { signal, log: options.log, now: options.now });
    // Every sent frame and drained page reports progress, so a large source tree or tarball never trips the stall
    // watchdog mid-transfer; the abort signal cuts a superseded install at the next frame or file instead of
    // leaving it running against a pod the teardown already deleted.
    const bounds = { signal, onProgress: () => input.progress?.report() };
    // Pipelined source transfer (§7.2.1): same frames and digest, up to 8 puts in flight.
    const sourceSent = await runInstallStep(input.progress, 'source_transfer',
      () => core.streamPipelined(runtime, 'install', files, TREE_LIMITS, stagingFailure, bounds),
      { signal, log: options.log, now: options.now,
        counts: () => ({ files: files.length,
          bytes: files.reduce((total, file) => total + file.bytes.byteLength, 0) }) });
    const staged: { path: string; integrity: string }[] = [];
    let streamBytes = 0;
    async function* tarballs(items: AsyncIterable<{ pin: IntegrityPin; bytes: Uint8Array }>) {
      for await (const tarball of items) {
        signal?.throwIfAborted();
        verifySri(tarball.bytes, tarball.pin.integrity);
        const path = `${staged.length}.tgz`;
        staged.push({ path, integrity: tarball.pin.integrity });
        streamBytes += tarball.bytes.byteLength;
        input.progress?.report();
        yield { path, mode: 0o444, bytes: tarball.bytes };
      }
    }
    const cacheSent = await runInstallStep(input.progress, 'tarball_stream',
      () => core.streamPipelined(runtime, 'npm-cache', tarballs(input.tarballs), TARBALL_LIMITS,
        failure('dependency_integrity_missing'), bounds),
      { signal, log: options.log, now: options.now, counts: () => ({ files: staged.length, bytes: streamBytes }) });
    const runId = core.id();
    // The offline `npm ci` emits no observable progress; the stall timer suspends across it (the ceiling still
    // applies) and resumes for the drain below.
    input.progress?.suspendStall(true);
    try {
      const data = await runInstallStep(input.progress, 'recipe',
        () => core.call(runtime, 'install', { recipe: 'install', runId, source: sourceSent, cache: cacheSent,
          tarballs: staged, workspaces }, { signal }),
        { signal, log: options.log, now: options.now });
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
    let drainFiles = 0;
    let drainBytes = 0;
    await runInstallStep(input.progress, 'drain',
      () => core.drain(runtime, 'dependencies', TREE_LIMITS, 'skip', cacheFailure, async file => {
        drainFiles += 1;
        drainBytes += file.bytes.byteLength;
        await input.sink({ path: file.path, mode: file.mode & 0o111 ? 365 : 292, bytes: file.bytes });
        input.progress?.report();
      }, bounds),
      { signal, log: options.log, now: options.now, counts: () => ({ files: drainFiles, bytes: drainBytes }) });
    await runInstallStep(input.progress, 'cleanup', () => clear(runtime, signal),
      { signal, log: options.log, now: options.now });
    return { runId };
  };
}
/** Prewarm-only in-pod seal (§7.1.2 production, §7.1.6.1-4): stages only the manifest closure (no full source),
 * installs offline, then seals in-pod (`sealDependencies` tars `/tmp/install` node_modules once; `sealFetch`
 * pages the one archive back). No `forge_redownload`, no `source_transfer`, no per-file `drain` — one archive
 * out, one S3 PUT in `cache.seal`. The API holds at most one manifest set plus one archive chunk (768 KiB). */
export function createSealInstall(core: SupervisorCore,
  source: (stagingRef: string) => Promise<readonly TransferFile[]>,
  options: { log?: InstallStepLogger; now?: () => number } = {}): CachePorts['sealInstall'] {
  async function clear(runtime: LiveRuntime, signal?: AbortSignal) {
    if (JSON.stringify((await core.call(runtime, 'clear', { paths: ['/tmp'] }, { signal })).cleared) !== '["/tmp"]') unavailable('install_clean_unconfirmed');
  }
  return async input => {
    const runtime = input.runtime;
    const signal = input.signal;
    const workspaces = [...(input.identity.installWorkspaces ?? [])].sort();
    if (!runtime || !isInstallRecipe(input.recipe, workspaces)) unavailable('install_recipe_invalid');
    signal?.throwIfAborted();
    const full = await runInstallStep(input.progress, 'forge_snapshot', () => source(input.stagingRef),
      { signal, log: options.log, now: options.now,
        counts: tree => ({ files: tree?.length ?? 0,
          bytes: (tree ?? []).reduce((total, file) => total + file.bytes.byteLength, 0) }) });
    signal?.throwIfAborted();
    const lock = full.find(file => file.path === LOCKFILE);
    if (!lock || !Buffer.from(lock.bytes).equals(Buffer.from(input.lockfile))) unavailable('staging_invalid');
    const manifests = sealManifests(full);
    if (!manifests.some(file => file.path === LOCKFILE)) unavailable('staging_invalid');
    await runInstallStep(input.progress, 'clear', () => clear(runtime, signal),
      { signal, log: options.log, now: options.now });
    const bounds = { signal, onProgress: () => input.progress?.report() };
    const manifestSent = await runInstallStep(input.progress, 'manifest_transfer',
      () => core.streamPipelined(runtime, 'install', manifests, TREE_LIMITS, stagingFailure, bounds),
      { signal, log: options.log, now: options.now,
        counts: () => ({ files: manifests.length,
          bytes: manifests.reduce((total, file) => total + file.bytes.byteLength, 0) }) });
    const staged: { path: string; integrity: string }[] = [];
    let streamBytes = 0;
    async function* tarballs(items: AsyncIterable<{ pin: IntegrityPin; bytes: Uint8Array }>) {
      for await (const tarball of items) {
        signal?.throwIfAborted();
        verifySri(tarball.bytes, tarball.pin.integrity);
        const path = `${staged.length}.tgz`;
        staged.push({ path, integrity: tarball.pin.integrity });
        streamBytes += tarball.bytes.byteLength;
        input.progress?.report();
        yield { path, mode: 0o444, bytes: tarball.bytes };
      }
    }
    const cacheSent = await runInstallStep(input.progress, 'tarball_stream',
      () => core.streamPipelined(runtime, 'npm-cache', tarballs(input.tarballs), TARBALL_LIMITS,
        failure('dependency_integrity_missing'), bounds),
      { signal, log: options.log, now: options.now, counts: () => ({ files: staged.length, bytes: streamBytes }) });
    const runId = core.id();
    input.progress?.suspendStall(true);
    try {
      const data = await runInstallStep(input.progress, 'recipe',
        () => core.call(runtime, 'install', { recipe: 'install', runId, source: manifestSent, cache: cacheSent,
          tarballs: staged, workspaces }, { signal }),
        { signal, log: options.log, now: options.now });
      const diagnostics = readRecipeDiagnostics(data);
      if (!diagnostics || (diagnostics.exitCode === 0 && diagnostics.signal !== null)) unavailable('install_unconfirmed');
      if (diagnostics.exitCode !== 0) {
        const detail = diagnostics.output === '' ? undefined : diagnostics.output;
        throw new LiveError('builder_unavailable', `install_failed:${classifyRecipeFailure(diagnostics)}`, detail);
      }
    } finally { input.progress?.suspendStall(false); }
    signal?.throwIfAborted();
    let archiveBytes = 0; let archiveFiles = 0;
    const sealed = await runInstallStep(input.progress, 'seal_archive',
      async () => {
        const done = await core.call(runtime, 'sealDependencies', {}, { signal }) as { files: unknown; bytes: unknown;
          archiveBytes: unknown; archiveSha256: unknown; treeSha256: unknown };
        if (!Number.isSafeInteger(done.files) || !Number.isSafeInteger(done.bytes)
          || !Number.isSafeInteger(done.archiveBytes) || typeof done.archiveSha256 !== 'string'
          || typeof done.treeSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(done.archiveSha256)
          || !/^[a-f0-9]{64}$/.test(done.treeSha256)) unavailable('install_unconfirmed');
        const chunks: Uint8Array[] = []; let cursor: number | null = 0;
        while (cursor !== null) {
          signal?.throwIfAborted();
          const page = await core.call(runtime, 'sealFetch', { cursor }, { signal }) as { data: unknown; next: unknown; size: unknown };
          if (typeof page.data !== 'string' || (page.next !== null && !Number.isSafeInteger(page.next))
            || !Number.isSafeInteger(page.size)) unavailable('install_unconfirmed');
          const bytes = Buffer.from(page.data, 'base64');
          if (bytes.toString('base64') !== page.data) unavailable('install_unconfirmed');
          chunks.push(bytes);
          input.progress?.report();
          cursor = page.next as number | null;
        }
        const archive = Buffer.concat(chunks);
        if (archive.byteLength !== done.archiveBytes
          || createHashSha256(archive) !== done.archiveSha256) unavailable('install_unconfirmed');
        archiveBytes = archive.byteLength; archiveFiles = done.files as number;
        return { archive, treeSha256: done.treeSha256 as string };
      },
      { signal, log: options.log, now: options.now, counts: () => ({ files: archiveFiles, bytes: archiveBytes }) });
    await runInstallStep(input.progress, 'cleanup', () => clear(runtime, signal),
      { signal, log: options.log, now: options.now });
    return { runId, archive: sealed.archive, treeSha256: sealed.treeSha256, files: archiveFiles, bytes: archiveBytes };
  };
}
function createHashSha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
