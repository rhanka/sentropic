import { createHash } from 'node:crypto';
import {
  computePolicyDigest,
  ContentPolicyError,
  POLICY_FORMAT,
  validateChannelRetention,
} from '@sentropic/cluster-mesh';

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
  baseDenialFloor: number;
  activations: Map<string, ActivationAck>;
  captureEligible: boolean;
  purge: { status: 'purge_pending' | 'purged'; initiatedWhileDisconnected: boolean; settledBy: string | null } | null;
  backupExpired: boolean;
  sourceDisconnected: boolean;
  auditRetainUntil: number;
}

export interface PurgeInput {
  readonly policyId: string;
  readonly scope: string;
}

export interface PurgeState {
  readonly status: 'purge_pending' | 'purged';
  readonly initiatedWhileDisconnected: boolean;
  readonly settledBy: string | null;
}

export interface WriterReceipt {
  readonly writerId: string;
  readonly settledAt: number;
}

export interface AuditProjection {
  readonly policyId: string;
  readonly policyDigest: string;
  readonly retainedPayload: null;
  readonly purge: PurgeState;
  readonly backup: { readonly status: 'active' | 'expired'; readonly expiresAt: number | null };
  /** Audit retention outlives backup expiry (90-day-or-longer metadata obligation). */
  readonly auditRetainUntil: number;
  readonly reason: string;
}

const AUDIT_RETENTION_MS = 90 * 24 * 3600 * 1000;

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
    const channels = policy['channels'];
    if (channels !== undefined && typeof channels === 'object' && channels !== null) {
      try {
        const retentionMap: Record<string, unknown> = {};
        for (const [name, entry] of Object.entries(channels as Record<string, unknown>)) {
          if (entry !== null && typeof entry === 'object' && 'retention' in entry) {
            retentionMap[name] = (entry as Record<string, unknown>)['retention'];
          }
        }
        validateChannelRetention(retentionMap);
      } catch (error) {
        if (error instanceof ContentPolicyError) {
          throw new PolicyStoreError('invalid_request', `retention: ${error.message}`);
        }
        throw error;
      }
    }
    // r2 annex E (W-P3-3): the immutable deadline is null (kind "none") or a
    // safe integer; overflow refuses instead of wrapping.
    if (input.retentionExpiresAt !== null && !Number.isSafeInteger(input.retentionExpiresAt)) {
      throw new PolicyStoreError('invalid_request', 'first-admission deadline must be null or a safe integer');
    }
    // r2 annex E (W-P2-4): sourceConsentRevision zero is unobserved and invalid
    // in an accepted binding; the first verified committed snapshot is 1.
    if (!Number.isSafeInteger(input.ownerConsentRevision) || input.ownerConsentRevision < 1) {
      throw new PolicyStoreError('revision_conflict', 'owner consent revision must be a positive integer');
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
      baseDenialFloor: input.sourceDenialFloor,
      activations: new Map(), captureEligible: false, purge: null,
      backupExpired: false, sourceDisconnected: existing?.sourceDisconnected ?? false,
      auditRetainUntil: gates.now() + AUDIT_RETENTION_MS,
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
    if (stored.purge) throw new PolicyStoreError('purge_pending', 'retained copy is being purged');
    if (stored.firstAdmissionExpiresAt !== null && gates.now() >= stored.firstAdmissionExpiresAt) {
      throw new PolicyStoreError('object_expired', 'retained copy passed its immutable deadline');
    }
    return { expiresAt: stored.firstAdmissionExpiresAt };
  };

  const raiseDenial = (policyId: string, floor: number): void => {
    get(policyId).denialFloor = floor;
  };

  const clearDenial = (policyId: string): void => {
    const stored = get(policyId);
    stored.denialFloor = stored.baseDenialFloor;
  };

  const isCaptureEligible = (policyId: string): boolean =>
    admissions.get(policyId)?.captureEligible ?? false;

  const initiatePurge = (input: PurgeInput): PurgeState => {
    const stored = get(input.policyId);
    if (!stored.purge) {
      stored.purge = {
        status: 'purge_pending',
        initiatedWhileDisconnected: stored.sourceDisconnected,
        settledBy: null,
      };
    }
    return { ...stored.purge };
  };

  const settlePurge = (
    input: { readonly policyId: string; readonly writerReceipt: WriterReceipt | null },
  ): PurgeState => {
    const stored = get(input.policyId);
    if (!stored.purge) throw new PolicyStoreError('invalid_request', 'no purge was initiated');
    if (!input.writerReceipt) throw new PolicyStoreError('purge_pending', 'purge awaits writer settlement');
    stored.purge = {
      status: 'purged',
      initiatedWhileDisconnected: stored.purge.initiatedWhileDisconnected,
      settledBy: input.writerReceipt.writerId,
    };
    stored.captureEligible = false;
    return { ...stored.purge };
  };

  const settleBackupExpiry = (input: { readonly policyId: string }): void => {
    get(input.policyId).backupExpired = true;
  };

  const markSourceDisconnected = (policyId: string): void => {
    get(policyId).sourceDisconnected = true;
  };

  const projectAudit = (input: { readonly policyId: string }): AuditProjection => {
    const stored = get(input.policyId);
    return {
      policyId: stored.policyId,
      policyDigest: stored.policyDigest,
      retainedPayload: null,
      purge: stored.purge ? { ...stored.purge } : {
        status: 'purge_pending', initiatedWhileDisconnected: false, settledBy: null,
      },
      backup: stored.backupExpired
        ? { status: 'expired', expiresAt: stored.firstAdmissionExpiresAt }
        : { status: 'active', expiresAt: stored.firstAdmissionExpiresAt },
      auditRetainUntil: stored.auditRetainUntil,
      reason: stored.purge?.status === 'purged' ? 'purge_settled' : 'admission_active',
    };
  };

  return {
    admitPolicy, get, failClosed, commitActivation, commitReceipt, refreshCapture,
    readRetained, raiseDenial, clearDenial, isCaptureEligible,
    initiatePurge, settlePurge, settleBackupExpiry, markSourceDisconnected, projectAudit,
  };
};

export type PolicyStore = ReturnType<typeof createPolicyStore>;
