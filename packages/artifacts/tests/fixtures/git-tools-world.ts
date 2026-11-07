import { vi } from 'vitest';
import { createTransportWorld } from './transport-world.js';
import { RADAR_ARTIFACTS_PROFILE } from '../../src/profile/index.js';
import { createGitToolService, type GitBuildPort, type GitToolsDeps } from '../../src/server/git-tools.js';
import { createMemoryGitBindingStore } from '../../src/server/git-bindings.js';
import { createGitRepositoryRegistry } from '../../src/server/git-registry.js';

export const ARTIFACT = '11111111-1111-4111-8111-111111111111';
export const SHA_A = 'a'.repeat(40);
export const SHA_B = 'b'.repeat(40);
const LIMITS = { idempotencyKeyMaxUnits: 256 };
export function gitToolsWorld(options: { delegated?: 'none' | 'personal-only'; build?: boolean | GitBuildPort; withService?: boolean;
  rights?: boolean; owner?: string; canWrite?: boolean; tools?: string[] } = {}) {
  const heads = new Map<string, string>([['main', SHA_A], ['artifact/shared/demo', SHA_A]]);
  const git = {
    resolveRef: vi.fn(async (_t: unknown, ref: string) => {
      const sha = heads.get(ref);
      if (!sha) { const { ArtifactOperationError } = await import('../../src/server/failures.js'); throw new ArtifactOperationError('not_found'); }
      return sha; }),
    createBranch: vi.fn(async (target: { branch: string }, base: string) => { heads.set(target.branch, base); }),
    isAncestor: vi.fn(async (_t: unknown, ancestor: string) => ancestor === SHA_A),
    read: vi.fn(async (_t: unknown, input: { commitSha: string; paths?: string[]; cursor?: string }) => ({
      commitSha: input.commitSha, treeSha: 'c'.repeat(40), nextCursor: input.paths || input.cursor ? null : 'port-1',
      files: (input.paths ?? ['ui/a.ts']).map(path => path === 'sentropic.artifact.json'
        ? { path, text: JSON.stringify({ version: 1, buildScript: 'build:artifact', outputDir: 'ui/dist', lockfilePath: 'package-lock.json' }), encoding: 'utf-8' as const }
        : { path, text: 'alpha', encoding: 'utf-8' as const }) })),
  };
  const build = vi.fn(async (job: { idempotencyKey: string }) => ({ jobId: 'job-' + job.idempotencyKey, state: 'build_pending' as const }));
  const buildPort: GitBuildPort | undefined = options.build === false ? undefined : typeof options.build === 'object' ? options.build
    : { admits: async executor => executor === 'caller', request: build };
  const bindings = createMemoryGitBindingStore();
  const journal = vi.fn();
  const deps: GitToolsDeps = { bindings, git: git as unknown as GitToolsDeps['git'], journal,
    registry: createGitRepositoryRegistry([{ repoId: 'repo-a', storageScopeId: 'scope-a', forge: 'github-app', locator: 'o/r',
      installationRef: 'i', webhookSecretRef: 'w', branchPrefix: 'artifact/', allowedSubPaths: [''], canWrite: true,
      writablePaths: ['ui/**'], codePolicyRef: 'p', publicationPolicy: { delegatedPublication: options.delegated ?? 'personal-only' } }]),
    codeRights: { canReadCode: async () => options.rights !== false },
    authorize: async () => ({ ownerId: options.owner ?? 'alice', canWrite: options.canWrite !== false }),
    ...(buildPort ? { build: buildPort } : {}), now: () => new Date('2026-11-07T00:00:00Z') };
  const tools = options.tools ?? ['fetch_app_source', 'git_attach', 'git_publish'];
  const profile = { ...RADAR_ARTIFACTS_PROFILE, selectedCapabilities: tools.map(t => 'artifacts_' + t),
    operations: tools.map(operation => ({ operation, limits: operation === 'fetch_app_source' ? {} : LIMITS, defaults: {} })) };
  const world = createTransportWorld(['alice', 'bob'], 'scope-a', { profile: profile as never,
    ...(options.withService === false ? {} : { gitTools: createGitToolService(deps) }) });
  const call = (route: string, body: Record<string, unknown>, actor = 'alice') =>
    world.http('/' + route, body, world.invocation(actor));
  return { world, call, git, heads, build, deps, journal, bindings };
}
