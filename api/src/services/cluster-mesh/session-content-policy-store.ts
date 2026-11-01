import { createHash } from 'node:crypto';
import { computePolicyDigest, POLICY_FORMAT } from '@sentropic/cluster-mesh';

export { POLICY_FORMAT };

/** Fail-closed error codes for the policy store. No activation without R15. */
export type PolicyStoreErrorCode =
  | 'invalid_request' | 'policy_digest_mismatch' | 'r15_unaccepted' | 'authority_unavailable'
  | 'storage_unavailable' | 'revision_conflict' | 'denial_active'
  | 'source_reauthorization_required' | 'object_expired' | 'purge_pending' | 'expired';

export class PolicyStoreError extends Error {
  constructor(readonly code: PolicyStoreErrorCode, message: string) {
    super(message);
    this.name = 'PolicyStoreError';
  }
}

/**
 * External gates for the store. Every source-gap input stays fail-closed:
 * R15 unaccepted refuses activation, missing identity refuses authority,
 * missing durable writer or storage refuses durable commits. Nothing is
 * invented when a gate is closed.
 */
export interface PolicyStoreGates {
  readonly r15Accepted: boolean;
  readonly identityAvailable: boolean;
  readonly durableWriterAvailable: boolean;
  readonly storageAvailable: boolean;
  readonly now: () => number;
}

export interface AdmitPolicyInput {
  readonly policy: Record<string, unknown>;
  readonly purpose: 'share' | 'amend';
  readonly policyRevision: number;
  readonly priorRevision: number;
  readonly priorDigest: string | null;
  readonly approvedRegistrationRef: { readonly id: string; readonly revision: number };
  readonly ownerConsentRevision: number;
  readonly membershipRevision: number;
  readonly sourceDenialFloor: number;
  /** Immutable first-admission deadline; amend must repeat it exactly. */
  readonly retentionExpiresAt: number | null;
}

export interface AdmittedPolicy {
  readonly policyId: string;
  readonly policyRevision: number;
  readonly policyDigest: string;
  readonly firstAdmissionExpiresAt: number | null;
}

export interface ActivationInput {
  readonly policyId: string;
  readonly operationId: string;
  readonly proposalId: string;
  readonly nonceId: string;
  readonly policyDigest: string;
  readonly targetDigest: string;
  readonly denialFloor: number;
}

export interface ActivationAck {
  readonly phase: 'native-consumed';
  readonly policyId: string;
  readonly operationId: string;
  readonly ackDigest: string;
}

interface StoredAdmission extends AdmittedPolicy {
  sourceBindingDigest: string;
  denialFloor: number;
  activations: Map<string, ActivationAck>;
  captureEligible: boolean;
}

export const digestJson = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value) ?? 'null', 'utf8').digest('hex');

export const validTargetDigest = (value: string): boolean => /^[0-9a-f]{64}$/.test(value);

/** In-memory policy/admission/cursor/outbox/purge store behind the frozen contract shape. */
export const createPolicyStore = (gates: PolicyStoreGates) => {
  const admissions = new Map<string, StoredAdmission>();

  const failClosed = (): void => {
    if (!gates.r15Accepted) throw new PolicyStoreError('r15_unaccepted', 'R15 supplement not accepted');
    if (!gates.identityAvailable) {
      throw new PolicyStoreError('authority_unavailable', 'receiving identity tuple unavailable');
    }
    if (!gates.durableWriterAvailable || !gates.storageAvailable) {
      throw new PolicyStoreError('storage_unavailable', 'durable store writer unavailable');
    }
  };

  const get = (policyId: string): StoredAdmission => {
    const stored = admissions.get(policyId);
    if (!stored) throw new PolicyStoreError('invalid_request', `unknown policy ${policyId}`);
    return stored;
  };

  const admitPolicy = (input: AdmitPolicyInput): AdmittedPolicy => {
    failClosed();
    const policy = input.policy;
    if (policy['format'] !== POLICY_FORMAT || policy['kind'] !== 'policy') {
      throw new PolicyStoreError('invalid_request', 'policy must carry the frozen supplement format/kind');
    }
    const policyId = policy['policyId'];
    if (typeof policyId !== 'string' || policyId.length === 0) {
      throw new PolicyStoreError('invalid_request', 'policyId must be a nonempty string');
    }
    if (policy['policyRevision'] !== input.policyRevision) {
      throw new PolicyStoreError('invalid_request', 'signed revision must match the admission revision');
    }
    const digest = computePolicyDigest(policy);
    const sourceBinding = policy['sourceBinding'];
    if (sourceBinding === undefined) {
      throw new PolicyStoreError('invalid_request', 'policy sourceBinding is required');
    }
    const existing = admissions.get(policyId);
    if (input.purpose === 'share') {
      if (existing) throw new PolicyStoreError('revision_conflict', 'share policy already admitted');
      if (input.priorRevision !== 0 || input.priorDigest !== null) {
        throw new PolicyStoreError('invalid_request', 'share starts with no prior revision');
      }
    } else {
      if (!existing) throw new PolicyStoreError('revision_conflict', 'amend requires an admitted policy');
      if (input.priorRevision !== existing.policyRevision || input.priorDigest !== existing.policyDigest) {
        throw new PolicyStoreError('revision_conflict', 'amend must bind the exact prior revision/digest');
      }
      if (input.retentionExpiresAt !== existing.firstAdmissionExpiresAt) {
        throw new PolicyStoreError('invalid_request', 'amend cannot extend the first-admission deadline');
      }
    }
    const admitted: StoredAdmission = {
      policyId, policyRevision: input.policyRevision, policyDigest: digest,
      firstAdmissionExpiresAt: input.retentionExpiresAt,
      sourceBindingDigest: digestJson(sourceBinding), denialFloor: input.sourceDenialFloor,
      activations: new Map(), captureEligible: false,
    };
    admissions.set(policyId, admitted);
    const { activations: _omit, ...exposed } = admitted;
    return exposed;
  };

  const commitActivation = (input: ActivationInput): ActivationAck => {
    failClosed();
    const stored = get(input.policyId);
    if (!validTargetDigest(input.targetDigest)) {
      throw new PolicyStoreError('invalid_request', 'targetDigest must be 64 lowercase hex');
    }
    if (input.policyDigest !== stored.policyDigest) {
      throw new PolicyStoreError('policy_digest_mismatch', 'activation must reference the admitted digest');
    }
    if (input.denialFloor !== stored.denialFloor) {
      throw new PolicyStoreError('denial_active', 'concurrent denial dominates activation');
    }
    const replayKey = `${input.operationId}:${input.policyDigest}`;
    const duplicate = stored.activations.get(replayKey);
    if (duplicate) return duplicate;
    if (stored.activations.size > 0) {
      throw new PolicyStoreError('revision_conflict', 'mutation under another operation refuses');
    }
    const ack: ActivationAck = {
      phase: 'native-consumed', policyId: input.policyId, operationId: input.operationId,
      ackDigest: digestJson([input.policyId, input.operationId, input.policyDigest, input.targetDigest]),
    };
    stored.activations.set(replayKey, ack);
    return ack;
  };

  const commitReceipt = (
    input: { readonly policyId: string; readonly operationId: string; readonly ackDigest: string; readonly policyDigest: string },
  ): { readonly phase: 'activation-committed'; readonly policyId: string; readonly operationId: string; readonly authorityRevision: number } => {
    failClosed();
    const stored = get(input.policyId);
    const ack = stored.activations.get(`${input.operationId}:${input.policyDigest}`);
    if (!ack || ack.ackDigest !== input.ackDigest) {
      throw new PolicyStoreError('invalid_request', 'receipt must match a committed activation');
    }
    stored.captureEligible = true;
    // Separate durable A activation transaction coordinate, never the policyRevision.
    const authorityRevision = 100 + stored.activations.size;
    return { phase: 'activation-committed', policyId: input.policyId, operationId: input.operationId, authorityRevision };
  };

  const refreshCapture = (
    input: { readonly policyId: string; readonly newTarget: { readonly connectionId: string; readonly connectionGeneration: number }; readonly stableSourceBinding: Record<string, unknown> },
  ): { readonly policyId: string; readonly connectionId: string; readonly retainedExpiresAt: number | null } => {
    failClosed();
    const stored = get(input.policyId);
    if (!stored.captureEligible) {
      throw new PolicyStoreError('invalid_request', 'capture requires a committed activation');
    }
    if (digestJson(input.stableSourceBinding) !== stored.sourceBindingDigest) {
      throw new PolicyStoreError('source_reauthorization_required', 'stable binding change needs new intent');
    }
    return {
      policyId: input.policyId, connectionId: input.newTarget.connectionId,
      retainedExpiresAt: stored.firstAdmissionExpiresAt,
    };
  };

  const readRetained = (input: { readonly policyId: string }): { readonly expiresAt: number | null } => {
    const stored = get(input.policyId);
    if (stored.firstAdmissionExpiresAt !== null && gates.now() >= stored.firstAdmissionExpiresAt) {
      throw new PolicyStoreError('object_expired', 'retained copy passed its immutable deadline');
    }
    return { expiresAt: stored.firstAdmissionExpiresAt };
  };

  const raiseDenial = (policyId: string, floor: number): void => {
    get(policyId).denialFloor = floor;
  };

  const clearDenial = (policyId: string): void => {
    get(policyId).denialFloor = 3;
  };

  const isCaptureEligible = (policyId: string): boolean =>
    admissions.get(policyId)?.captureEligible ?? false;

  return {
    admitPolicy, get, failClosed, commitActivation, commitReceipt, refreshCapture,
    readRetained, raiseDenial, clearDenial, isCaptureEligible,
  };
};

export type PolicyStore = ReturnType<typeof createPolicyStore>;
