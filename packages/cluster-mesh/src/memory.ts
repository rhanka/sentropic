import type { VerifiedInvocationContext } from '@sentropic/contracts';
import { CapabilityGatedError } from './errors.js';
import type { SignedProjectionReference } from './projection.js';

/** Future W-C cache seam. V1 never copies or purges a remote memory snapshot. */
export interface MemoryReplicationPort {
  replicate(reference: SignedProjectionReference): Promise<void>;
  purge(reference: SignedProjectionReference): Promise<void>;
}

export function createGatedMemoryReplication(): MemoryReplicationPort {
  const gated = async () => {
    throw new CapabilityGatedError('memory_replication');
  };
  return { replicate: gated, purge: gated };
}

export interface GraphifyMemoryContractEvidence {
  readonly contractVersion: string;
  readonly fixtureDigest: string;
  readonly releaseEvidenceRef: string;
}

export interface H2aGraphifyMemoryPort<TAuthorization = unknown, TQueryIntent = unknown> {
  readonly evidence: GraphifyMemoryContractEvidence;
  mapAuthorization(context: VerifiedInvocationContext): Promise<TAuthorization | undefined>;
  mapQueryIntent(value: unknown): Promise<TQueryIntent | undefined>;
  evaluateEligibility(input: {
    readonly authorization: TAuthorization;
    readonly queryIntent: TQueryIntent;
  }): Promise<{ readonly eligible: boolean; readonly receiptRef: string }>;
  shadowQueryIntent(input: {
    readonly authorization: TAuthorization;
    readonly queryIntent: TQueryIntent;
    readonly eligibilityReceiptRef: string;
  }): Promise<{ readonly cursorRef: string; readonly receiptRef: string }>;
  revalidateFinal(input: {
    readonly authorization: TAuthorization;
    readonly cursorRef: string;
    readonly receiptRef: string;
  }): Promise<{ readonly accepted: boolean; readonly refusalRef?: string }>;
}

export type GraphifyMemoryAvailability =
  | 'available'
  | 'memory_provider_unavailable'
  | 'memory_provider_unpinned'
  | 'memory_provider_incompatible';

export type GraphifyMemoryShadowResult =
  | { readonly ok: true; readonly cursorRef: string; readonly receiptRef: string }
  | {
    readonly ok: false;
    readonly reason:
      | Exclude<GraphifyMemoryAvailability, 'available'>
      | 'memory_authorization_unavailable'
      | 'memory_query_intent_invalid'
      | 'memory_query_ineligible'
      | 'memory_provider_response_invalid'
      | 'memory_final_revalidation_refused';
    readonly refusalRef?: string;
  };

export interface GraphifyMemoryShadowInput {
  readonly context: VerifiedInvocationContext;
  readonly queryIntent: unknown;
}

export interface GraphifyMemoryShadowAdapter {
  availability(): GraphifyMemoryAvailability;
  shadowQuery(input: GraphifyMemoryShadowInput): Promise<GraphifyMemoryShadowResult>;
}

const hasCompleteEvidence = (evidence: GraphifyMemoryContractEvidence): boolean =>
  evidence.contractVersion.trim().length > 0
  && evidence.fixtureDigest.trim().length > 0
  && evidence.releaseEvidenceRef.trim().length > 0;

export const isGraphifyMemoryProviderCompatible = (
  actual: GraphifyMemoryContractEvidence,
  expected: GraphifyMemoryContractEvidence | undefined,
): boolean => expected !== undefined
  && hasCompleteEvidence(actual)
  && hasCompleteEvidence(expected)
  && actual.contractVersion === expected.contractVersion
  && actual.fixtureDigest === expected.fixtureDigest
  && actual.releaseEvidenceRef === expected.releaseEvidenceRef;

const isOpaqueReference = (value: string): boolean => value.trim().length > 0;

export const createGraphifyMemoryAdapter = <TAuthorization, TQueryIntent>(options: {
  readonly expectedEvidence?: GraphifyMemoryContractEvidence;
  readonly provider?: H2aGraphifyMemoryPort<TAuthorization, TQueryIntent>;
}): GraphifyMemoryShadowAdapter => {
  const availability = (): GraphifyMemoryAvailability => {
    if (!options.provider) return 'memory_provider_unavailable';
    if (!options.expectedEvidence || !hasCompleteEvidence(options.expectedEvidence)) {
      return 'memory_provider_unpinned';
    }
    return isGraphifyMemoryProviderCompatible(options.provider.evidence, options.expectedEvidence)
      ? 'available'
      : 'memory_provider_incompatible';
  };

  return Object.freeze({
    availability,
    async shadowQuery(
      { context, queryIntent }: GraphifyMemoryShadowInput,
    ): Promise<GraphifyMemoryShadowResult> {
      const state = availability();
      if (state !== 'available') return { ok: false, reason: state };
      const provider = options.provider!;
      const authorization = await provider.mapAuthorization(context).catch(() => undefined);
      if (authorization === undefined) {
        return { ok: false, reason: 'memory_authorization_unavailable' };
      }
      const mappedIntent = await provider.mapQueryIntent(queryIntent).catch(() => undefined);
      if (mappedIntent === undefined) return { ok: false, reason: 'memory_query_intent_invalid' };
      try {
        const eligibility = await provider.evaluateEligibility({ authorization, queryIntent: mappedIntent });
        if (!isOpaqueReference(eligibility.receiptRef)) {
          return { ok: false, reason: 'memory_provider_response_invalid' };
        }
        if (!eligibility.eligible) return { ok: false, reason: 'memory_query_ineligible' };
        const queried = await provider.shadowQueryIntent({
          authorization,
          queryIntent: mappedIntent,
          eligibilityReceiptRef: eligibility.receiptRef,
        });
        if (!isOpaqueReference(queried.cursorRef) || !isOpaqueReference(queried.receiptRef)) {
          return { ok: false, reason: 'memory_provider_response_invalid' };
        }
        const final = await provider.revalidateFinal({
          authorization,
          cursorRef: queried.cursorRef,
          receiptRef: queried.receiptRef,
        });
        if (!final.accepted) {
          return {
            ok: false,
            reason: 'memory_final_revalidation_refused',
            ...(final.refusalRef ? { refusalRef: final.refusalRef } : {}),
          };
        }
        return { ok: true, cursorRef: queried.cursorRef, receiptRef: queried.receiptRef };
      } catch {
        return { ok: false, reason: 'memory_provider_unavailable' };
      }
    },
  });
};
