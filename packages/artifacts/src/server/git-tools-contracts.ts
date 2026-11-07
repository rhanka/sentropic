import type { GitBindingStore, GitCodeRightsPort } from './git-contracts.js';
import type { GitRepositoryRegistry } from './git-registry.js';
import type { GitPort } from './git-port.js';

export interface GitToolInvocation { actorId: string; storageScopeId: string; invocationId: string }
/** Server-resolved artifact authority; never a tool argument. G0 v3 §1.4: owner + host write scope. */
export interface GitToolAuthority { ownerId: string; canWrite: boolean }
export type GitBuildJobState = 'build_pending' | 'building' | 'published' | 'build_failed' | 'cancelled';
/** G0 v3 §2.6: the persisted job identity; the release CAS and the SHA are never caller-editable later. */
export interface GitBuildJobRequest {
  storageScopeId: string; artifactId: string; repoId: string; branch: string; subPath: string;
  commitSha: string; bindingGeneration: number; expectedCurrentReleaseId: string | null;
  executor: 'caller' | 'ci' | 'sandbox'; requestedBy: string; idempotencyKey: string;
}
/** Build executor port: persists the job before returning its id; the same principal key returns the same job. */
export interface GitBuildPort {
  /** Executor gate (G0 v3 §3.3, A-LIVE S03): false closes the executor with builder_unavailable. */
  admits(executor: 'caller' | 'ci' | 'sandbox'): Promise<boolean>;
  request(job: GitBuildJobRequest): Promise<{ jobId: string; state: GitBuildJobState }>;
}
export interface GitToolsDeps {
  bindings: GitBindingStore;
  registry: GitRepositoryRegistry;
  codeRights: GitCodeRightsPort;
  git: GitPort;
  authorize(invocation: GitToolInvocation, artifactId: string): Promise<GitToolAuthority>;
  /** Absent ⇒ git_publish fails closed with provider_unavailable (503 capability_unavailable). */
  build?: GitBuildPort;
  /** Descriptor output subtree resolved by the host; excluded from writes. */
  outputDir?: string;
  /** Journal of every source read: repoId + resolved SHA (G0 v3 §1.4). */
  journal?: (entry: { actorId: string; repoId: string; commitSha: string; invocationId: string }) => void | Promise<void>;
  now?: () => Date;
}
export interface GitToolService {
  execute(operation: string, args: Record<string, unknown>, invocation: GitToolInvocation): Promise<Record<string, any>>;
}
