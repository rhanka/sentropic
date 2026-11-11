import type { GitBinding } from './git-contracts.js';
import type { GitPort, GitPortRepository, GitPortTarget } from './git-port.js';
import type { LiveKeyPort } from './live-crypto.js';
import type { LiveDraftRecord, LiveIdentity, LiveStore, LiveTransaction } from './live-store.js';
import type { PrincipalDirectoryPort } from './ports.js';
export interface LiveInvocation { actorId: string; storageScopeId: string; invocationId: string }
export interface LiveAuthority {
  binding: GitBinding; ownerId: string; canReadCode: boolean; canWrite: boolean;
  humanLinked: boolean; qualified: boolean; invited?: boolean;
  repository: GitPortRepository; target: GitPortTarget;
}
/** A binding accepts live writers while attached, and after a terminal build failure: the failed job is over, and
 * only edits and a new commit can repair the build (a pending job still refuses with pending_publication). */
export const liveWritable = (state: GitBinding['state']): boolean => state === 'attached' || state === 'build_failed';
export interface LiveWorkerFailure { code: string; reason: string }
export interface LiveWorkerPort {
  /** Trusted controller reads the authoritative store; no draft key or store API enters the worker. */
  reconcile(identity: LiveIdentity): Promise<void | { liveSessionId: string; leaseEpoch: number;
    routeEpoch: number; revision: string; ready: boolean; failure?: LiveWorkerFailure }>;
  /** Confirms quiescence, durable checkpoint and complete pod/volume decommissioning. A total stop
   * answers without touching the runtime when it holds no (or no longer this) session, so a re-driven
   * stop converges instead of replaying a refusal. */
  stop(input: LiveIdentity & { liveSessionId: string; leaseEpoch: number }): Promise<void>;
}
export interface LiveInvitationRevoked { storageScopeId: string; artifactId: string; liveSessionId: string;
  bindingGeneration: number; invitationId: string; epoch: number }
/** Host invitation port. Invited live readers stay opt-in: `qualified !== true` keeps live owner-only. */
export interface LiveInvitationPort extends Pick<PrincipalDirectoryPort, 'resolvePrincipal' | 'describePrincipal'> {
  qualified: boolean;
  /** Called once after the revocation commit: close the proxied sockets, then push c1 revoke_invitation.
   * Idempotent; the host retries the push until 204. */
  onRevoked(e: LiveInvitationRevoked): Promise<void>;
}
/** The `invitation` object of the reconcile and grant bodies; `expiresAt` is the latest active expiry (ms). */
export interface LiveInvitationState { epoch: number; expiresAt: number | null }
export type LiveViewer = { role: 'binding_owner' } |
  { role: 'invitee'; invitation: { id: string; epoch: number; expiresAt: number } } | null;
export interface LiveServiceDeps {
  store: LiveStore; keys: LiveKeyPort; git: GitPort; worker?: LiveWorkerPort;
  authorize(invocation: LiveInvocation, artifactId: string): Promise<LiveAuthority>;
  now?: () => number;
  /** Narrower qualified git_commit limits; never above 255 paths / 8 MiB. */
  commitPathsMax?: number; commitBytesMax?: number;
  gitMessageMaxUnits?: number; idempotencyKeyMaxUnits?: number;
  invitations?: LiveInvitationPort;
  /** Observer of every worker settle that did not complete: 'failed' carries the typed code of the refusal, 'pending'
   * a worker that is not ready yet. A terminal builder failure also carries its reason and moves the runtime to
   * DORMANT with `code:reason` as stateDetail, so the host stops re-driving it. The host logs it; a throw is ignored. */
  onWorkerEvent?(event: LiveWorkerEvent): void;
  /** Bounded re-drive tuning. Defaults keep the 60 s host timer safe: at most 4 worker calls in flight,
   * each abandoned after 35 s. Hosts with a faster builder may raise the concurrency; a slower one lowers it. */
  redriveConcurrency?: number;
  /** Per-item settle budget in milliseconds for redriveLiveWorkers (default 35000). Never throws: an expired
   * item reports 'failed' with code 'timeout' and stays pending for the next tick, unless it already moved. */
  redriveItemTimeoutMs?: number;
}
/** 'settled': the worker confirmed and the runtime moved; 'pending': not ready yet; 'failed': the worker refused,
 * was unreachable, timed out, or abandoned the revive (terminal: the runtime moved to DORMANT with the failure as
 * stateDetail and the host stops re-driving it); 'skipped': nothing to do (no worker, or the session is no longer
 * the current one, or a concurrent settle already moved it). */
export type LiveWorkerOutcome = 'settled' | 'pending' | 'failed' | 'skipped';
export interface LiveWorkerEvent { identity: LiveIdentity; action: 'project' | 'stop'; outcome: 'failed' | 'pending';
  code?: string; reason?: string }
export interface LiveRedriveItem extends LiveIdentity { action: 'project' | 'stop'; outcome: LiveWorkerOutcome }
export interface LiveService {
  execute(operation: string, args: Record<string, unknown>, invocation: LiveInvocation): Promise<Record<string, any>>;
}
/** Session state exports for the host reconcile, grant and live proxy paths. */
export interface LiveSessionService extends LiveService {
  liveInvitationState(identity: LiveIdentity): Promise<LiveInvitationState>;
  liveViewer(identity: LiveIdentity, principalId: string): Promise<LiveViewer>;
  /** Settles again every runtime of the scope that still waits for the worker (see redriveLiveWorkers). Never throws
   * for a worker refusal; empty without a worker or without 'LiveStore.pending'. */
  redrive(storageScopeId: string, limit?: number): Promise<LiveRedriveItem[]>;
}
export function liveResponse(record: LiveDraftRecord, currentHeadSha: string, now = Date.now()): Record<string, unknown> {
  return { artifactId: record.artifactId, bindingGeneration: record.bindingGeneration,
    liveRevision: record.revision, revision: record.revision, baseHeadSha: record.baseHeadSha, currentHeadSha,
    liveTreeSha: record.liveTreeSha, durableRevision: record.revision,
    appliedRevision: record.runtime?.appliedRevision ?? null, draftExpiresAt: record.expiresAt,
    runtimeState: record.runtime?.phase ?? 'DORMANT', liveSessionId: record.runtime?.liveSessionId ?? null,
    retentionWarning: record.expiresAt && Date.parse(record.expiresAt) - now < 86400000 ? 'expires_within_24_hours' : null };
}
export type LiveSessionTransaction = LiveTransaction;
export type LiveSnapshot = { actorId: string; revision: string; baseHeadSha: string;
  paths?: string[]; offset: number; kind: 'read' | 'diff'; expiresAt: number };
