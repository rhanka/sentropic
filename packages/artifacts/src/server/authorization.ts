/**
 * L-5a — object-level authorization (spec-v8 §9).
 *
 * Private artifacts are owner-only: the acting user must equal the recorded
 * artifact owner for both read and mutate. Anything else — forged owner,
 * anonymous actor, empty owner — is denied fail-closed. There are no sharing
 * grants in this lot (sharing arrives with L-5c access.ts), so the action
 * set is closed: unknown actions are refused rather than defaulted.
 */
export type ArtifactAction = 'read' | 'mutate';

export interface AccessRequest {
  actorUserId: string;
  artifactOwnerId: string;
  action: string;
}

/** Assert owner-only access; throws fail-closed on any mismatch. */
export function assertArtifactAccess(request: AccessRequest): void {
  if (request.action !== 'read' && request.action !== 'mutate') {
    throw new Error(`access denied: unknown action ${request.action}`);
  }
  if (request.actorUserId.length === 0 || request.artifactOwnerId.length === 0) {
    throw new Error('access denied: anonymous actor or empty owner');
  }
  if (request.actorUserId !== request.artifactOwnerId) {
    throw new Error('access denied: not the artifact owner');
  }
}
