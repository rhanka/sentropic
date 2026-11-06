import { createHash } from 'node:crypto';
import { vi } from 'vitest';
import { createGitPort } from '../../src/adapters/github-git-port.js';
import { GitForgeError } from '../../src/server/git-port.js';
import type { GitForge, GitPortTarget, GitTreeEntry, GitPortRepository, GitResolvedCommit } from '../../src/server/git-port.js';

const sha = (value: unknown) => createHash('sha1').update(JSON.stringify(value)).digest('hex');
export const target: GitPortTarget = { storageScopeId: 'scope', repoId: 'repo', principalId: 'human',
  branch: 'artifact/p/human/app', subPath: '', outputDir: 'dist' };
export const repo: GitPortRepository = { ...target, locator: 'owner/repo', installationRef: 'enrolled',
  branchPrefix: 'artifact/', canWrite: true, allowedSubPaths: [''], writablePaths: ['ui/**', 'packages/*/src/**'],
  refusedWritePaths: ['deploy/**', 'api/**', '.track/**', 'package*.json'] };
export function fakeGit(files: Record<string, string> = { 'ui/a.ts': 'first', 'ui/b.ts': 'second' }) {
  const blobs = new Map<string, Uint8Array>();
  const trees = new Map<string, GitTreeEntry[]>();
  const snapshots = new Map<string, Record<string, string>>();
  const commits = new Map<string, GitResolvedCommit>();
  const refs = new Map<string, string>();
  function build(values: Record<string, string>, prefix = ''): string {
    const entries: GitTreeEntry[] = [];
    const names = [...new Set(Object.keys(values).filter(p => p.startsWith(prefix)).map(p => p.slice(prefix.length).split('/')[0]))];
    for (const path of names) {
      const full = `${prefix}${path}`;
      if (full in values) {
        const bytes = Buffer.from(values[full]); const id = sha(values[full]); blobs.set(id, bytes);
        entries.push({ path, sha: id, mode: '100644', type: 'blob', size: bytes.length });
      } else entries.push({ path, sha: build(values, `${full}/`), mode: '040000', type: 'tree' });
    }
    const id = sha(entries); trees.set(id, entries); snapshots.set(id, { ...values }); return id;
  }
  const initial = sha('initial'); const treeSha = build(files);
  const bootstrapIdentity = { name: 'Bootstrap', email: 'bootstrap@noreply.test' };
  commits.set(initial, { sha: initial, treeSha, parents: [], message: 'bootstrap', author: bootstrapIdentity, committer: bootstrapIdentity }); refs.set(target.branch, initial);
  const forge: GitForge = {
    repositoryId: vi.fn(async () => '123'),
    resolve: vi.fn(async (_context, ref) => {
      const commit = commits.get(refs.get(ref) ?? ref);
      if (!commit) throw new GitForgeError('missing');
      return commit;
    }),
    tree: vi.fn(async (_context, id) => trees.get(id)!),
    blob: vi.fn(async (_context, id) => blobs.get(id)!),
    createTree: vi.fn(async (_context, base, changes) => {
      const values = { ...snapshots.get(base)! };
      for (const change of changes) { if (change.text === null) delete values[change.path]; else values[change.path] = change.text; }
      return build(values);
    }),
    createCommit: vi.fn(async (_context, input) => {
      const id = sha(input); commits.set(id, { ...input, sha: id, treeSha: input.treeSha, parents: [input.parentSha] }); return id;
    }),
    advance: vi.fn(async (_context, branch, expected, next) => {
      if (refs.get(branch) !== expected) throw new GitForgeError('conflict');
      refs.set(branch, next);
    }),
    createBranch: vi.fn(async (_context, branch, base) => {
      if (refs.has(branch)) throw new GitForgeError('conflict'); refs.set(branch, base);
    }),
    isAncestor: vi.fn(async (_context, ancestor, descendant) => {
      for (let id: string | undefined = descendant; id; id = commits.get(id)?.parents[0]) if (id === ancestor) return true;
      return false;
    }),
  };
  const lease = { token: 'fake-only-lease', repositoryId: '123', expiresAt: '2099-01-01T00:00:00Z',
    permissions: { contents: 'write', metadata: 'read' } as const, credentialVersion: 'v1' };
  const leases = { acquire: vi.fn(async () => lease) };
  const directory = { resolve: vi.fn(async () => ({ name: 'Human', email: 'human@users.noreply.github.com' })) };
  const options = { registry: { get: vi.fn(async () => repo) }, forge, leases, directory,
    committer: { name: 'Artifact App[bot]', email: 'app@users.noreply.github.com' },
    cursorKey: Buffer.alloc(32, 42), authorize: vi.fn(async () => true), pageSize: 1 };
  return { port: createGitPort(options), options, forge, initial, refs, commits, trees, blobs, lease, leases };
}
export const commitInput = (expectedHeadSha: string) => ({ target, expectedHeadSha,
  createdAt: '2026-11-06T00:00:00.000Z',
  artifactId: '12345678-1234-1234-1234-123456789abc', invocationId: 'invocation-1', message: 'Update source',
  files: [{ path: 'ui/a.ts', text: 'updated' }, { path: 'ui/c.ts', text: 'created' }, { path: 'ui/b.ts', text: null }] });
