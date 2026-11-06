import { ArtifactOperationError } from './failures.js';
import { GitForgeError } from './git-port.js';
import type { GitCommitInput, GitIdentity } from './git-port.js';
import { GitPortAdvanceUnknown } from './git-port-session.js';
import type { GitPortOptions, gitSessions } from './git-port-session.js';
import { assertGitSha, gitPath } from './git-port-policy.js';
import { gitTrees } from './git-port-tree.js';

const validIdentity = (identity: GitIdentity | null): identity is GitIdentity => !!identity &&
  !!identity.name.trim() && identity.name.length <= 256 && /^[^\s<>@]+@[^\s<>@]+$/.test(identity.email) &&
  !/[\r\n\x00<>]/.test(identity.name);

export function gitWriter(options: GitPortOptions, sessions: ReturnType<typeof gitSessions>) {
  return async (input: GitCommitInput): Promise<{ commitSha: string; treeSha: string }> => {
    const { target, expectedHeadSha } = input;
    const repo = await sessions.admit(target, true);
    assertGitSha(expectedHeadSha);
    if (!input.files.length || input.files.length > 255 || !input.message.trim() || input.message.length > 16384 ||
      /^Artifacts-(?:Artifact|Invocation|Base):/mi.test(input.message) ||
      !Number.isFinite(Date.parse(input.createdAt)) || new Date(input.createdAt).toISOString() !== input.createdAt ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(input.artifactId) ||
      !/^[\w.-]{1,128}$/.test(input.invocationId)) throw new ArtifactOperationError('invalid_request');
    const paths = input.files.map(file => gitPath(repo, target, file.path, true));
    if (new Set(paths).size !== paths.length) throw new ArtifactOperationError('invalid_request');
    let bytes = 0;
    for (const file of input.files) {
      if (file.text === null) continue;
      if (typeof file.text !== 'string' || /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/.test(file.text) ||
        file.text.includes('\0') || Buffer.from(file.text).toString('utf8') !== file.text) {
        throw new ArtifactOperationError('git_path_refused', { publicDetails: { path: file.path, reason: 'not_source_text' } });
      }
      const size = Buffer.byteLength(file.text);
      bytes += size;
      if (size > (options.maxFileBytes ?? 1024 * 1024) || bytes > (options.maxTotalBytes ?? 8 * 1024 * 1024)) {
        throw new ArtifactOperationError('limit_exceeded');
      }
    }
    let author: GitIdentity | null;
    try { author = await options.directory.resolve({ storageScopeId: target.storageScopeId, principalId: target.principalId }); }
    catch { throw new ArtifactOperationError('access_denied'); }
    if (!validIdentity(author)) throw new ArtifactOperationError('access_denied');
    if (!validIdentity(options.committer)) throw new ArtifactOperationError('provider_unavailable');
    const session = await sessions.open(repo);
    const head = async () => {
      try { return await session.call((forge, context) => forge.resolve(context, target.branch)); }
      catch (error) {
        if (error instanceof GitForgeError && error.code === 'missing') {
          throw new ArtifactOperationError('git_branch_missing', { publicDetails: { branch: target.branch } });
        }
        throw error;
      }
    };
    const moved = (actualHeadSha: string) => new ArtifactOperationError('git_head_moved', {
      publicDetails: { expectedHeadSha, actualHeadSha },
    });
    const observed = await head();
    if (observed.sha !== expectedHeadSha) throw moved(observed.sha);
    const trees = gitTrees(session); const baseTree = await trees.root(expectedHeadSha);
    const changes: { path: string; text: string | null; mode: string }[] = [];
    for (const [i, file] of input.files.entries()) {
      const existing = await trees.lookup(baseTree, paths[i]);
      if (existing?.type === 'tree') throw new ArtifactOperationError('git_path_refused', { publicDetails: { path: file.path, reason: 'not_file' } });
      if (!existing && file.text === null) throw new ArtifactOperationError('invalid_request');
      changes.push({ path: paths[i], text: file.text, mode: existing?.mode ?? '100644' });
    }
    if (!await options.authorize(target, true)) throw new ArtifactOperationError('access_denied');
    const treeSha = await session.call((forge, context) => forge.createTree(context, baseTree, changes));
    assertGitSha(treeSha);
    const message = `${input.message}\n\nArtifacts-Artifact: ${input.artifactId}\nArtifacts-Invocation: ${input.invocationId}\nArtifacts-Base: ${expectedHeadSha}`;
    const commitSha = await session.call((forge, context) => forge.createCommit(context,
      { parentSha: expectedHeadSha, treeSha, message, author, committer: options.committer, createdAt: input.createdAt }));
    assertGitSha(commitSha);
    if (!await options.authorize(target, true)) throw new ArtifactOperationError('access_denied');
    let submitted = false;
    try { await session.call((forge, context) => { submitted = true; return forge.advance(context, target.branch, expectedHeadSha, commitSha); }); }
    catch (error) {
      if (!submitted) throw error;
      if (error instanceof GitForgeError && error.code === 'conflict') {
        const actual = (await head()).sha;
        throw actual === expectedHeadSha ? new ArtifactOperationError('git_ref_not_allowed') : moved(actual);
      }
      // A transport failure after submission cannot prove whether the ref advanced.
      throw new GitPortAdvanceUnknown();
    }
    return { commitSha, treeSha };
  };
}
