import { randomUUID } from 'node:crypto';
import type { ForgeReads } from './forge';
import { admitBinding, unconfigured, type BuilderRepository, type ForgeBinding, type ForgeBindings, type ForgeConfig } from './forge-binding';
import { FORGE_LIMITS, readForgeTarball, unstable, type ForgeTree } from './forge-tar';
import { GB1_QUALIFICATION_PATH } from './gb1-qualification';
import { validateWorkspaces } from './workspace-subset';
import { safeDependencyPath, sha256 } from './integrity';
import { extractTarZst, tarZst, type UstarMember } from './supervisor-transfer';
import { assertSourceRef, sourceFilterDigest, sourceUnitRef } from './cache-storage';
import type { LiveStore, SourceSnapshot } from './ports';
import { LiveError, type LiveKey } from './records';
import { CODELOAD, createLeasedGitHub, discard, field, FORGE_TIMEOUTS, json, unavailable, USER_AGENT } from './forge-github';
import { BUILDER_IMAGE, BUILDER_TOOLCHAIN, NPM_RELAY, installRecipeFor } from './recipes';

/** Staged manifests: bounded in-memory map, 30 min TTL, least recently used 8 entries. */
export const STAGING = Object.freeze({ ttlMs: 30 * 60_000, entries: 8 });
const SHA = /^[0-9a-f]{40}$/;
interface Target { key: LiveKey; repository: BuilderRepository; binding: ForgeBinding }
interface Row { path: string; mode: number; size: number; sha256: string }
interface Staged { target: Target; sha: string; manifest: Row[]; expiresAt: number }
const rowsOf = (tree: ForgeTree): Row[] => tree.files.map(f => ({ path: f.path, mode: f.mode, size: f.bytes.byteLength,
  sha256: sha256(f.bytes) })).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
/** GB1 read rule mirrored from readForgeTarball (GB1_NAMES there): descriptors, manifests, locks and the
 * qualification file, by repository path. Any drift is caught by the snapshot equivalence test. */
const GB1_BASENAMES = new Set(['package.json', 'package-lock.json', 'sentropic.artifact.json']);
/** Descriptor outputDir filter mirrored from withoutOutput (forge-tar.ts): build output is never staged. */
function withoutUnitOutput(files: ForgeTree['files'], gb1: Record<string, string>, subPath: string) {
  let outputDir: unknown;
  try {
    outputDir = (JSON.parse(gb1[subPath ? `${subPath}/sentropic.artifact.json` : 'sentropic.artifact.json'] ?? 'null') as
      { outputDir?: unknown } | null)?.outputDir;
  } catch { return files; }
  if (typeof outputDir !== 'string' || !safeDependencyPath(outputDir.replace(/\/+$/, ''))) return files;
  const root = outputDir.replace(/\/+$/, '');
  return files.filter(file => file.path !== root && !file.path.startsWith(`${root}/`));
}
/** Repacks one filtered snapshot tree into its deterministic source unit (§7.2.2): every kept raw file under
 * its full repository path (subPath-prefixed), so the load side re-derives files and GB1 inputs with the
 * original inside/read rule. GB1-only files outside subPath ride as regular members; their bytes are UTF-8
 * text (descriptors, manifests, locks, the qualification file) by construction. */
async function treeToUnit(tree: ForgeTree, subPath: string): Promise<Uint8Array> {
  const full = (stripped: string) => subPath === '' ? stripped : `${subPath}/${stripped}`;
  const members: UstarMember[] = tree.files.map(f => ({ path: full(f.path),
    mode: f.mode === 0o755 ? 365 as const : 292 as const, bytes: f.bytes }));
  const inside = new Set(members.map(member => member.path));
  for (const [path, text] of Object.entries(tree.gb1)) {
    if (!inside.has(path)) members.push({ path, mode: 292 as const, bytes: Buffer.from(text, 'utf8') });
  }
  members.sort((a, b) => (a.path < b.path ? -1 : 1));
  async function* stream(): AsyncGenerator<UstarMember> { for (const member of members) yield member; }
  const chunks: Uint8Array[] = []; let size = 0;
  for await (const chunk of tarZst(stream())) {
    size += chunk.byteLength;
    if (size > FORGE_LIMITS.totalBytes) return unstable('unit_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
/** Rebuilds one filtered snapshot tree from its source unit: the same inside/read split and output filter as
 * the tarball parse, so a cached unit is indistinguishable from a fresh download. Malformed units refuse. */
async function unitToTree(cached: Uint8Array, subPath: string): Promise<ForgeTree> {
  if (!(cached instanceof Uint8Array)) return unstable('unit_invalid');
  const fail = (kind: 'limit' | 'invalid'): never => {
    if (kind === 'limit') throw new LiveError('limit_exceeded', 'forge_snapshot');
    return unstable('unit_invalid');
  };
  const members: { path: string; mode: number; bytes: Uint8Array }[] = [];
  for await (const member of extractTarZst(cached, cached.byteLength,
    { files: FORGE_LIMITS.files, fileBytes: FORGE_LIMITS.fileBytes, totalBytes: FORGE_LIMITS.totalBytes }, fail)) {
    members.push(member);
  }
  const gb1: Record<string, string> = {};
  const files: ForgeTree['files'] = [];
  for (const member of members) {
    const base = member.path.slice(member.path.lastIndexOf('/') + 1);
    const read = member.path === GB1_QUALIFICATION_PATH || GB1_BASENAMES.has(base);
    if (read) gb1[member.path] = Buffer.from(member.bytes).toString('utf8');
    const inside = subPath === '' || member.path.startsWith(`${subPath}/`);
    if (!inside) continue;
    files.push({ path: subPath === '' ? member.path : member.path.slice(subPath.length + 1),
      mode: member.mode === 365 ? 0o755 : 0o644, bytes: member.bytes });
  }
  return { files: withoutUnitOutput(files, gb1, subPath), gb1 };
}
/** Shared snapshot assembly of the user path (`snapshot`) and the prewarm trigger (`snapshotRepo`): identical
 * identity derivation, so a prewarm seals exactly the `cacheKey` a start will look up. */
async function snapshotTarget(t: Target, sha: string, ports: {
  commit(repository: BuilderRepository, sha: string): Promise<unknown>;
  tree(t: Target, sha: string): Promise<ForgeTree>; stage(entry: Staged): string; now(): number;
}): Promise<SourceSnapshot> {
  const commit = await ports.commit(t.repository, sha) as { sha: unknown; tree: unknown };
  const treeSha = field(commit.tree, 'sha');
  if (commit.sha !== sha || typeof treeSha !== 'string' || !SHA.test(treeSha)) return unavailable();
  const files = await ports.tree(t, sha);
  const lock = files.files.find(file => file.path === 'package-lock.json');
  if (!lock) throw new LiveError('lock_missing');
  const stagingRef = ports.stage({ target: t, sha, manifest: rowsOf(files), expiresAt: ports.now() + STAGING.ttlMs });
  const topology = files.files.filter(f => f.path === 'package.json' || f.path.endsWith('/package.json'))
    .map(f => f.path).sort();
  const rawSelection = [...(t.repository.installWorkspaces ?? [])].sort();
  let installWorkspaces: readonly string[] = rawSelection;
  if (rawSelection.length > 0) {
    const rootManifest = files.gb1['package.json'];
    if (typeof rootManifest !== 'string') throw new LiveError('build_descriptor_invalid', 'unknown_workspace');
    installWorkspaces = validateWorkspaces(rawSelection, rootManifest,
      Object.keys(files.gb1).filter(path => path === 'package.json' || path.endsWith('/package.json')));
  }
  return { headSha: sha, treeSha, lockfile: lock.bytes, stagingRef, gb1: { subPath: t.binding.subPath, files: files.gb1 },
    cacheIdentity: { storageScopeId: t.key.storageScopeId, repoId: t.binding.repoId, lockSha256: sha256(lock.bytes),
      platform: BUILDER_TOOLCHAIN.platform, nodeVersion: BUILDER_TOOLCHAIN.nodeVersion,
      npmVersion: BUILDER_TOOLCHAIN.npmVersion, image: BUILDER_IMAGE,
      policyRevision: sha256(JSON.stringify([installRecipeFor(installWorkspaces), NPM_RELAY])),
      workspaceTopology: sha256(JSON.stringify(topology)), integrityDigest: sha256(files.gb1[GB1_QUALIFICATION_PATH] ?? ''),
      installWorkspaces } };
}

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
  /** Source-unit store (§7.2.2): one deterministic `sources/<commitSha>-<filterDigest>.tar.zst` per commit.
   * Best-effort read-through cache — a failed put never fails the snapshot, a failed get re-downloads. */
  units?: { get(ref: string): Promise<Uint8Array | undefined>; put(ref: string, bytes: Uint8Array): Promise<void> };
  fetch?: typeof fetch; now?: () => number; id?: () => string;
}): ForgeReads & { close(): void;
  /** Repo-scoped prewarm snapshot (§7.1.3); see the method comment. */
  snapshotRepo(scope: string, binding: ForgeBinding, commitSha: string): Promise<SourceSnapshot>;
} {
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
  /** The tarball of `sha` through at most one redirect, to codeload only, then the filtered tree. With a
   * unit store, one commit downloads once: the repacked source unit is served on later snapshots, and the
   * staged-manifest comparison in `source()` still runs over the unit's manifest rows. */
  async function tree(t: Target, sha: string): Promise<ForgeTree> {
    const signal = AbortSignal.timeout(FORGE_TIMEOUTS.tarballMs);
    const ref = options.units ? sourceUnitRef(sha, sourceFilterDigest(t.binding.subPath)) : undefined;
    if (options.units && ref) {
      assertSourceRef(ref);
      const cached = await options.units.get(ref).catch(() => undefined);
      if (cached) return unitToTree(cached, t.binding.subPath);
    }
    let response = await github(t.repository, `/tarball/${sha}`, signal);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location') ?? ''; await discard(response);
      if (!location.startsWith(CODELOAD)) return unavailable();
      response = await client!.get(location, { 'user-agent': USER_AGENT }, signal);
    }
    if (response.status !== 200 || !response.body) { await discard(response); return unavailable(); }
    const parsed = await readForgeTarball(response.body, t.binding.subPath);
    if (options.units && ref) {
      try { await options.units.put(ref, await treeToUnit(parsed, t.binding.subPath)); }
      catch { /* best-effort cache: a failed put degrades to re-download, never fails the snapshot */ }
    }
    return parsed;
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
  async function fetchCommit(repository: BuilderRepository, sha: string): Promise<unknown> {
    return json(await github(repository, `/git/commits/${sha}`, AbortSignal.timeout(FORGE_TIMEOUTS.callMs)));
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
      return snapshotTarget(await target(key), sha, { commit: fetchCommit, tree, stage, now });
    },
    /** Repo-scoped prewarm snapshot (§7.1.3): the identical assembly as `snapshot` — same registry admission
     * (`admitBinding`), same `SourceSnapshot` shape, same cache identity a user start will hit — but resolved
     * from the host-supplied binding at the pinned commit, never from a generation binding row. The branch is
     * used for admission and retention current-ref tracking only; content is pinned by `commitSha`. */
    async snapshotRepo(scope, binding, commitSha): Promise<SourceSnapshot> {
      if (!config) return unconfigured();
      if (typeof commitSha !== 'string' || !SHA.test(commitSha)) return unavailable();
      const repository = admitBinding(config, scope, binding);
      const key = { storageScopeId: scope, artifactId: `prewarm:${binding.repoId}:${binding.subPath || 'root'}` };
      return snapshotTarget({ key, repository, binding }, commitSha, { commit: fetchCommit, tree, stage, now });
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
