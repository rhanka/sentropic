import { createHash } from 'node:crypto';
import { candidateDigest } from '@sentropic/artifacts/live-host';
import type { CacheReceipt, DependencyFile } from './cache';
import { safeDependencyPath } from './integrity';
import type { DraftSnapshot, SourceSnapshot } from './ports';
import { conflict, LiveError, type LiveAttempt, type LiveRuntime } from './records';
import { artifactEnvironment, BUILD_RECIPE, LIVE_RECIPE } from './recipes';
import type { QualifiedSupervisor } from './worker';
import { createSupervisorChannel, failure, type ChannelOptions } from './supervisor-channel';
import { createCleanInstall } from './supervisor-install';
import { OUTPUT_LIMITS, TREE_LIMITS, type TransferFile } from './supervisor-transfer';

/** Trusted byte sources: the pod has no egress (W2 §1), so the supervisor pushes every byte it needs. */
export interface SupervisorSources {
  /** Path-filtered staged tree of one snapshot; no forge credentials or environment files. */
  source(stagingRef: string): Promise<readonly TransferFile[]>;
  /** AL-D: the complete overlay of this exact draft revision. Draft-store credentials never reach the pod. */
  draft(runtime: LiveRuntime, draft: DraftSnapshot): Promise<{ files: readonly TransferFile[]; deletes: readonly string[] }>;
  /** Verified cache read that rechecks seal and tree hash on every use (dependency cache `materialize`). */
  dependencies(receipt: CacheReceipt): Promise<readonly DependencyFile[]>;
  /** Trusted sink of the sealed candidate bytes for the SG4b upload; publication authority stays outside the pod. */
  candidate(input: { runtime: LiveRuntime; attempt: LiveAttempt; candidateDigest: string; files: readonly TransferFile[] }): Promise<void>;
}
export interface SupervisorOptions extends ChannelOptions { sources: SupervisorSources }

const WRITABLE_ROOTS = new Set(['/workspace', '/dependencies', '/tmp']);
const HOST_FILES = new Set(['/tmp/artifact-vite.config.mjs', '/tmp/host-npmrc', '/tmp/host-global-npmrc']);
const MAX_HOST_FILE_BYTES = 64 * 1024;
/** A-LIVE §3.2: a saved overlay holds at most 255 changed/deleted paths and 8 MiB; a live text file 1 MiB. */
const OVERLAY_LIMITS = Object.freeze({ files: 255, fileBytes: 1024 * 1024, totalBytes: 8 * 1024 * 1024 });
const OUTPUT_ENTRY = 'index.html';
const LOCKFILE = 'package-lock.json';
const DIGEST = /^[a-f0-9]{64}$/;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
function unavailable(reason?: string): never { throw new LiveError('builder_unavailable', reason); }
const stagingFailure = failure('builder_unavailable', 'staging_invalid');
const outputFailure = failure('builder_unavailable', 'output_invalid');
const cacheFailure = failure('dependency_cache_invalid');

export function createSupervisorTransport(options: SupervisorOptions) {
  const core = createSupervisorChannel(options);
  const { call, transfer, snapshot } = core;
  /** The stable output with the single shared candidate digest; a set that digest refuses is an invalid output. */
  async function output(runtime: LiveRuntime) {
    const files = await snapshot(runtime, 'output', OUTPUT_LIMITS, 'refuse', outputFailure);
    if (!files.some(file => file.path === OUTPUT_ENTRY)) unavailable('output_invalid');
    try { return { files, digest: candidateDigest(files) }; } catch { return unavailable('output_invalid'); }
  }
  async function terminate(runtime: LiveRuntime) {
    if ((await call(runtime, 'terminate', {})).treeGone !== true) unavailable();
  }

  const supervisor: QualifiedSupervisor = {
    /** W2 §1: workers have no egress in any phase, so the fence is static policy (Q1 receipts); the pod echoes its phase. */
    async phase(runtime, phase) {
      if ((await call(runtime, 'phase', { phase })).phase !== phase) unavailable();
    },
    terminate,
    async clear(runtime, paths) {
      if (!paths.length || new Set(paths).size !== paths.length || !paths.every(path => WRITABLE_ROOTS.has(path))) unavailable();
      if (!same((await call(runtime, 'clear', { paths: [...paths] })).cleared, paths)) unavailable();
    },
    async stage(runtime, source: SourceSnapshot) {
      const files = await options.sources.source(source.stagingRef);
      const lock = files.find(file => file.path === LOCKFILE);
      if (!lock || !Buffer.from(lock.bytes).equals(Buffer.from(source.lockfile))) unavailable('staging_invalid');
      const sent = await transfer(runtime, 'workspace', files, TREE_LIMITS, stagingFailure);
      const data = await call(runtime, 'stage', { ...sent, headSha: source.headSha, treeSha: source.treeSha });
      if (data.treeDigest !== sent.treeDigest) unavailable();
    },
    async dependencies(runtime, cache, mode) {
      if (mode.readOnly !== true || mode.verifyHash !== true) unavailable();
      const files = (await options.sources.dependencies(cache)).map(file => {
        if (file.type !== 'file') cacheFailure('invalid');
        return { path: file.path, mode: file.mode === 365 ? 0o555 : 0o444, bytes: Buffer.from(file.bytes, 'base64') };
      });
      const sent = await transfer(runtime, 'dependencies', files, TREE_LIMITS, cacheFailure);
      const data = await call(runtime, 'dependencies', { ...sent, cacheKey: cache.key, cacheTree: cache.treeSha256, readOnly: true });
      if (data.treeDigest !== sent.treeDigest || data.readOnly !== true) unavailable();
    },
    /** Atomic projection: the pod applies every create/replace/delete of this revision or none of them. */
    async overlay(runtime, draft) {
      if (draft.generation !== runtime.generation) conflict('stale_fence');
      const { files, deletes } = await options.sources.draft(runtime, draft);
      if (!Array.isArray(deletes) || new Set(deletes).size !== deletes.length
        || deletes.some(path => !safeDependencyPath(path) || files.some(file => file.path === path))) unavailable('staging_invalid');
      if (files.length + deletes.length > OVERLAY_LIMITS.files) throw new LiveError('limit_exceeded');
      const sent = await transfer(runtime, 'overlay', files, OVERLAY_LIMITS, stagingFailure);
      const data = await call(runtime, 'overlay', { ...sent, deletes: [...deletes], revision: draft.revision,
        generation: draft.generation, baseHeadSha: draft.baseHeadSha, treeSha: draft.treeSha });
      if (data.revision !== draft.revision || data.treeDigest !== sent.treeDigest) unavailable();
    },
    async hostFile(runtime, path, source) {
      if (!HOST_FILES.has(path) || typeof source !== 'string' || Buffer.byteLength(source) > MAX_HOST_FILE_BYTES) unavailable();
      if ((await call(runtime, 'hostFile', { path, source })).sha256 !== sha256(source)) unavailable();
    },
    /** Recipes cross the wire by name only; the bootstrap runs its frozen copy with the host-owned environment. */
    async dev(runtime, command, env) {
      if (!same(command, LIVE_RECIPE) || !same(env, artifactEnvironment())) unavailable();
      const data = await call(runtime, 'dev', { recipe: 'live' });
      if (data.routeEpoch !== runtime.routeEpoch) return Number.isSafeInteger(data.routeEpoch) ? conflict('stale_fence') : unavailable();
      if (typeof data.revision !== typeof runtime.sourceRevision) unavailable();
      return { revision: data.revision as LiveRuntime['sourceRevision'], routeEpoch: runtime.routeEpoch };
    },
    /** A-LIVE §8.3: read the stable output only after the build tree is gone, and seal the digest computed here. */
    async build(runtime, attempt, command, env) {
      if (!same(command, BUILD_RECIPE) || !same(env, artifactEnvironment())) unavailable();
      const data = await call(runtime, 'build', { recipe: 'build', attemptId: attempt.id, headSha: attempt.headSha, treeSha: attempt.treeSha });
      if (data.exitCode !== 0) unavailable('build_failed');
      await terminate(runtime);
      const { files, digest } = await output(runtime);
      await options.sources.candidate({ runtime, attempt, candidateDigest: digest, files });
      return { candidateDigest: digest };
    },
    async verify(runtime, attempt, limits) {
      if (!same(limits, OUTPUT_LIMITS) || typeof attempt.candidateDigest !== 'string' || !DIGEST.test(attempt.candidateDigest)) unavailable();
      if ((await output(runtime)).digest !== attempt.candidateDigest) unavailable('output_changed');
    },
  };
  return { ...supervisor, cleanInstall: createCleanInstall(core, options.sources.source) };
}
