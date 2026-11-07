/** G0 FROZEN v3 §2. Host records; never release profile or tool-definition state. */
export interface GitLiveSession {
  liveSessionId: string;
  bindingGeneration: number;
  requestedBy: string;
  state: 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';
  targetCommitSha: string;
  appliedCommitSha: string | null;
  previewPath: string | null;
  startedAt: string;
  lastActivityAt: string;
  expiresAt: string;
  stateDetail?: string;
}
export interface GitBinding {
  artifactId: string;
  storageScopeId: string;
  repoId: string;
  branch: string;
  channel: 'personal' | 'shared';
  personalPrincipalId: string | null;
  subPath: string;
  baseCommitSha: string;
  headCommitSha: string | null;
  releaseCommitSha: string | null;
  autoPublish: boolean;
  executor: 'caller' | 'ci' | 'sandbox';
  pendingJobId: string | null;
  pendingCommitSha: string | null;
  state: 'attached' | 'syncing' | 'build_pending' | 'build_failed' | 'diverged' | 'paused' | 'detached' | 'error';
  stateDetail?: string;
  generation: number;
  version: number;
  attachedBy: string;
  attachedAt: string;
  updatedAt: string;
  live?: GitLiveSession | null; // Additive GB-live state; absent before GB-live.
}
export interface GitBindingEvent {
  id: string;
  artifactId: string;
  storageScopeId: string;
  actorId: string;
  action: 'attach' | 'pause' | 'resume' | 'detach' | 'commit' | 'inbound' | 'publish' | 'conflict' | 'resolve' | 'error';
  beforeSha?: string;
  afterSha?: string;
  deliveryId?: string;
  invocationId?: string;
  /** A-LIVE §5.3.1: only on the attach event that verified creation of the branch; initialUnpublishedBranchEligible input. */
  branchCreated?: true;
  createdAt: string;
}
export interface GitReleaseIndex {
  releaseId: string;
  artifactId: string;
  repoId: string;
  branch: string;
  commitSha: string;
  treeSha?: string;
  manifestDigest: string;
  candidateDigest: string;
  executor: 'caller' | 'ci' | 'sandbox';
  verification: 'declared' | 'sha-verified' | 'builder-attested';
  receiptId: string;
  jobId: string;
  buildRunId?: string;
  attempt?: number;
  createdAt: string;
}
/** Trusted storage input: SG3 derives commandHash and actor from the invocation, never tool arguments. */
export interface GitBindingWrite {
  binding: GitBinding;
  expectedVersion: number | null;
  actorId: string;
  idempotencyKey: string;
  commandHash: string;
  event: Pick<GitBindingEvent, 'action' | 'beforeSha' | 'afterSha' | 'deliveryId' | 'invocationId' | 'branchCreated'>;
}
/** Written before createBranch, keyed like the replay receipt, so a same-key retry knows the branch is its own. */
export interface GitAttachIntent {
  storageScopeId: string;
  artifactId: string;
  actorId: string;
  idempotencyKey: string;
  commandHash: string;
  repoId: string;
  branch: string;
  baseCommitSha: string;
  createdAt: string;
}
export interface GitBindingStore {
  get(storageScopeId: string, artifactId: string): Promise<GitBinding | undefined>;
  /** Binding, audit and principal-scoped replay receipt commit atomically. */
  write(input: GitBindingWrite): Promise<{ binding: GitBinding; replayed: boolean }>;
  events(storageScopeId: string, artifactId: string): Promise<GitBindingEvent[]>;
  /** Durable put-if-absent by (scope, actor, key); returns the stored intent, which wins over the input. */
  reserveAttachIntent(intent: GitAttachIntent): Promise<GitAttachIntent>;
  attachIntent(storageScopeId: string, actorId: string, idempotencyKey: string): Promise<GitAttachIntent | undefined>;
}
/** SG4 writes the index using its release-transaction client; SG1 provides the record/read port. */
export interface GitReleaseIndexStore {
  get(storageScopeId: string, releaseId: string): Promise<GitReleaseIndex | undefined>;
  forCommit(storageScopeId: string, artifactId: string, commitSha: string): Promise<GitReleaseIndex[]>;
}
/** Repository code access is independent of artifact/page/source grants and shell roles. */
export interface GitCodeRightsPort {
  canReadCode(input: { storageScopeId: string; repoId: string; actorId: string }): Promise<boolean>;
}
