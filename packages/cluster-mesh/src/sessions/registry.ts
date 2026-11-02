import type {
  CommitResult,
  EmitResult,
  ListingGrantRecord,
  ObservationRecord,
  PublishResult,
  RegistryCallOptions,
  RegistryInput,
  SessionOriginIngestCapabilitiesParametersV1,
  SessionOriginIngestLifecycleParametersV1,
  SessionOriginPublishListingParametersV1,
  SessionOriginRenewFreshnessParametersV1,
  SessionOriginSnapshotParametersV1,
  SessionRef,
  Visibility,
} from './registry-types.js';
import { createRegistryState } from './registry-store.js';
import type { RegistryState } from './registry-store.js';
import { ingestCapabilities, ingestLifecycle } from './registry-ingest.js';
import {
  commitSourceAck,
  getListingRow,
  publishListing,
  recordRouteState,
  registerGrant,
  setActivatedRead,
  snapshotSession,
  subscribeListing,
  withdrawGrant,
} from './registry-publish.js';
import {
  isLive,
  renewFreshness,
  restartRegistry,
  signFreshness,
} from './registry-freshness.js';
import {
  assertListingStageRoute,
  emitObservation,
  isQuarantined,
  reportSplitBrain,
} from './registry-admin.js';
import type { ListingRow } from './registry-types.js';

export * from './registry-types.js';

// r2 runtimeComposition: only invalid JavaScript API use (non-object
// parameters/options or a non-AbortSignal signal) throws/rejects TypeError;
// every authority/validation failure stays a typed refusal result.
function assertParameters(parameters: unknown): asserts parameters is Record<string, unknown> {
  if (typeof parameters !== 'object' || parameters === null || Array.isArray(parameters)) {
    throw new TypeError('SessionOriginRegistryPortV1: parameters must be a single named object');
  }
}

function assertOptions(options: unknown): asserts options is RegistryCallOptions | undefined {
  if (options === undefined) return;
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw new TypeError('SessionOriginRegistryPortV1: options must be an object');
  }
  const signal = (options as { readonly signal?: unknown }).signal;
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    throw new TypeError('SessionOriginRegistryPortV1: options.signal must be an AbortSignal');
  }
}

export function createSessionOriginRegistry(input: RegistryInput) {
  const state: RegistryState = createRegistryState(input);
  return {
    registerGrant: (grant: ListingGrantRecord): void => registerGrant(state, grant),
    withdrawGrant: (grantId: string): void => withdrawGrant(state, grantId),
    commitSourceAck: (ref: SessionRef, grantId: string, ackDigest: string): void =>
      commitSourceAck(state, ref, grantId, ackDigest),
    ingestLifecycle: async (
      parameters: SessionOriginIngestLifecycleParametersV1,
      options?: RegistryCallOptions,
    ): Promise<CommitResult> => {
      assertParameters(parameters);
      assertOptions(options);
      return Promise.resolve(
        ingestLifecycle(state, parameters.processBindingRef, parameters.fact),
      );
    },
    ingestCapabilities: async (
      parameters: SessionOriginIngestCapabilitiesParametersV1,
      options?: RegistryCallOptions,
    ): Promise<CommitResult> => {
      assertParameters(parameters);
      assertOptions(options);
      return Promise.resolve(
        ingestCapabilities(state, parameters.processBindingRef, parameters.capabilities),
      );
    },
    publishListing: async (
      parameters: SessionOriginPublishListingParametersV1,
      options?: RegistryCallOptions,
    ): Promise<PublishResult> => {
      assertParameters(parameters);
      assertOptions(options);
      return Promise.resolve(publishListing(state, parameters.sessionRef, parameters.grantRef));
    },
    renewFreshness: async (
      parameters: SessionOriginRenewFreshnessParametersV1,
      options?: RegistryCallOptions,
    ): Promise<PublishResult> => {
      assertParameters(parameters);
      assertOptions(options);
      return Promise.resolve(renewFreshness(state, parameters.sessionRef, parameters.visibility));
    },
    snapshot: async (
      parameters: SessionOriginSnapshotParametersV1,
      options?: RegistryCallOptions,
    ): Promise<PublishResult> => {
      assertParameters(parameters);
      assertOptions(options);
      return Promise.resolve(snapshotSession(state, parameters.sessionRef));
    },
    getListingRow: (ref: SessionRef): ListingRow | null => getListingRow(state, ref),
    grantActivatedRead: (ref: SessionRef): boolean => setActivatedRead(state, ref, true),
    loseActivatedRead: (ref: SessionRef): void => { setActivatedRead(state, ref, false); },
    subscribe: (ref: SessionRef, callback: (event: { readonly kind: string }) => void): (() => void) =>
      subscribeListing(state, ref, callback),
    recordRouteState: (
      ref: SessionRef,
      route: { readonly routeId: string; readonly generation: number; readonly state: string },
    ): boolean => recordRouteState(state, ref, route),
    reportSplitBrain: (
      ref: SessionRef,
      left: { readonly writerEpoch: number; readonly originRevision: number; readonly digest: string },
      right: { readonly writerEpoch: number; readonly originRevision: number; readonly digest: string },
    ): { readonly quarantined: boolean } => reportSplitBrain(state, ref, left, right),
    isQuarantined: (ref: SessionRef): boolean => isQuarantined(state, ref),
    isLive: (ref: SessionRef): boolean => isLive(state, ref),
    assertListingStageRoute: (method: string, path: string): { readonly admitted: boolean } =>
      assertListingStageRoute(state, method, path),
    signFreshness: (ref: SessionRef, visibility: Visibility): never =>
      signFreshness(state, ref, visibility),
    emit: (observation: ObservationRecord): EmitResult => {
      assertParameters(observation);
      return emitObservation(state, observation);
    },
    restart: (): void => restartRegistry(state),
  };
}

export type SessionOriginRegistryPortV1 = ReturnType<typeof createSessionOriginRegistry>;
