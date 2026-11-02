import { relayError } from './registry-types.js';
import type {
  ListingGrantRecord,
  ListingRow,
  PublishResult,
  RevisionRef,
  SessionRef,
} from './registry-types.js';
import {
  buildProjection,
  currentGrantFor,
  grantCovers,
  grantIsCurrent,
  outboxRefFor,
  projectionDigestOf,
  rowRef,
  sessionKey,
  snapshotOf,
} from './registry-store.js';
import type { RegistryState } from './registry-store.js';

function parseSessionRef(state: RegistryState, ref: SessionRef): SessionRef | null {
  if (
    typeof ref.originInstanceId !== 'string' || ref.originInstanceId.length === 0 ||
    typeof ref.sessionId !== 'string' || ref.sessionId.length === 0 ||
    typeof ref.incarnation !== 'string' || ref.incarnation.length === 0 ||
    ref.originInstanceId !== state.input.originInstanceId
  ) {
    return null;
  }
  return { ...ref };
}
export function publishListing(state: RegistryState, ref: SessionRef, grantRef: RevisionRef): PublishResult {
  const parsed = parseSessionRef(state, ref);
  if (parsed === null) return { status: 'refused', error: relayError('relay_origin_refused') };
  const grant = state.grants.get(grantRef.id);
  if (grant === undefined) return { status: 'refused', error: relayError('relay_grant_unavailable') };
  if (grant.withdrawn) return { status: 'refused', error: relayError('relay_grant_revoked') };
  if (!grantIsCurrent(state, grant) || grant.revision !== grantRef.revision) {
    return { status: 'refused', error: relayError('relay_grant_expired') };
  }
  if (!grantCovers(grant, parsed)) return { status: 'refused', error: relayError('relay_scope_refused') };
  const key = sessionKey(parsed);
  const row = state.sessions.get(key);
  if (row === undefined || row.quarantined) {
    return { status: 'refused', error: relayError('relay_origin_refused') };
  }
  const ackDigest = state.sourceAcks.get(`${key}|${grant.grantId}`);
  if (ackDigest === undefined) {
    return {
      status: 'remote-unknown',
      sessionRef: parsed,
      writerEpoch: row.writerEpoch,
      originRevision: row.originRevision,
      outboxRef: outboxRefFor(key, row.originRevision),
    };
  }
  const projection = buildProjection(parsed, row);
  return {
    status: 'remote-committed',
    sessionRef: parsed,
    writerEpoch: row.writerEpoch,
    originRevision: row.originRevision,
    projection,
    projectionDigest: projectionDigestOf(projection),
    sourceAckDigest: ackDigest,
  };
}

export function snapshotSession(state: RegistryState, ref: SessionRef): PublishResult {
  const parsed = parseSessionRef(state, ref);
  if (parsed === null) return { status: 'refused', error: relayError('relay_origin_refused') };
  const key = sessionKey(parsed);
  const row = state.sessions.get(key);
  if (row === undefined) return { status: 'refused', error: relayError('relay_origin_refused') };
  return {
    status: 'remote-unknown',
    sessionRef: parsed,
    writerEpoch: row.writerEpoch,
    originRevision: row.originRevision,
    outboxRef: outboxRefFor(key, row.originRevision),
    snapshot: snapshotOf(parsed, row),
  };
}

export function getListingRow(state: RegistryState, ref: SessionRef): ListingRow | null {
  const parsed = parseSessionRef(state, ref);
  if (parsed === null) return null;
  const row = state.sessions.get(sessionKey(parsed));
  if (row === undefined || currentGrantFor(state, parsed) === null) return null;
  return {
    visibility: row.activatedRead ? 'activated' : 'listing',
    projection: buildProjection(parsed, row),
    state: row.state,
  };
}

export function setActivatedRead(state: RegistryState, ref: SessionRef, enabled: boolean): boolean {
  const parsed = parseSessionRef(state, ref);
  if (parsed === null) return false;
  const row = state.sessions.get(sessionKey(parsed));
  if (row === undefined || currentGrantFor(state, parsed) === null) return false;
  row.activatedRead = enabled;
  return enabled;
}

export function subscribeListing(
  state: RegistryState,
  ref: SessionRef,
  callback: (event: { readonly kind: string }) => void,
): () => void {
  const parsed = parseSessionRef(state, ref);
  if (parsed === null) return () => {};
  const row = state.sessions.get(sessionKey(parsed));
  if (row === undefined) return () => {};
  row.subscribers.add(callback);
  return () => { row.subscribers.delete(callback); };
}

export function recordRouteState(
  state: RegistryState,
  ref: SessionRef,
  route: { readonly routeId: string; readonly generation: number; readonly state: string },
): boolean {
  const parsed = parseSessionRef(state, ref);
  if (parsed === null) return false;
  const row = state.sessions.get(sessionKey(parsed));
  if (row === undefined) return false;
  row.routeStates.set(route.routeId, { generation: route.generation, state: route.state });
  return true;
}

export function registerGrant(state: RegistryState, grant: ListingGrantRecord): void {
  state.grants.set(grant.grantId, { ...grant });
}

export function withdrawGrant(state: RegistryState, grantId: string): void {
  const grant = state.grants.get(grantId);
  if (grant === undefined) return;
  state.grants.set(grantId, { ...grant, withdrawn: true });
  for (const row of state.sessions.values()) {
    const ref = rowRef(state, row);
    if (ref === null) continue;
    if (currentGrantFor(state, ref) !== null) continue;
    for (const subscriber of row.subscribers) subscriber({ kind: 'listing-withdrawn' });
    row.subscribers.clear();
  }
}

export function commitSourceAck(state: RegistryState, ref: SessionRef, grantId: string, ackDigest: string): void {
  state.sourceAcks.set(`${sessionKey(ref)}|${grantId}`, ackDigest);
}
