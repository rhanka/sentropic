import { createHash } from 'node:crypto';
import { GitForgeError } from '../server/git-port.js';
import type { GitForge, GitTreeEntry } from '../server/git-port.js';
import { githubApi } from './github-http.js';
import type { GitHubFetch } from './github-http.js';
import { githubReceivePack } from './github-receive-pack.js';

const sha = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/.test(value)) throw new GitForgeError('unavailable');
  return value;
};
/** Fixed public GitHub origins. The SG0-net host owns network admission and egress receipts. */
export function createGitHubForge(fetcher: GitHubFetch = globalThis.fetch): GitForge {
  const api = githubApi(fetcher);
  return {
    async repositoryId(context) {
      const result = await api(context, '');
      if (!Number.isSafeInteger(result?.id) || result.id <= 0 ||
        typeof result.full_name !== 'string' || result.full_name.toLowerCase() !== context.locator.toLowerCase()) throw new GitForgeError('unavailable');
      return String(result.id);
    },
    async resolve(context, ref) {
      const result = await api(context, `/commits/${encodeURIComponent(ref)}`);
      return { sha: sha(result?.sha), treeSha: sha(result?.commit?.tree?.sha) };
    },
    async tree(context, treeSha) {
      const result = await api(context, `/git/trees/${sha(treeSha)}`); // Never use recursive=1 (silent truncation).
      if (result?.truncated !== false || sha(result?.sha) !== treeSha || !Array.isArray(result.tree)) throw new GitForgeError('unavailable');
      return result.tree.map((entry: any): GitTreeEntry => {
        if (typeof entry?.path !== 'string' || !['tree', 'blob', 'commit'].includes(entry.type) ||
          !['040000', '100644', '100755', '120000', '160000'].includes(entry.mode) ||
          (entry.size !== undefined && (!Number.isSafeInteger(entry.size) || entry.size < 0))) throw new GitForgeError('unavailable');
        return { path: entry.path, sha: sha(entry.sha), type: entry.type, mode: entry.mode,
          ...(entry.size === undefined ? {} : { size: entry.size }) };
      });
    },
    async blob(context, blobSha) {
      const result = await api(context, `/git/blobs/${sha(blobSha)}`);
      if (sha(result?.sha) !== blobSha || result.encoding !== 'base64' || typeof result.content !== 'string') throw new GitForgeError('unavailable');
      const content = result.content.replace(/\n/g, ''); const bytes = Buffer.from(content, 'base64');
      if (bytes.toString('base64') !== content || result.size !== bytes.length ||
        createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') !== blobSha) throw new GitForgeError('unavailable');
      return bytes;
    },
    async createTree(context, baseTreeSha, changes) {
      const result = await api(context, '/git/trees', { base_tree: sha(baseTreeSha), tree: changes.map(change => ({
        path: change.path, mode: change.mode, type: 'blob',
        ...(change.text === null ? { sha: null } : { content: change.text }),
      })) });
      return sha(result?.sha);
    },
    async createCommit(context, input) {
      const result = await api(context, '/git/commits', { message: input.message, tree: sha(input.treeSha),
        parents: [sha(input.parentSha)], author: input.author, committer: input.committer });
      return sha(result?.sha);
    },
    async advance(context, branch, expectedSha, commitSha) {
      sha(expectedSha); sha(commitSha);
      await githubReceivePack(fetcher, context, branch, expectedSha, commitSha);
    },
    async createBranch(context, branch, baseSha) {
      const result = await api(context, '/git/refs', { ref: `refs/heads/${branch}`, sha: sha(baseSha) });
      if (result?.ref !== `refs/heads/${branch}` || result?.object?.sha !== baseSha) throw new GitForgeError('unavailable');
    },
    async isAncestor(context, ancestor, descendant) {
      const result = await api(context, `/compare/${sha(ancestor)}...${sha(descendant)}`);
      if (!['identical', 'ahead', 'behind', 'diverged'].includes(result?.status) || result?.base_commit?.sha !== ancestor) throw new GitForgeError('unavailable');
      return result.status === 'identical' || result.status === 'ahead';
    },
  };
}
