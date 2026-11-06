import type { GitBinding } from './git-contracts.js';
import type { GitPort, GitPortRepository, GitPortTarget } from './git-port.js';
import type { LiveKeyPort } from './live-crypto.js';
import type { LiveDraftRecord, LiveIdentity, LiveStore, LiveTransaction } from './live-store.js';
export interface LiveInvocation { actorId: string; storageScopeId: string; invocationId: string }
export interface LiveAuthority {
  binding: GitBinding; ownerId: string; canReadCode: boolean; canWrite: boolean;
  humanLinked: boolean; qualified: boolean; invited?: boolean;
  repository: GitPortRepository; target: GitPortTarget;
}
export interface LiveWorkerPort {
  /** Trusted controller reads the authoritative store; no draft key or store API enters the worker. */
  reconcile(identity: LiveIdentity): Promise<void | { liveSessionId: string; leaseEpoch: number;
    routeEpoch: number; revision: string; ready: boolean }>;
  /** Confirms quiescence, durable checkpoint and complete pod/volume decommissioning. */
  stop(input: LiveIdentity & { liveSessionId: string; leaseEpoch: number }): Promise<void>;
}
export interface LiveServiceDeps {
  store: LiveStore; keys: LiveKeyPort; git: GitPort; worker?: LiveWorkerPort;
  authorize(invocation: LiveInvocation, artifactId: string): Promise<LiveAuthority>;
  now?: () => number;
  /** Narrower qualified git_commit limits; never above 255 paths / 8 MiB. */
  commitPathsMax?: number; commitBytesMax?: number;
  gitMessageMaxUnits?: number; idempotencyKeyMaxUnits?: number;
}
export interface LiveService {
  execute(operation: string, args: Record<string, unknown>, invocation: LiveInvocation): Promise<Record<string, any>>;
}
export function liveResponse(record: LiveDraftRecord, currentHeadSha: string): Record<string, unknown> {
  return { artifactId: record.artifactId, bindingGeneration: record.bindingGeneration,
    liveRevision: record.revision, revision: record.revision, baseHeadSha: record.baseHeadSha, currentHeadSha,
    liveTreeSha: record.liveTreeSha, durableRevision: record.revision,
    appliedRevision: record.runtime?.appliedRevision ?? null, draftExpiresAt: record.expiresAt,
    runtimeState: record.runtime?.phase ?? 'DORMANT', liveSessionId: record.runtime?.liveSessionId ?? null };
}
export type LiveSessionTransaction = LiveTransaction;
export type LiveSnapshot = { actorId: string; revision: string; baseHeadSha: string;
  paths?: string[]; offset: number; kind: 'read' | 'diff'; expiresAt: number };
