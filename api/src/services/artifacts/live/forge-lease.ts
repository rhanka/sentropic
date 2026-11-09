import { randomUUID } from 'node:crypto';
import type { ForgeReads } from './forge';
import { admitBinding, unconfigured, type BuilderRepository, type ForgeBinding, type ForgeBindings, type ForgeConfig } from './forge-binding';
import { readForgeTarball, unstable, type ForgeTree } from './forge-tar';
import { GB1_QUALIFICATION_PATH } from './gb1-qualification';
import { sha256 } from './integrity';
import type { LiveStore, SourceSnapshot } from './ports';
import { LiveError, type LiveKey } from './records';
import { CODELOAD, createLeasedGitHub, discard, field, FORGE_TIMEOUTS, json, unavailable, USER_AGENT } from './forge-github';
import { BUILDER_IMAGE, BUILDER_TOOLCHAIN, INSTALL_RECIPE, NPM_RELAY } from './recipes';

/** Staged manifests: bounded in-memory map, 30 min TTL, least recently used 8 entries. */
export const STAGING = Object.freeze({ ttlMs: 30 * 60_000, entries: 8 });
const SHA = /^[0-9a-f]{40}$/;
interface Target { key: LiveKey; repository: BuilderRepository; binding: ForgeBinding }
interface Row { path: string; mode: number; size: number; sha256: string }
interface Staged { target: Target; sha: string; manifest: Row[]; expiresAt: number }
const rowsOf = (tree: ForgeTree): Row[] => tree.files.map(f => ({ path: f.path, mode: f.mode, size: f.bytes.byteLength,
  sha256: sha256(f.bytes) })).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

/** Generation of the forge reads (R1): the controller's current runtime for the key (build-only: the job generation;
 * live: the binding generation); a DORMANT or absent runtime falls back to the host's last reconcile (`remote.session`). */
export const runtimeGeneration = (store: Pick<LiveStore, 'read'>, session: (key: LiveKey) => Promise<{ generation: number }>) =>
  async (key: LiveKey) => {
    const runtime = (await store.read(key))?.runtime;
    return runtime && runtime.phase !== 'DORMANT' ? runtime.generation : (await session(key)).generation;
  };

/**
 * Forge reads through the in-process SG0-app lease (contract §3-§4): GET only, the stored binding of the runtime
 * generation (`runtimeGeneration`), and a `contents: write` token used read-only that never leaves this module (no log, no error,
 * no returned value). Fail-closed: no configuration or no recorded binding refuses `forge_unconfigured`.
 */
export function createLeaseForgeReads(options: {
  config: ForgeConfig | null; bindings: Pick<ForgeBindings, 'read'>;
  /** Binding generation of the forge reads (`runtimeGeneration`). */
  generation(key: LiveKey): Promise<number>;
  fetch?: typeof fetch; now?: () => number; id?: () => string;
}): ForgeReads & { close(): void } {
  const { config } = options;
  const now = options.now ?? Date.now; const id = options.id ?? randomUUID;
  const staging = new Map<string, Staged>();
  const client = config ? createLeasedGitHub({ config, fetch: options.fetch ?? fetch, now }) : null;
  const github: ReturnType<typeof createLeasedGitHub>['github'] = (...args) => client!.github(...args);

  async function target(key: LiveKey): Promise<Target> {
    if (!config) return unconfigured();
    const binding = await options.bindings.read(key, await options.generation(key));
    if (!binding) return unconfigured();
    return { key, binding, repository: admitBinding(config, key.storageScopeId, binding) };
  }
  async function headOf(t: Target): Promise<string> {
    const branch = t.binding.branch;
    const response = await github(t.repository, `/git/ref/heads/${branch.split('/').map(encodeURIComponent).join('/')}`,
      AbortSignal.timeout(FORGE_TIMEOUTS.callMs));
    if (response.status === 404) { await discard(response); throw new LiveError('git_branch_missing'); }
    const body = await json(response); const sha = field(body.object, 'sha');
    return body.ref === `refs/heads/${branch}` && typeof sha === 'string' && SHA.test(sha) ? sha : unavailable();
  }
  /** The tarball of `sha` through at most one redirect, to codeload only, then the filtered tree. */
  async function tree(t: Target, sha: string): Promise<ForgeTree> {
    const signal = AbortSignal.timeout(FORGE_TIMEOUTS.tarballMs);
    let response = await github(t.repository, `/tarball/${sha}`, signal);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location') ?? ''; await discard(response);
      if (!location.startsWith(CODELOAD)) return unavailable();
      response = await client!.get(location, { 'user-agent': USER_AGENT }, signal);
    }
    if (response.status !== 200 || !response.body) { await discard(response); return unavailable(); }
    return readForgeTarball(response.body, t.binding.subPath);
  }
  function staged(ref: string): Staged {
    const entry = staging.get(ref);
    staging.delete(ref);
    if (!entry || now() >= entry.expiresAt) return unavailable();
    staging.set(ref, entry);
    return entry;
  }
  function stage(entry: Staged): string {
    for (const [ref, old] of staging) if (now() >= old.expiresAt) staging.delete(ref);
    const ref = id(); staging.set(ref, entry);
    while (staging.size > STAGING.entries) staging.delete(staging.keys().next().value!);
    return ref;
  }
  return {
    close: () => client?.close(),
    head: async key => headOf(await target(key)),
    async reachable(key, sha) {
      if (typeof sha !== 'string' || !SHA.test(sha)) return false;
      const t = await target(key); const headSha = await headOf(t);
      const response = await github(t.repository, `/compare/${sha}...${headSha}?per_page=1`,
        AbortSignal.timeout(FORGE_TIMEOUTS.callMs));
      if (response.status === 404) { await discard(response); return false; }
      const status = (await json(response)).status;
      if (status === 'ahead' || status === 'identical') return true;
      return status === 'behind' || status === 'diverged' ? false : unavailable();
    },
    async snapshot(key, sha): Promise<SourceSnapshot> {
      if (typeof sha !== 'string' || !SHA.test(sha)) return unavailable();
      const t = await target(key);
      const commit = await json(await github(t.repository, `/git/commits/${sha}`, AbortSignal.timeout(FORGE_TIMEOUTS.callMs)));
      const treeSha = field(commit.tree, 'sha');
      if (commit.sha !== sha || typeof treeSha !== 'string' || !SHA.test(treeSha)) return unavailable();
      const files = await tree(t, sha);
      const lock = files.files.find(file => file.path === 'package-lock.json');
      if (!lock) throw new LiveError('lock_missing');
      const stagingRef = stage({ target: t, sha, manifest: rowsOf(files), expiresAt: now() + STAGING.ttlMs });
      const topology = files.files.filter(f => f.path === 'package.json' || f.path.endsWith('/package.json')).map(f => f.path).sort();
      return { headSha: sha, treeSha, lockfile: lock.bytes, stagingRef, gb1: { subPath: t.binding.subPath, files: files.gb1 },
        cacheIdentity: { storageScopeId: key.storageScopeId, repoId: t.binding.repoId, lockSha256: sha256(lock.bytes),
          platform: BUILDER_TOOLCHAIN.platform, nodeVersion: BUILDER_TOOLCHAIN.nodeVersion,
          npmVersion: BUILDER_TOOLCHAIN.npmVersion, image: BUILDER_IMAGE,
          policyRevision: sha256(JSON.stringify([INSTALL_RECIPE, NPM_RELAY])), workspaceTopology: sha256(JSON.stringify(topology)),
          integrityDigest: sha256(files.gb1[GB1_QUALIFICATION_PATH] ?? '') } };
    },
    /** Re-downloads the recorded commit and returns its files only when every row equals the staged manifest. */
    async source(stagingRef) {
      const entry = staged(stagingRef);
      const again = await tree(entry.target, entry.sha); const rows = rowsOf(again);
      if (rows.length !== entry.manifest.length || rows.some((row, i) => {
        const m = entry.manifest[i]!;
        return row.path !== m.path || row.mode !== m.mode || row.size !== m.size || row.sha256 !== m.sha256;
      })) return unstable('source_changed');
      return again.files;
    },
  };
}
