import { CapabilityGatedError, InvalidProjectionReferenceError } from './errors.js';
import type { ClusterNodeId } from './membership.js';

export type ProjectionKind = 'human_identity' | 'agent_identity' | 'memory_snapshot';

/** Opaque W-A reference: payload and signature remain owned by the home server. */
export interface SignedProjectionReference {
  readonly kind: ProjectionKind;
  readonly reference: string;
  readonly homeNodeId: ClusterNodeId;
  readonly issuer: string;
  readonly keyId: string;
  readonly signature: string;
}

export interface LocalProjectionPort {
  create(kind: ProjectionKind, localId: string): Promise<SignedProjectionReference>;
  verify(reference: SignedProjectionReference): Promise<boolean>;
  resolve<T>(reference: SignedProjectionReference): Promise<T>;
}

export interface ProjectionDomain {
  project(kind: ProjectionKind, localId: string): Promise<SignedProjectionReference>;
  resolve<T>(reference: SignedProjectionReference): Promise<T>;
}

/** W-A degenerate binding: signed references resolve only on their declared local home node. */
export function createLocalProjectionDomain(input: {
  readonly homeNodeId: ClusterNodeId;
  readonly local: LocalProjectionPort;
}): ProjectionDomain {
  return {
    async project(kind, localId) {
      const reference = await input.local.create(kind, localId);
      if (reference.homeNodeId !== input.homeNodeId || !(await input.local.verify(reference))) {
        throw new InvalidProjectionReferenceError();
      }
      return reference;
    },
    async resolve(reference) {
      if (reference.homeNodeId !== input.homeNodeId) {
        throw new CapabilityGatedError('remote_projection');
      }
      if (!(await input.local.verify(reference))) throw new InvalidProjectionReferenceError();
      return input.local.resolve(reference);
    },
  };
}
