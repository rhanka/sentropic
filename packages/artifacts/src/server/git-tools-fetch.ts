import { ArtifactOperationError } from './failures.js';
import { assertGitReadRef, assertGitSha } from './git-port-policy.js';
import type { GitPortTarget } from './git-port.js';
import type { GitToolInvocation, GitToolsDeps } from './git-tools-contracts.js';

const missing = (error: unknown) => error instanceof ArtifactOperationError &&
  ['not_found', 'git_path_refused'].includes(error.kind);
function decodeCursor(cursor: string | undefined): { sha?: string; port?: string } {
  if (cursor === undefined) return {};
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof value?.s !== 'string' || typeof value.c !== 'string') throw new Error();
    assertGitSha(value.s);
    return { sha: value.s, port: value.c };
  } catch { throw new ArtifactOperationError('invalid_request'); }
}
/** G0 v3 §1.4 fetch_app_source: code right on the resolved repo; the cursor pins the commit across pages. */
export async function fetchAppSource(deps: GitToolsDeps, args: Record<string, any>, inv: GitToolInvocation) {
  const cursor = decodeCursor(args.cursor);
  const scope = inv.storageScopeId;
  const binding = args.artifactId === undefined ? undefined : await deps.bindings.get(scope, args.artifactId);
  if (args.artifactId !== undefined && binding && args.repoId !== undefined && args.repoId !== binding.repoId) {
    throw new ArtifactOperationError('invalid_request');
  }
  const repoId: string = binding?.repoId ?? args.repoId;
  if (repoId === undefined) throw new ArtifactOperationError('git_not_attached');
  const allowed = await deps.codeRights.canReadCode({ storageScopeId: scope, repoId, actorId: inv.actorId })
    .then(value => value === true, () => false);
  if (!allowed) throw new ArtifactOperationError('access_denied');
  if (args.artifactId !== undefined && (!binding || binding.state === 'detached')) {
    throw new ArtifactOperationError('git_not_attached');
  }
  const repo = await deps.registry.get(scope, repoId);
  if (!repo) throw new ArtifactOperationError('git_repo_not_registered');
  const branch: string | undefined = binding?.branch ?? args.ref;
  if (branch === undefined) throw new ArtifactOperationError('invalid_request');
  assertGitReadRef(branch);
  const target: GitPortTarget = { storageScopeId: scope, repoId, branch, principalId: inv.actorId,
    subPath: binding?.subPath ?? (repo.allowedSubPaths.includes('') ? '' : repo.allowedSubPaths[0] ?? ''),
    outputDir: deps.outputDir ?? 'dist' };
  const commitSha = cursor.sha ?? await deps.git.resolveRef(target, branch);
  assertGitSha(commitSha);
  const page = await deps.git.read(target, { commitSha, ...(args.paths ? { paths: args.paths } : {}),
    ...(cursor.port === undefined ? {} : { cursor: cursor.port }) });
  await deps.journal?.({ actorId: inv.actorId, repoId, commitSha: page.commitSha, invocationId: inv.invocationId });
  let descriptor: unknown = null;
  try {
    const file = (await deps.git.read(target, { commitSha, paths: ['sentropic.artifact.json'] })).files[0];
    const parsed = file && 'text' in file ? JSON.parse(file.text) : null;
    if (parsed?.version === 1 && typeof parsed.buildScript === 'string' && typeof parsed.outputDir === 'string' &&
      typeof parsed.lockfilePath === 'string') descriptor = parsed;
  } catch (error) { if (!missing(error) && !(error instanceof SyntaxError)) throw error; }
  return { repoId, commitSha: page.commitSha, treeSha: page.treeSha, descriptor, files: page.files,
    nextCursor: page.nextCursor === null ? null :
      Buffer.from(JSON.stringify({ s: page.commitSha, c: page.nextCursor })).toString('base64url') };
}
