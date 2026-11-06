import { ArtifactOperationError } from '../server/failures.js';
import { GitForgeError } from '../server/git-port.js';
import type { GitPort } from '../server/git-port.js';
import { assertGitReadRef, assertGitSha } from '../server/git-port-policy.js';
import { gitSessions } from '../server/git-port-session.js';
import type { GitPortOptions } from '../server/git-port-session.js';
import { gitSourceReader } from '../server/git-port-read.js';
import { gitWriter } from '../server/git-port-write.js';
import { gitTrees } from '../server/git-port-tree.js';

/** Trusted SG0-net composition only. Inject SG0-app's lease port, never an App key or PAT. */
export function createGitPort(options: GitPortOptions): GitPort & Pick<ReturnType<typeof gitSessions>, 'invalidate'> {
  if (options.cursorKey.byteLength < 32 || !Number.isInteger(options.pageSize ?? 100) ||
    (options.pageSize ?? 100) < 1 || (options.pageSize ?? 100) > 255 ||
    [options.maxFileBytes ?? 1, options.maxTotalBytes ?? 1].some(n => !Number.isSafeInteger(n) || n < 1)) {
    throw new ArtifactOperationError('invalid_request');
  }
  const sessions = gitSessions(options);
  const reader = gitSourceReader(options, sessions.open);
  const writer = gitWriter(options, sessions);
  async function safe<T>(action: () => Promise<T>): Promise<T> {
    try { return await action(); }
    catch (error) {
      if (error instanceof ArtifactOperationError) throw error;
      if (error instanceof GitForgeError && error.code === 'missing') throw new ArtifactOperationError('not_found');
      if (error instanceof GitForgeError && error.code === 'conflict') throw new ArtifactOperationError('git_ref_not_allowed');
      throw new ArtifactOperationError('provider_unavailable');
    }
  }
  return {
    invalidate: sessions.invalidate,
    snapshot: (target, commitSha) => safe(async () => {
      const repo = await sessions.admit(target, false); assertGitSha(commitSha);
      const trees = gitTrees(await sessions.open(repo));
      const root = await trees.root(commitSha);
      const entries: import('../server/git-port.js').GitTreeEntry[] = [];
      async function walk(sha: string, prefix: string, depth: number): Promise<void> {
        if (depth > 128) throw new ArtifactOperationError('limit_exceeded');
        for (const entry of await trees.tree(sha)) {
          if (entries.length >= 1_000_000) throw new ArtifactOperationError('limit_exceeded');
          if (entry.type === 'tree') await walk(entry.sha, prefix + entry.path + '/', depth + 1);
          else entries.push({ ...entry, path: prefix + entry.path });
        }
      }
      await walk(root, '', 0);
      return { treeSha: root, entries };
    }),
    resolveRef: (target, ref) => safe(async () => {
      const repo = await sessions.admit(target, false);
      assertGitReadRef(ref);
      const session = await sessions.open(repo);
      let result;
      try { result = await session.call((forge, context) => forge.resolve(context, ref)); }
      catch (error) {
        if (ref === target.branch && error instanceof GitForgeError && error.code === 'missing') {
          throw new ArtifactOperationError('git_branch_missing', { publicDetails: { branch: target.branch } });
        }
        throw error;
      }
      assertGitSha(result.sha);
      return result.sha;
    }),
    read: (target, input) => safe(async () => reader(await sessions.admit(target, false), target, input)),
    inspectCommit: (target, commitSha) => safe(async () => {
      const repo = await sessions.admit(target, false); assertGitSha(commitSha);
      const session = await sessions.open(repo);
      const result = await session.call((forge, context) => forge.resolve(context, commitSha));
      if (result.sha !== commitSha) throw new ArtifactOperationError('provider_unavailable');
      return result;
    }),
    commit: input => safe(() => writer(input)),
    isAncestor: (target, ancestor, descendant) => safe(async () => {
      const repo = await sessions.admit(target, false);
      assertGitSha(ancestor); assertGitSha(descendant);
      const session = await sessions.open(repo);
      return session.call((forge, context) => forge.isAncestor(context, ancestor, descendant));
    }),
    createBranch: (target, baseSha) => safe(async () => {
      const repo = await sessions.admit(target, true);
      assertGitSha(baseSha);
      const session = await sessions.open(repo);
      await session.call((forge, context) => forge.createBranch(context, target.branch, baseSha));
    }),
  };
}
