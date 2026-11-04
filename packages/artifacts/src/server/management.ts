import { audienceOf, canManageAccess, PUBLIC_PRINCIPAL,
  type AccessEvent, type AccessMode, type ArtifactAcl, type GrantRecord, type ModeAction } from './access.js';
import { combineSharingPolicy, resolveSharingPolicy, UNKNOWN_USER_REF, type PrincipalDirectoryPort,
  type SharingPolicyPort } from './ports.js';
import type { ArtifactInvocationContext, ArtifactCommitCoordinator, FinalizeTxClient, FinalizeRequest } from './commit/types.js';
import type { EffectiveArtifactCommand } from './command-identity.js';
import { ArtifactOperationError, type ArtifactOutcome } from './failures.js';

export interface ManagementTarget {
  acl: ArtifactAcl;
  state: string;
  terminal: boolean;
  currentReleaseId: string | null;
}
export interface SetAccessOutput {
  grants: GrantRecord[];
  updatedAt: string | null;
  accessMode: AccessMode;
  changed: boolean;
}
export interface ManagementUnit {
  lock(artifactId: string): Promise<void>;
  read(artifactId: string): Promise<ManagementTarget | undefined>;
  setAccess(artifactId: string, principalId: string, action: 'grant' | 'revoke', updatedAt: string): Promise<SetAccessOutput>;
  /** Append-only audit event, written in the same transaction as the mutation. */
  recordEvent(event: AccessEvent): Promise<void>;
  delete(artifactId: string, deletedAt: string): Promise<void>;
}
export interface DeleteConfirmationContext {
  actorId: string;
  storageScopeId: string;
  artifactId: string;
  expectedCurrentReleaseId: string | null;
  commandHash: string;
  internalKey: string;
}
/** Host challenges require trusted human approval; consume on the domain transaction. */
export interface ArtifactConfirmationPort {
  request(context: DeleteConfirmationContext): Promise<{ confirmationRef: string; managementUrl: string; expiresAt: string }>;
  consume(client: FinalizeTxClient, context: DeleteConfirmationContext, confirmationRef: string): Promise<
    'valid' | 'invalid' | 'expired' | 'stale'>;
}
export function confirmationFailure(code: string, details?: Record<string, unknown>): ArtifactOperationError {
  return new ArtifactOperationError('unauthorized_at_commit', { publicDetails: details,
    refusal: { allowed: false, reason: 'denied', publicCode: code,
      status: code === 'confirmation_invalid' ? 403 : 409, retriable: false } });
}
function refused(code: 'gone' | 'not_found' | 'access_denied'): ArtifactOperationError {
  return new ArtifactOperationError('unauthorized_at_commit', { refusal: { allowed: false,
    reason: 'denied', status: code === 'gone' ? 410 : code === 'not_found' ? 404 : 403,
    publicCode: code, retriable: false } });
}
function policyRefused(): ArtifactOperationError {
  return new ArtifactOperationError('unauthorized_at_commit', { refusal: { allowed: false,
    reason: 'denied', status: 403, publicCode: 'public_sharing_disabled', retriable: false } });
}
/** G2 §2.3 step (4): the single merged non-shareable refusal (422), like the policy refusal above. */
function shareableRefused(): ArtifactOperationError {
  return new ArtifactOperationError('unauthorized_at_commit', { refusal: { allowed: false,
    reason: 'denied', status: 422, publicCode: 'person_not_shareable', retriable: false } });
}

/** Targeted writes and proof consumption share the existing coordinator receipt transaction. */
export async function manageArtifact(deps: {
  coordinator: ArtifactCommitCoordinator;
  createUnit(client: FinalizeTxClient): ManagementUnit;
  readPolicyRevision(): Promise<string>;
  isApprovedPrincipal(principalId: string): boolean | Promise<boolean>;
  confirmation?: ArtifactConfirmationPort;
  validateNewCommand?(): void;
  /** G1: runtime lock 2 of the sharing double lock, resolved inside the commit transaction. */
  sharingPolicy?: SharingPolicyPort;
  /** G1: profile lock 1 (deployment capability), absent ⇒ closed. */
  profileAllowPublicSharing?: boolean;
  /** G1: server-resolved platform admin predicate (never a tool argument). */
  actorIsAdmin?: (actorId: string, storageScopeId: string) => boolean | Promise<boolean>;
  /** G2: host principal directory; required for userRef resolution and output projection. */
  directory?: PrincipalDirectoryPort;
}, invocation: ArtifactInvocationContext, command: EffectiveArtifactCommand, proof?: string): Promise<ArtifactOutcome<unknown>> {
  const artifactId = command.payload.artifactId as string;
  const deleting = command.operation === 'delete';
  const access = deleting ? undefined : { action: command.payload.action as ModeAction, principalId: command.payload.principalId as string };
  let unit: ManagementUnit;
  let adminResolved: boolean | undefined;
  const resolveAdmin = async (): Promise<boolean> => {
    if (adminResolved === undefined) {
      adminResolved = (await deps.actorIsAdmin?.(invocation.actorId, invocation.storageScopeId) === true) &&
        (await deps.isApprovedPrincipal(invocation.actorId)) === true;
    }
    return adminResolved;
  };
  const receipt: Record<string, unknown> = {};
  const context: DeleteConfirmationContext = { actorId: invocation.actorId, storageScopeId: invocation.storageScopeId,
    artifactId, expectedCurrentReleaseId: command.payload.expectedCurrentReleaseId as string | null,
    commandHash: command.identity.commandHash, internalKey: command.identity.internalKey };
  // §2.3 order: visibility happened in the transport; here the management right
  // (owner, or server-resolved admin reduce-only) gates every mutation.
  const manageable = async () => {
    const target = await unit.read(artifactId);
    if (!target || target.acl.storageScopeId !== invocation.storageScopeId) throw refused('not_found');
    if (deleting) {
      if (target.acl.ownerId !== invocation.actorId) throw refused('access_denied');
      return target;
    }
    const actorIsAdmin = await resolveAdmin();
    if (!canManageAccess({ acl: target.acl, actorId: invocation.actorId, action: access!.action,
      principalId: access!.principalId, actorIsAdmin })) throw refused('access_denied');
    return target;
  };
  const sharingPolicy = async () => combineSharingPolicy(deps.profileAllowPublicSharing,
    await resolveSharingPolicy(deps.sharingPolicy, invocation.storageScopeId));
  // G2 §2.3 step (4): resolve the opaque userRef to the internal principal
  // inside the transaction, after visibility and the management right — the
  // commandHash was computed on the payload as provided (userRef), so no
  // resolution can leak to a non-reader. Without a directory port, legacy
  // trusted callers keep passing internal principals directly (G1 behaviour).
  const resolveTarget = async (principalId: string): Promise<string> => {
    if (deps.directory === undefined) return principalId;
    return await deps.directory.resolvePrincipal(invocation.storageScopeId, principalId) ?? principalId;
  };
  // Unknown, inactive, unapproved and out-of-scope targets merge into the
  // single `person_not_shareable` so no account status can be probed. R5: the
  // approval gate applies to `grant` only; `revoke` is the expected cleanup
  // step for dormant (suspended or deleted) principals and must stay allowed.
  const assertShareable = async (internal: string, action: ModeAction): Promise<void> => {
    if (action !== 'grant') return;
    if (deps.directory === undefined) {
      if (!await deps.isApprovedPrincipal(internal)) throw refused('access_denied');
      return;
    }
    if (!await deps.isApprovedPrincipal(internal)) throw shareableRefused();
  };
  // The receipt is model-visible: project internal principals to userRefs
  // (audit events keep the internal form). R1: a missing directory entry
  // projects to the opaque unknown value, never the raw internal id.
  const projectGrants = async (grants: GrantRecord[]): Promise<GrantRecord[]> => {
    if (deps.directory === undefined) return grants;
    return Promise.all(grants.map(async (grant) => ({
      ...grant,
      principalId: (await deps.directory!.describePrincipal(invocation.storageScopeId, grant.principalId))?.userRef
        ?? UNKNOWN_USER_REF,
    })));
  };
  const request: FinalizeRequest = {
    ...command.identity, scopeId: invocation.storageScopeId, actorId: invocation.actorId,
    invocationId: invocation.invocationId, operation: command.operation, artifactId,
    policyRevision: await deps.readPolicyRevision(), receiptData: receipt,
    locks: { 'artifact-lifecycle': [async (client) => {
      unit = deps.createUnit(client);
      await unit.lock(artifactId);
      await manageable();
    }] },
    provisional: async (client) => {
      const target = await manageable();
      if (target.terminal || target.state === 'deleted' || target.state === 'purged') throw refused('gone');
      const now = new Date().toISOString();
      if (deleting) {
        // Bind omitted v1 input to the locked confirmation context, without rewriting the command.
        if (!Object.hasOwn(command.payload, 'expectedCurrentReleaseId')) context.expectedCurrentReleaseId = target.currentReleaseId;
        if (target.currentReleaseId !== context.expectedCurrentReleaseId) {
          if (proof) throw confirmationFailure('confirmation_stale');
          throw new ArtifactOperationError('pointer_conflict');
        }
        if (!deps.confirmation) throw new ArtifactOperationError('provider_unavailable');
        if (!proof) throw confirmationFailure('confirmation_required', await deps.confirmation.request(context));
        const verdict = await deps.confirmation.consume(client, context, proof);
        if (verdict !== 'valid') throw confirmationFailure(`confirmation_${verdict}`);
        await unit.delete(artifactId, now);
        Object.assign(receipt, { artifactId, state: 'deleted', terminal: true, deletedAt: now, purgeState: 'pending' });
      } else {
        const { action, principalId } = access!;
        const audience = audienceOf(principalId);
        const internal = audience === 'user' ? await resolveTarget(principalId) : principalId;
        if (audience === 'user') await assertShareable(internal, action);
        // Double lock (profile capability AND runtime port) resolved in the
        // transaction; the revision rides the receipt/audit, never the commandHash.
        const policy = await sharingPolicy();
        if (action === 'grant' && principalId === PUBLIC_PRINCIPAL && !policy.allowPublicSharing) throw policyRefused();
        const output = await unit.setAccess(artifactId, internal, action, now);
        await unit.recordEvent({ artifactId, actorId: invocation.actorId, action, audience,
          principalId: audience === 'user' ? internal : null, policyRevision: policy.policyRevision });
        Object.assign(receipt, { artifactId, ...output, grants: await projectGrants(output.grants),
          policyRevision: policy.policyRevision });
      }
    },
    guard: async (ctx, tx) => {
      const target = await manageable();
      if (!deleting && (target.terminal || target.state === 'deleted' || target.state === 'purged')) throw refused('gone');
      if (!deleting) {
        const { action, principalId } = access!;
        const audience = audienceOf(principalId);
        if (audience === 'user') {
          const internal = await resolveTarget(principalId);
          await assertShareable(internal, action);
        }
        const policy = await sharingPolicy();
        if (action === 'grant' && principalId === PUBLIC_PRINCIPAL && !policy.allowPublicSharing) throw policyRefused();
      }
      return invocation.authorizeCommit(ctx, tx);
    },
    validateReplayReceipt: (stored) => (stored.receipt as Record<string, unknown>)?.artifactId === artifactId,
  };
  const replay = await deps.coordinator.findReplayPrepared(request);
  if (replay === undefined) deps.validateNewCommand?.();
  const result = replay ?? await deps.coordinator.finalizePrepared(request);
  return result.ok ? { ...result, result: result.result.receipt }
    : { ok: false, failure: { ...result.failure, kind: 'operational' } };
}
