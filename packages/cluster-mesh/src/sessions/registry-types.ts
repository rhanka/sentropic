export const FRESHNESS_INTERVAL_MS = 5000;
export const FRESHNESS_BOUND_MS = 15000;
export const FRESHNESS_GRANT_MARGIN_MS = 5000;
export const LISTING_LEASE_MS = 60_000;
export const OBSERVATION_QUEUE_CAP = 256;
export const LISTING_DIGEST_DOMAIN = 'cluster-mesh.session-listing/1/coarse-v1\0';
export const SNAPSHOT_DIGEST_DOMAIN = 'cluster-mesh.session/1/snapshot\0';

export const LISTING_STAGE_ROUTES = [
  'GET M/listing-grants/:grantId',
  'POST M/listing-grants/:grantId/acks',
  'POST M/listing',
  'POST M/freshness',
] as const;

export const FORBIDDEN_LISTING_FIELDS = [
  'cwd', 'path', 'title', 'prompt', 'cliModel', 'cliVersion',
  'agentName', 'agentRole', 'waitingInput', 'permissionDetail',
  'typedLogLocator', 'contentHash',
] as const;

export type RelayErrorCode =
  | 'relay_auth_required' | 'relay_scope_refused' | 'relay_consent_refused'
  | 'relay_lane_refused' | 'relay_loop' | 'relay_hop_limit'
  | 'relay_route_conflict' | 'relay_stale_generation' | 'relay_frame_conflict'
  | 'relay_grant_expired' | 'relay_grant_revoked' | 'relay_grant_unavailable'
  | 'relay_origin_refused' | 'relay_protocol_refused' | 'relay_oversize'
  | 'relay_version_unsupported' | 'relay_backpressure' | 'relay_unavailable'
  | 'relay_policy_unavailable';

export interface RelayError {
  readonly format: 'cluster-mesh.session-relay/1';
  readonly kind: 'error';
  readonly code: RelayErrorCode;
  readonly retryable: boolean;
}

export function relayError(code: RelayErrorCode, retryable = false): RelayError {
  return { format: 'cluster-mesh.session-relay/1', kind: 'error', code, retryable };
}

export interface SessionRef { readonly originInstanceId: string; readonly sessionId: string; readonly incarnation: string }
export type EngineKind = 'cli' | 'app-chat';
export type ProviderClass = 'claude' | 'codex' | 'agy' | 'vibe' | 'muse' | 'other-cli' | 'app-native';
export type SessionState = 'running' | 'ended' | 'unknown';
export type Visibility = 'listing' | 'activated';

export interface CoarseProjection {
  readonly sessionRef: SessionRef;
  readonly engineKind: EngineKind;
  readonly providerClass: ProviderClass;
  readonly originRevision: number;
  readonly state: SessionState;
}

export interface ProcessBindingRef { readonly id: string; readonly revision: number; readonly digest: string }
export interface RevisionRef { readonly id: string; readonly revision: number; readonly digest: string }
export interface NativeSourceRef { readonly sourceSessionId: string; readonly sourceGeneration: number; readonly streamIncarnation: string }

export type LifecycleEventKind =
  | 'admitted' | 'started' | 'waiting-input' | 'permission-pending'
  | 'capability-changed' | 'capture-enabled' | 'capture-paused' | 'capture-revoked'
  | 'route-opened' | 'route-degraded' | 'route-closed'
  | 'source-disconnected' | 'source-reconnected' | 'gap-detected'
  | 'completed' | 'stopped' | 'crashed' | 'tombstoned';

export const TERMINAL_KINDS: ReadonlySet<LifecycleEventKind> = new Set([
  'tombstoned', 'completed', 'stopped', 'crashed',
]);

export interface LifecycleFact {
  readonly kind: LifecycleEventKind;
  readonly sourceRef: NativeSourceRef;
  readonly sourceAt: number;
  readonly factRef: RevisionRef;
}

export interface CapabilitiesRecord {
  readonly sourceRef: NativeSourceRef;
  readonly hostKind?: string;
  readonly [field: string]: unknown;
}

export interface ListingGrantRecord {
  readonly grantId: string;
  readonly revision: number;
  readonly originInstanceId: string;
  readonly scope:
    | { readonly kind: 'named-sessions'; readonly sessions: readonly string[] }
    | { readonly kind: 'future-sessions'; readonly workspace: string };
  readonly fieldSet: 'coarse-v1';
  readonly purpose: 'session.list';
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly withdrawn: boolean;
  readonly futureSessionsOptIn: boolean;
}

export interface ObservationRecord {
  readonly format: 'cluster-mesh.session-observation/1';
  readonly kind: 'observation';
  readonly observationId: string;
  readonly observerRef: string;
  readonly sessionTraceId: string;
  readonly status: 'ok' | 'paused' | 'refused' | 'unknown';
  readonly code: string;
  readonly aggregatedBytes: number;
  readonly aggregatedFrames: number;
  readonly queueBytes: number;
  readonly observedAt: number;
}

export type CommitResult =
  | { readonly status: 'local-committed'; readonly sessionRef: SessionRef; readonly writerEpoch: number; readonly originRevision: number; readonly outboxRef: RevisionRef }
  | { readonly status: 'refused'; readonly error: RelayError };

export type PublishResult =
  | { readonly status: 'remote-committed'; readonly sessionRef: SessionRef; readonly writerEpoch: number; readonly originRevision: number; readonly projection: CoarseProjection; readonly projectionDigest: string; readonly sourceAckDigest: string }
  | { readonly status: 'remote-unknown'; readonly sessionRef: SessionRef; readonly writerEpoch: number; readonly originRevision: number; readonly outboxRef: RevisionRef; readonly snapshot?: OriginSnapshot }
  | { readonly status: 'rate-limited'; readonly nextEligibleAt: number }
  | { readonly status: 'refused'; readonly error: RelayError };

export interface RegistryCallOptions { readonly signal?: AbortSignal }
export interface SessionOriginIngestLifecycleParametersV1 {
  readonly processBindingRef: ProcessBindingRef;
  readonly fact: LifecycleFact;
}
export interface SessionOriginIngestCapabilitiesParametersV1 {
  readonly processBindingRef: ProcessBindingRef;
  readonly capabilities: CapabilitiesRecord;
}
export interface SessionOriginPublishListingParametersV1 {
  readonly sessionRef: SessionRef;
  readonly grantRef: RevisionRef;
}
export interface SessionOriginRenewFreshnessParametersV1 {
  readonly sessionRef: SessionRef;
  readonly visibility: Visibility;
}
export interface SessionOriginSnapshotParametersV1 { readonly sessionRef: SessionRef }

export interface OriginSnapshot {
  readonly descriptor: {
    readonly sessionRef: SessionRef;
    readonly engineKind: EngineKind;
    readonly providerClass: ProviderClass;
    readonly writerEpoch: number;
    readonly originRevision: number;
    readonly state: SessionState;
    readonly nativeBinding: NativeSourceRef | null;
    readonly tombstoneFloor: number;
    readonly denialFloors: readonly unknown[];
  };
  readonly capabilities: CapabilitiesRecord | null;
}

export type EmitResult =
  | { readonly status: 'enqueued'; readonly queued: number }
  | { readonly status: 'dropped'; readonly dropped: number };

export interface ListingRow {
  readonly visibility: Visibility;
  readonly projection: CoarseProjection;
  readonly state: SessionState;
}

export interface RegistryInput {
  readonly originInstanceId: string;
  readonly now?: () => number;
  readonly resolveSession?: (binding: ProcessBindingRef) => SessionRef | null;
  readonly schedule?: (callback: () => void, intervalMs: number) => () => void;
}
