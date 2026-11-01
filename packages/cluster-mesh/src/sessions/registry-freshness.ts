import { FRESHNESS_BOUND_MS, FRESHNESS_INTERVAL_MS, relayError } from './registry-types.js';
import type {
  PublishResult,
  SessionRef,
  Visibility,
} from './registry-types.js';
import {
  currentGrantFor,
  outboxRefFor,
  rowRef,
  sessionKey,
} from './registry-store.js';
import type { RegistryState } from './registry-store.js';

function defaultSchedule(callback: () => void, intervalMs: number): () => void {
  const timer = setInterval(callback, intervalMs);
  return () => clearInterval(timer);
}

export function ensureScheduler(state: RegistryState): void {
  if (state.unschedule !== null || state.sessions.size === 0) return;
  const schedule = state.input.schedule ?? defaultSchedule;
  state.unschedule = schedule(() => {
    const timestamp = state.now();
    for (const row of state.sessions.values()) {
      if (row.tombstoned || row.quarantined) continue;
      const ref = rowRef(state, row);
      if (ref === null || currentGrantFor(state, ref) === null) continue;
      if (row.lastFreshnessAt !== null && timestamp - row.lastFreshnessAt > FRESHNESS_INTERVAL_MS) {
        row.missedEmission = true;
      }
      if (row.lastFreshnessAt === null || timestamp - row.lastFreshnessAt >= FRESHNESS_INTERVAL_MS) {
        row.lastFreshnessAt = timestamp;
        row.lastFreshnessExpiry = timestamp + FRESHNESS_BOUND_MS;
        row.freshnessValid = true;
      }
    }
  }, FRESHNESS_INTERVAL_MS);
}

export function renewFreshness(state: RegistryState, ref: SessionRef, visibility: Visibility): PublishResult {
  if (ref.originInstanceId !== state.input.originInstanceId) {
    return { status: 'refused', error: relayError('relay_origin_refused') };
  }
  const key = sessionKey(ref);
  const row = state.sessions.get(key);
  if (row === undefined || row.quarantined || row.tombstoned) {
    return { status: 'refused', error: relayError('relay_origin_refused') };
  }
  const grant = currentGrantFor(state, ref);
  if (grant === null) return { status: 'refused', error: relayError('relay_grant_unavailable') };
  if (visibility === 'activated' && !row.activatedRead) {
    return { status: 'refused', error: relayError('relay_scope_refused') };
  }
  const timestamp = state.now();
  if (row.lastFreshnessAt !== null && timestamp - row.lastFreshnessAt < FRESHNESS_INTERVAL_MS) {
    return { status: 'rate-limited', nextEligibleAt: row.lastFreshnessAt + FRESHNESS_INTERVAL_MS };
  }
  row.lastFreshnessAt = timestamp;
  row.lastFreshnessExpiry = Math.min(timestamp + FRESHNESS_BOUND_MS, grant.expiresAt);
  row.freshnessValid = true;
  ensureScheduler(state);
  return {
    status: 'remote-unknown',
    sessionRef: { ...ref },
    writerEpoch: row.writerEpoch,
    originRevision: row.originRevision,
    outboxRef: outboxRefFor(key, row.originRevision),
  };
}

export function isLive(state: RegistryState, ref: SessionRef): boolean {
  const row = state.sessions.get(sessionKey(ref));
  if (row === undefined) return false;
  if (row.quarantined || row.tombstoned || row.missedEmission || !row.freshnessValid) return false;
  if (row.lastFreshnessAt === null) return false;
  const timestamp = state.now();
  if (timestamp - row.lastFreshnessAt > FRESHNESS_BOUND_MS) return false;
  if (timestamp > row.lastFreshnessExpiry) return false;
  return currentGrantFor(state, ref) !== null;
}

export function restartRegistry(state: RegistryState): void {
  for (const row of state.sessions.values()) {
    row.freshnessValid = false;
    row.lastFreshnessAt = null;
  }
}

export function signFreshness(state: RegistryState, _ref: SessionRef, _visibility: Visibility): never {
  void state;
  throw new Error(
    'SessionOriginRegistry: no enrolled origin registry key in this scope; ' +
    'signed freshness bytes stay fail-closed (source-gap DEP-AUTH-B/M0)',
  );
}
