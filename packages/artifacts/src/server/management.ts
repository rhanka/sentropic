import type { ArtifactAcl } from './access.js';
import type { ArtifactInvocationContext, ArtifactCommitCoordinator, FinalizeTxClient } from './commit/types.js';
import type { EffectiveArtifactCommand } from './command-identity.js';
import { ArtifactOperationError, type ArtifactOutcome } from './failures.js';

export interface ManagementTarget {
  acl: ArtifactAcl;
  state: string;
  terminal: boolean;
  currentReleaseId: string | null;
}
export interface ManagementUnit {
  lock(artifactId: string): Promise<void>;
  read(artifactId: string): Promise<ManagementTarget | undefined>;
  setAccess(artifactId: string, principalId: string, action: 'grant' | 'revoke', updatedAt: string): Promise<{ grants: unknown; updatedAt: string | null }>;
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

/** Targeted writes and proof consumption share the existing coordinator receipt transaction. */
export async function manageArtifact(deps: {
  coordinator: ArtifactCommitCoordinator;
  createUnit(client: FinalizeTxClient): ManagementUnit;
  readPolicyRevision(): Promise<string>;
  isApprovedPrincipal(principalId: string): boolean | Promise<boolean>;
  confirmation?: ArtifactConfirmationPort;
}, invocation: ArtifactInvocationContext, command: EffectiveArtifactCommand, proof?: string): Promise<ArtifactOutcome<unknown>> {
  const artifactId = command.payload.artifactId as string;
  const deleting = command.operation === 'delete';
  let unit: ManagementUnit;
  const receipt: Record<string, unknown> = {};
  const context: DeleteConfirmationContext = { actorId: invocation.actorId, storageScopeId: invocation.storageScopeId,
    artifactId, expectedCurrentReleaseId: command.payload.expectedCurrentReleaseId as string | null,
    commandHash: command.identity.commandHash, internalKey: command.identity.internalKey };
  const owned = async () => {
    const target = await unit.read(artifactId);
    if (!target || target.acl.storageScopeId !== invocation.storageScopeId) throw refused('not_found');
    if (target.acl.ownerId !== invocation.actorId) throw refused('access_denied');
    return target;
  };
  const result = await deps.coordinator.finalizePrepared({
    ...command.identity, scopeId: invocation.storageScopeId, actorId: invocation.actorId,
    invocationId: invocation.invocationId, operation: command.operation, artifactId,
    policyRevision: await deps.readPolicyRevision(), receiptData: receipt,
    locks: { 'artifact-lifecycle': [async (client) => {
      unit = deps.createUnit(client);
      await unit.lock(artifactId);
      await owned();
    }] },
    provisional: async (client) => {
      const target = await owned();
      if (target.terminal || target.state === 'deleted' || target.state === 'purged') throw refused('gone');
      const now = new Date().toISOString();
      if (deleting) {
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
        const principalId = command.payload.principalId as string;
        if (command.payload.action === 'grant' && !await deps.isApprovedPrincipal(principalId)) throw refused('access_denied');
        const output = await unit.setAccess(artifactId, principalId, command.payload.action as 'grant' | 'revoke', now);
        Object.assign(receipt, { artifactId, isPublic: false, ...output });
      }
    },
    guard: async (ctx, tx) => {
      const target = await owned();
      if (!deleting && (target.terminal || target.state === 'deleted' || target.state === 'purged')) throw refused('gone');
      if (!deleting && command.payload.action === 'grant' && !await deps.isApprovedPrincipal(command.payload.principalId as string)) throw refused('access_denied');
      return invocation.authorizeCommit(ctx, tx);
    },
    validateReplayReceipt: (stored) => (stored.receipt as Record<string, unknown>)?.artifactId === artifactId,
  });
  return result.ok ? { ...result, result: result.result.receipt }
    : { ok: false, failure: { ...result.failure, kind: 'operational' } };
}
