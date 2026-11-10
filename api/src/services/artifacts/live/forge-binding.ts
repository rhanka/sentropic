import { isAllowedGitBranch } from '@sentropic/artifacts';
import type { GitInstallationLeasePort } from '@sentropic/cluster-mesh';
import { GIT_APP_TARGET_REGISTRY } from '../../cluster-mesh/github-app-host';
import { LiveError, type LiveKey } from './records';
import { rowOf, type RemoteRows } from './remote-live';
import { podName } from './pods';
import { parseInstallWorkspaces } from './workspace-subset';

/** Builder repositories (cm/api): `[{storageScopeId, repoId, locator, installationRef, allowedSubPaths}]`. */
export const BUILDER_REPOSITORIES_ENV = 'ARTIFACT_BUILDER_REPOSITORIES_JSON';
/** Git coordinates the host owns for one artifact binding generation (D0); the builder validates and records them. */
export interface ForgeBinding { repoId: string; branch: string; subPath: string }
export interface BuilderRepository {
  storageScopeId: string; repoId: string; locator: string; installationRef: string; allowedSubPaths: readonly string[];
  /** Workspace-scoped installs (e.g. `["ui"]`): when set, only the root-lockfile subset reachable from those
   * workspaces is streamed and installed, exactly `npm ci --workspace=<ws>` without `--include-workspace-root`.
   * Repository-wide: applies to every `allowedSubPaths` entry of this repository. An empty array (or any shape
   * or traversal violation) refuses the whole forge configuration (`forgeConfig` returns null, fail-closed). */
  installWorkspaces?: readonly string[];
}
/** The enabled SG0-app host: its registry targets, the lifecycle lease and the credential invalidation bus. */
export interface ForgeLeaseHost {
  targets: ReadonlyArray<{ locator: string; storageScopeId: string; repoId: string }>;
  acquire: GitInstallationLeasePort['acquire'];
  subscribe(subscriber: (event: { storageScopeId: string; repoId: string }) => Promise<void>): () => void;
}
export interface ForgeConfig { host: ForgeLeaseHost; repositories: readonly BuilderRepository[] }

const REF = /^enroll_[0-9a-fA-F-]{36}$/;
const TEXT = /^[\x21-\x7e]{1,256}$/;
const KEYS = 'allowedSubPaths,installationRef,locator,repoId,storageScopeId';
const KEYS_WS = 'allowedSubPaths,installWorkspaces,installationRef,locator,repoId,storageScopeId';
export const unconfigured = (): never => { throw new LiveError('builder_unavailable', 'forge_unconfigured'); };
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
/** `''` or relative segments without `.`, `..`, `\` or NUL. */
export const safeSubPath = (value: string) => value === '' || (!value.includes('\\') && !value.includes('\0')
  && value.split('/').every(part => part !== '' && part !== '.' && part !== '..'));

/** Closed body shape `{repoId, branch, subPath}`; grammar and registry checks come later (`admitBinding`). */
export function bindingOf(value: unknown): ForgeBinding | null {
  if (!record(value) || Object.keys(value).sort().join() !== 'branch,repoId,subPath') return null;
  const { repoId, branch, subPath } = value;
  if (typeof repoId !== 'string' || !TEXT.test(repoId) || typeof branch !== 'string' || branch.length < 1
    || branch.length > 255 || typeof subPath !== 'string' || subPath.length > 1024) return null;
  return { repoId, branch, subPath };
}

/** Absent, invalid or inconsistent with the enabled GitHub App host targets → null: every read refuses. */
export function forgeConfig(env: Readonly<Record<string, string | undefined>>, host: ForgeLeaseHost | null): ForgeConfig | null {
  const source = env[BUILDER_REPOSITORIES_ENV]?.trim();
  if (!host || !source) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch { return null; }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  const repositories: BuilderRepository[] = [];
  for (const entry of parsed) {
    if (!record(entry)) return null;
    const keys = Object.keys(entry).sort().join();
    const { storageScopeId, repoId, locator, installationRef, allowedSubPaths } = entry;
    let installWorkspaces: readonly string[] | undefined;
    if (keys === KEYS) installWorkspaces = undefined;
    else if (keys === KEYS_WS) {
      const parsedWorkspaces = parseInstallWorkspaces((entry as Record<string, unknown>).installWorkspaces);
      if (!parsedWorkspaces) return null;
      installWorkspaces = parsedWorkspaces;
    } else return null;
    if (typeof storageScopeId !== 'string' || !TEXT.test(storageScopeId) || typeof repoId !== 'string' || !TEXT.test(repoId)
      || typeof locator !== 'string' || !(GIT_APP_TARGET_REGISTRY as readonly string[]).includes(locator)
      || typeof installationRef !== 'string' || !REF.test(installationRef) || !Array.isArray(allowedSubPaths)
      || allowedSubPaths.length === 0 || allowedSubPaths.some(p => typeof p !== 'string' || !safeSubPath(p))) return null;
    if (!host.targets.some(t => t.locator === locator && t.storageScopeId === storageScopeId && t.repoId === repoId)) return null;
    if (repositories.some(r => r.storageScopeId === storageScopeId && r.repoId === repoId)) return null;
    repositories.push({ storageScopeId, repoId, locator, installationRef, allowedSubPaths: [...allowedSubPaths] as string[],
      ...(installWorkspaces ? { installWorkspaces } : {}) });
  }
  return { host, repositories };
}

/** Contract §1 validation order, before any forge call; closed refusals without detail. */
export function admitBinding(config: ForgeConfig | null, storageScopeId: string, binding: ForgeBinding): BuilderRepository {
  if (!config) return unconfigured();
  if (!config.host.targets.some(t => t.storageScopeId === storageScopeId && t.repoId === binding.repoId)) {
    throw new LiveError('git_repo_not_registered');
  }
  const repository = config.repositories.find(r => r.storageScopeId === storageScopeId && r.repoId === binding.repoId);
  if (!repository) throw new LiveError('git_repo_not_registered');
  if (!isAllowedGitBranch(binding.branch)) throw new LiveError('git_ref_not_allowed');
  if (!safeSubPath(binding.subPath) || !repository.allowedSubPaths.includes(binding.subPath)) throw new LiveError('git_ref_not_allowed');
  return repository;
}

/** Bindings per `(storageScopeId, artifactId, bindingGeneration)` in the remote-live rows, immutable per generation. */
export function createForgeBindings(rows: RemoteRows, config: ForgeConfig | null) {
  const row = (key: LiveKey, generation: number) => rowOf(podName(key), 'binding', generation);
  return {
    /** Contract §1 checks only: a build stores its binding with the job, recorded at the HostJob generation (R1). */
    validate: (key: LiveKey, binding: ForgeBinding): void => { admitBinding(config, key.storageScopeId, binding); },
    /** Validates, then records; another value for a recorded generation is 409 `binding_conflict`. */
    async admit(key: LiveKey, generation: number, binding: ForgeBinding): Promise<void> {
      admitBinding(config, key.storageScopeId, binding);
      await rows.update<ForgeBinding, void>(row(key, generation), current => {
        if (current && (current.repoId !== binding.repoId || current.branch !== binding.branch
          || current.subPath !== binding.subPath)) throw new LiveError('binding_conflict');
        return { next: current ? undefined : { ...binding }, result: undefined };
      });
    },
    read: (key: LiveKey, generation: number) => rows.read<ForgeBinding>(row(key, generation)),
  };
}
export type ForgeBindings = ReturnType<typeof createForgeBindings>;
