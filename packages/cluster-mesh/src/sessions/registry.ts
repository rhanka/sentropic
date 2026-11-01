import type {
  CapabilitiesRecord,
  CommitResult,
  EmitResult,
  LifecycleFact,
  ListingGrantRecord,
  ObservationRecord,
  ProcessBindingRef,
  PublishResult,
  RegistryInput,
  RevisionRef,
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

export function createSessionOriginRegistry(input: RegistryInput) {
  const state: RegistryState = createRegistryState(input);
  return {
    registerGrant: (grant: ListingGrantRecord): void => registerGrant(state, grant),
    withdrawGrant: (grantId: string): void => withdrawGrant(state, grantId),
    commitSourceAck: (ref: SessionRef, grantId: string, ackDigest: string): void =>
      commitSourceAck(state, ref, grantId, ackDigest),
    ingestLifecycle: (binding: ProcessBindingRef, fact: LifecycleFact): CommitResult =>
      ingestLifecycle(state, binding, fact),
    ingestCapabilities: (binding: ProcessBindingRef, capabilities: CapabilitiesRecord): CommitResult =>
      ingestCapabilities(state, binding, capabilities),
    publishListing: (ref: SessionRef, grantRef: RevisionRef): PublishResult =>
      publishListing(state, ref, grantRef),
    renewFreshness: (ref: SessionRef, visibility: Visibility): PublishResult =>
      renewFreshness(state, ref, visibility),
    snapshot: (ref: SessionRef): PublishResult => snapshotSession(state, ref),
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
    emitObservation: (observation: ObservationRecord): EmitResult =>
      emitObservation(state, observation),
    restart: (): void => restartRegistry(state),
  };
}

export type SessionOriginRegistryPortV1 = ReturnType<typeof createSessionOriginRegistry>;
