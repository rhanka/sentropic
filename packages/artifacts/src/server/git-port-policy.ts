import { ArtifactOperationError } from './failures.js';
import type { GitPortRepository, GitPortTarget } from './git-port.js';

export const isGitSha = (sha: string): boolean => /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sha);
export function assertGitSha(sha: string): void {
  if (!isGitSha(sha)) throw new ArtifactOperationError('invalid_request');
}
export function assertGitBranch(branch: string): void {
  if (!branch.startsWith('artifact/') || /[\x00-\x20\x7f~^:?*\[\\]/.test(branch) ||
    branch.includes('..') || branch.includes('@{') || branch.endsWith('.') ||
    branch.split('/').some(p => !p || p.startsWith('.') || p.endsWith('.lock'))) {
    throw new ArtifactOperationError('git_ref_not_allowed');
  }
}
export function assertGitReadRef(ref: string): void {
  if (!ref || ref.length > 1024 || /[\x00-\x20\x7f~^:?*\[\\]/.test(ref) || ref.includes('..') ||
    ref.includes('@{') || ref.endsWith('.') || ref.split('/').some(p => !p || p.startsWith('.') || p.endsWith('.lock'))) {
    throw new ArtifactOperationError('git_ref_not_allowed');
  }
}
export function assertGitTarget(repo: GitPortRepository, target: GitPortTarget, write: boolean): void {
  if (repo.storageScopeId !== target.storageScopeId || repo.repoId !== target.repoId) {
    throw new ArtifactOperationError('git_repo_not_registered');
  }
  if (!repo.allowedSubPaths.includes(target.subPath) || (write && !repo.canWrite)) {
    throw new ArtifactOperationError('git_ref_not_allowed');
  }
  if (write) assertGitBranch(target.branch); else assertGitReadRef(target.branch);
  if (target.subPath) safePath(target.subPath);
  safePath(target.outputDir);
}
function refused(path: string, reason: string): never {
  throw new ArtifactOperationError('git_path_refused', { publicDetails: { path, reason } });
}
function safePath(path: string): void {
  if (!path || Buffer.byteLength(path) > 1024 || Buffer.from(path).toString('utf8') !== path ||
    /[\x00-\x1f\x7f\\%:?#]/.test(path) || path !== path.normalize('NFC') ||
    path.split('/').some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p))) refused(path, 'noncanonical');
  for (const part of path.split('/')) {
    if (/^(?:\.git|\.github|\.ssh|\.npmrc)$/i.test(part) || /^\.yarnrc/i.test(part) || /^\.env/i.test(part) ||
      /\.(?:pem|key|p12|pfx|p8|jks|keystore)$/i.test(part) ||
      /^(?:id_(?:rsa|dsa|ecdsa|ed25519)|private[_-]?key)(?:\.|$)/i.test(part)) refused(path, 'reserved');
  }
}
/** Small host-glob language: * stays inside one segment; ** spans complete subtrees. */
export function matchesGitGlob(path: string, glob: string): boolean {
  const segment = (part: string) => new RegExp(`^${part.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`);
  const parts = path.split('/'); const pattern = glob.split('/');
  function match(i: number, j: number): boolean {
    if (j === pattern.length) return i === parts.length;
    if (pattern[j] === '**') return match(i, j + 1) || (i < parts.length && match(i + 1, j));
    return i < parts.length && segment(pattern[j]).test(parts[i]) && match(i + 1, j + 1);
  }
  // A basename-only denial (package*.json) applies at every depth.
  return !glob.includes('/') ? segment(glob).test(parts.at(-1)!) : match(0, 0);
}
export function gitPath(repo: GitPortRepository, target: GitPortTarget, path: string, write: boolean): string {
  safePath(path);
  const full = target.subPath ? `${target.subPath}/${path}` : path;
  safePath(full);
  if (write) {
    const output = target.outputDir;
    if (`/${path}/`.includes(`/${output}/`) || repo.refusedWritePaths.some(g => matchesGitGlob(full, g)) ||
      !repo.writablePaths.some(g => matchesGitGlob(full, g))) refused(path, 'write_policy');
  }
  return full;
}
