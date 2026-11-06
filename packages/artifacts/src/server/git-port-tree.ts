import { ArtifactOperationError } from './failures.js';
import { GitForgeError } from './git-port.js';
import type { GitPortTarget, GitTreeEntry } from './git-port.js';
import type { GitPortSession } from './git-port-session.js';
import { assertGitSha, gitPath } from './git-port-policy.js';

export function gitTrees(session: GitPortSession) {
  const cache = new Map<string, GitTreeEntry[]>();
  let entries = 0;
  async function tree(sha: string): Promise<GitTreeEntry[]> {
    assertGitSha(sha);
    if (!cache.has(sha)) {
      if (cache.size >= 4096) throw new ArtifactOperationError('limit_exceeded');
      const result = await session.call((forge, context) => forge.tree(context, sha));
      entries += result.length;
      if (entries > 1_000_000) throw new ArtifactOperationError('limit_exceeded');
      const names = new Set<string>();
      for (const entry of result) {
        if (!entry.path || entry.path.includes('/') || names.has(entry.path)) throw new ArtifactOperationError('provider_unavailable');
        names.add(entry.path); assertGitSha(entry.sha);
      }
      cache.set(sha, result);
    }
    return cache.get(sha)!;
  }
  async function root(commitSha: string): Promise<string> {
    try {
      const commit = await session.call((forge, context) => forge.resolve(context, commitSha));
      if (commit.sha !== commitSha) throw new ArtifactOperationError('provider_unavailable');
      assertGitSha(commit.treeSha);
      return commit.treeSha;
    } catch (error) {
      if (error instanceof GitForgeError && error.code === 'missing') throw new ArtifactOperationError('not_found');
      throw error;
    }
  }
  async function lookup(treeSha: string, path: string): Promise<GitTreeEntry | undefined> {
    const parts = path.split('/');
    for (const [i, part] of parts.entries()) {
      const entry = (await tree(treeSha)).find(e => e.path === part);
      if (!entry) return undefined;
      if (!['040000', '100644', '100755'].includes(entry.mode) || entry.type === 'commit') {
        throw new ArtifactOperationError('git_path_refused', { publicDetails: { path, reason: 'path_alias' } });
      }
      if (i === parts.length - 1) return entry;
      if (entry.type !== 'tree' || entry.mode !== '040000') {
        throw new ArtifactOperationError('git_path_refused', { publicDetails: { path, reason: 'not_directory' } });
      }
      treeSha = entry.sha;
    }
  }
  async function enumerate(treeSha: string, target: GitPortTarget): Promise<GitTreeEntry[]> {
    if (target.subPath) {
      const base = await lookup(treeSha, target.subPath);
      if (!base || base.type !== 'tree') throw new ArtifactOperationError('not_found');
      treeSha = base.sha;
    }
    const files: GitTreeEntry[] = [];
    async function walk(sha: string, prefix: string, depth: number): Promise<void> {
      if (depth > 128) throw new ArtifactOperationError('limit_exceeded');
      for (const entry of await tree(sha)) {
        const path = `${prefix}${entry.path}`;
        try { gitPath(session.repo, target, path, false); }
        catch (error) { if (error instanceof ArtifactOperationError && error.kind === 'git_path_refused') continue; throw error; }
        if (entry.type === 'tree' && entry.mode === '040000') await walk(entry.sha, `${path}/`, depth + 1);
        else if (entry.type === 'blob' && ['100644', '100755'].includes(entry.mode)) files.push({ ...entry, path });
      }
    }
    await walk(treeSha, '', 0);
    return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  }
  return { root, tree, lookup, enumerate };
}
