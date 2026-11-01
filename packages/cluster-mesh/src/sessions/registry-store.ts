import { createHash } from 'node:crypto';
import { LISTING_DIGEST_DOMAIN, LISTING_LEASE_MS, SNAPSHOT_DIGEST_DOMAIN } from './registry-types.js';
import type {
  CapabilitiesRecord,
  CoarseProjection,
  EngineKind,
  ListingGrantRecord,
  NativeSourceRef,
  OriginSnapshot,
  ProviderClass,
  RegistryInput,
  RevisionRef,
  SessionRef,
  SessionState,
} from './registry-types.js';

export interface SessionRow {
  writerEpoch: number;
  originRevision: number;
  engineKind: EngineKind;
  providerClass: ProviderClass;
  state: SessionState;
  nativeBinding: NativeSourceRef | null;
  capabilities: CapabilitiesRecord | null;
  tombstoned: boolean;
  quarantined: boolean;
  seenFacts: Map<string, string>;
  activatedRead: boolean;
  lastFreshnessAt: number | null;
  lastFreshnessExpiry: number;
  missedEmission: boolean;
  freshnessValid: boolean;
  routeStates: Map<string, { readonly generation: number; readonly state: string }>;
  subscribers: Set<(event: { readonly kind: string }) => void>;
}

export interface RegistryState {
  readonly input: RegistryInput;
  readonly now: () => number;
  readonly sessions: Map<string, SessionRow>;
  readonly refByRow: Map<SessionRow, SessionRef>;
  readonly grants: Map<string, ListingGrantRecord>;
  readonly sourceAcks: Map<string, string>;
  readonly observations: unknown[];
  droppedObservations: number;
  unschedule: (() => void) | null;
}

export function createRegistryState(input: RegistryInput): RegistryState {
  return {
    input,
    now: input.now ?? (() => Date.now()),
    sessions: new Map(),
    refByRow: new Map(),
    grants: new Map(),
    sourceAcks: new Map(),
    observations: [],
    droppedObservations: 0,
    unschedule: null,
  };
}

export function sessionKey(ref: SessionRef): string {
  return `${ref.originInstanceId}\0${ref.sessionId}\0${ref.incarnation}`;
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

// RFC8785 (JCS) serialization for the closed registry payloads: recursively
// key-sorted objects, JSON primitive serialization, no insignificant whitespace.
export function canonicalizeJson(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalizeJson).join(',')}]`;
  switch (typeof value) {
    case 'number':
      if (!Number.isSafeInteger(value)) throw new TypeError('JCS: non-safe-integer number');
      return String(value);
    case 'boolean':
      return String(value);
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalizeJson(v)}`).join(',')}}`;
    }
    default:
      throw new TypeError('JCS: unsupported value');
  }
}

// r2 revisionRules.registry digest domains: listing hashes only the closed
// coarse payload; activated hashes the complete signed snapshot body.
export function projectionDigestOf(projection: CoarseProjection): string {
  return sha256Hex(LISTING_DIGEST_DOMAIN + canonicalizeJson(projection));
}

export function snapshotDigestOf(snapshotBody: unknown): string {
  return sha256Hex(SNAPSHOT_DIGEST_DOMAIN + canonicalizeJson(snapshotBody));
}

export function outboxRefFor(key: string, revision: number): RevisionRef {
  return {
    id: `outbox-${sha256Hex(key).slice(0, 16)}-${revision}`,
    revision,
    digest: sha256Hex(`outbox:${key}:${revision}`),
  };
}

export function grantIsCurrent(state: RegistryState, grant: ListingGrantRecord): boolean {
  if (grant.withdrawn) return false;
  const timestamp = state.now();
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) return false;
  return timestamp <= grant.expiresAt && grant.expiresAt - grant.issuedAt <= LISTING_LEASE_MS;
}

export function grantCovers(grant: ListingGrantRecord, ref: SessionRef): boolean {
  if (grant.originInstanceId !== ref.originInstanceId) return false;
  if (grant.scope.kind === 'named-sessions') return grant.scope.sessions.includes(ref.sessionId);
  return grant.futureSessionsOptIn;
}

export function currentGrantFor(state: RegistryState, ref: SessionRef): ListingGrantRecord | null {
  for (const grant of state.grants.values()) {
    if (grantCovers(grant, ref) && grantIsCurrent(state, grant)) return grant;
  }
  return null;
}

export function rowRef(state: RegistryState, row: SessionRow): SessionRef | null {
  return state.refByRow.get(row) ?? null;
}

export function buildProjection(ref: SessionRef, row: SessionRow): CoarseProjection {
  return {
    sessionRef: { ...ref },
    engineKind: row.engineKind,
    providerClass: row.providerClass,
    originRevision: row.originRevision,
    state: row.state,
  };
}

export function snapshotOf(ref: SessionRef, row: SessionRow): OriginSnapshot {
  return {
    descriptor: {
      sessionRef: { ...ref },
      engineKind: row.engineKind,
      providerClass: row.providerClass,
      writerEpoch: row.writerEpoch,
      originRevision: row.originRevision,
      state: row.state,
      nativeBinding: row.nativeBinding,
      tombstoneFloor: row.tombstoned ? row.originRevision : 0,
      denialFloors: [],
    },
    capabilities: row.capabilities,
  };
}

export function createSessionRow(): SessionRow {
  return {
    writerEpoch: 1,
    originRevision: 0,
    engineKind: 'cli',
    providerClass: 'claude',
    state: 'unknown',
    nativeBinding: null,
    capabilities: null,
    tombstoned: false,
    quarantined: false,
    seenFacts: new Map(),
    activatedRead: false,
    lastFreshnessAt: null,
    lastFreshnessExpiry: 0,
    missedEmission: false,
    freshnessValid: false,
    routeStates: new Map(),
    subscribers: new Set(),
  };
}
