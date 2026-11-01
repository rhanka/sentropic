// @sentropic/llm-mesh/enrollment/agy-cli-import.ts
//
// L1 explicit agy mapping. The package layer enrolls agy as `cloud-code`
// (`providerId` + `accountTransport`); the Sentropic application receiver
// translates that projection to `antigravity` transport, `cloudcode-pa`
// target, `productAccountSource: antigravity`. The application
// `cloud-code` transport targets `gemini` and is refused here, as are mixed
// tuples and wrong clients — before any persistence, acquisition, or
// provider call, with no Gemini fallback.

import { SEAT_AGY_APPLICATION_TUPLE } from './seat-bundle.js';

export interface AgyApplicationTuple {
  transportProviderId: 'antigravity';
  targetProviderId: 'cloudcode-pa';
  productAccountSource: 'antigravity';
}

export interface AgySeatProjectionInput {
  packageProviderId: string;
  packageAccountTransport: string;
  issuingClientRef: string;
  endpointFamily: string;
  ownerScope: string;
  seatRef: string;
  accountBinding: string;
  requestedTargetProviderId: string;
  requestedTransportProviderId: string;
}

export interface AgySeatPersistence {
  persist: (tuple: AgyApplicationTuple, projection: Pick<AgySeatProjectionInput, 'seatRef' | 'accountBinding' | 'ownerScope'>) => Promise<unknown>;
}

export class AgyMappingError extends Error {
  readonly code:
    | 'wrong-target'
    | 'wrong-transport'
    | 'mixed-tuple'
    | 'client-mismatch';
  constructor(
    code: AgyMappingError['code'],
    message: string,
  ) {
    super(message);
    this.name = 'AgyMappingError';
    this.code = code;
  }
}

/** Validate the agy projection and return the exact application tuple. */
export function translateAgySeatToApplication(input: AgySeatProjectionInput): AgyApplicationTuple {
  if (input.packageProviderId !== 'cloud-code' || input.packageAccountTransport !== 'cloud-code') {
    throw new AgyMappingError('client-mismatch', 'agy package identity must be cloud-code enrollment and transport');
  }
  if (typeof input.issuingClientRef !== 'string' || input.issuingClientRef.length === 0) {
    throw new AgyMappingError('client-mismatch', 'agy projection needs the issuing client that released the session');
  }
  if (typeof input.endpointFamily !== 'string' || input.endpointFamily.length === 0) {
    throw new AgyMappingError('client-mismatch', 'agy projection needs its endpoint family');
  }
  const wantsGeminiTarget = input.requestedTargetProviderId === 'gemini';
  const wantsCloudCodeTransport = input.requestedTransportProviderId === 'cloud-code';
  if (wantsGeminiTarget && wantsCloudCodeTransport) {
    throw new AgyMappingError('mixed-tuple', 'agy never maps to the application cloud-code/gemini route');
  }
  if (wantsGeminiTarget) {
    throw new AgyMappingError('wrong-target', 'agy target must be cloudcode-pa, never gemini');
  }
  if (wantsCloudCodeTransport) {
    throw new AgyMappingError('wrong-transport', 'agy application transport must be antigravity, never cloud-code');
  }
  if (
    input.requestedTargetProviderId !== SEAT_AGY_APPLICATION_TUPLE.targetProviderId ||
    input.requestedTransportProviderId !== SEAT_AGY_APPLICATION_TUPLE.transportProviderId
  ) {
    throw new AgyMappingError('mixed-tuple', 'agy tuple must be exactly antigravity/cloudcode-pa');
  }
  return { ...SEAT_AGY_APPLICATION_TUPLE };
}

/**
 * Persist a validated agy projection. Validation runs first: any refusal
 * returns before `deps.persist` is touched, so the persistence spy
 * discriminates acceptance from refusal.
 */
export async function persistAgySeatProjection(
  input: AgySeatProjectionInput,
  deps: AgySeatPersistence,
): Promise<AgyApplicationTuple> {
  const tuple = translateAgySeatToApplication(input);
  await deps.persist(tuple, {
    seatRef: input.seatRef,
    accountBinding: input.accountBinding,
    ownerScope: input.ownerScope,
  });
  return tuple;
}
