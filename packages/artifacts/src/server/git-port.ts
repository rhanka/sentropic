/** Trusted server surface, G0 v3 §2.5/§2.7. Never expose forge locators or leases to tools. */
export interface GitInstallationLeasePort {
  acquire(input: { storageScopeId: string; repoId: string; installationRef: string }): Promise<{
    token: string; expiresAt: string; repositoryId: string;
    permissions: { contents: 'write'; metadata: 'read' }; credentialVersion: string;
  }>;
}
/** Structural subset of SG1's registry; policy and identity come only from host composition. */
export interface GitPortRepository {
  storageScopeId: string; repoId: string; locator: string; installationRef: string;
  branchPrefix: 'artifact/'; allowedSubPaths: string[];
  canWrite: boolean; writablePaths: string[]; refusedWritePaths: string[];
}
export interface GitPortTarget {
  storageScopeId: string; repoId: string; branch: string; subPath: string;
  principalId: string;
  /** Descriptor output subtree resolved by the host, relative to subPath. */
  outputDir: string;
}
export interface GitIdentity { name: string; email: string }
export interface GitHumanDirectory {
  /** Null means no authenticated human linkage. Emails must follow the host's noreply/service policy. */
  resolve(input: { storageScopeId: string; principalId: string }): Promise<GitIdentity | null>;
}
export interface GitSourcePage {
  commitSha: string;
  treeSha: string;
  files: ({ path: string; text: string; encoding: 'utf-8' } | { path: string; base64: string; encoding: 'base64' } |
    { path: string; omitted: 'too_large' | 'over_total_budget' })[];
  nextCursor: string | null;
}
export interface GitCommitInput {
  target: GitPortTarget; expectedHeadSha: string;
  artifactId: string; invocationId: string;
  /** Persisted with SG3's durable intent, reused verbatim for object replay. */
  createdAt: string;
  message: string;
  /** Fully materialized changes after SG3's exactly-once edit application; null deletes. */
  files: { path: string; text: string | null }[];
}
export interface GitPort {
  resolveRef(target: GitPortTarget, ref: string): Promise<string>;
  inspectCommit(target: GitPortTarget, commitSha: string): Promise<GitResolvedCommit>;
  read(target: GitPortTarget, input: { commitSha: string; paths?: string[]; cursor?: string }): Promise<GitSourcePage>;
  commit(input: GitCommitInput): Promise<{ commitSha: string; treeSha: string }>;
  isAncestor(target: GitPortTarget, ancestorSha: string, descendantSha: string): Promise<boolean>;
  createBranch(target: GitPortTarget, baseCommitSha: string): Promise<void>;
}
export interface GitForgeContext { locator: string; token: string }
export interface GitResolvedCommit {
  sha: string; treeSha: string; parents: string[]; message: string; author: GitIdentity; committer: GitIdentity;
}
export interface GitTreeEntry {
  path: string; sha: string; type: 'tree' | 'blob' | 'commit'; mode: string; size?: number;
}
/** Transport failures contain stable codes only. Driver bodies/headers must never escape. */
export class GitForgeError extends Error {
  constructor(readonly code: 'missing' | 'conflict' | 'unavailable' | 'unknown') { super(code); }
}
export interface GitForge {
  repositoryId(context: GitForgeContext): Promise<string>;
  resolve(context: GitForgeContext, ref: string): Promise<GitResolvedCommit>;
  tree(context: GitForgeContext, treeSha: string): Promise<GitTreeEntry[]>;
  blob(context: GitForgeContext, sha: string): Promise<Uint8Array>;
  createTree(context: GitForgeContext, baseTreeSha: string,
    changes: { path: string; text: string | null; mode: string }[]): Promise<string>;
  createCommit(context: GitForgeContext, input: {
    parentSha: string; treeSha: string; message: string; author: GitIdentity; committer: GitIdentity; createdAt: string;
  }): Promise<string>;
  /** Must compare the old SHA atomically. REST update-ref(force=false) alone is insufficient. */
  advance(context: GitForgeContext, branch: string, expectedSha: string, commitSha: string): Promise<void>;
  createBranch(context: GitForgeContext, branch: string, baseSha: string): Promise<void>;
  isAncestor(context: GitForgeContext, ancestorSha: string, descendantSha: string): Promise<boolean>;
}
