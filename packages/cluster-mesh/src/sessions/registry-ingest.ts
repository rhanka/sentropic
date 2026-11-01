import { TERMINAL_KINDS, relayError } from './registry-types.js';
import type {
  CapabilitiesRecord,
  CommitResult,
  LifecycleFact,
  ProcessBindingRef,
  ProviderClass,
} from './registry-types.js';
import {
  createSessionRow,
  outboxRefFor,
  sessionKey,
} from './registry-store.js';
import type { RegistryState } from './registry-store.js';
import { ensureScheduler } from './registry-freshness.js';

function validBinding(binding: ProcessBindingRef): boolean {
  return (
    typeof binding.id === 'string' && binding.id.length > 0 &&
    typeof binding.digest === 'string' && binding.digest.length > 0
  );
}

function validFact(fact: LifecycleFact): boolean {
  const source = fact.sourceRef;
  return (
    typeof source.sourceSessionId === 'string' && source.sourceSessionId.length > 0 &&
    typeof source.sourceGeneration === 'number' && Number.isSafeInteger(source.sourceGeneration) &&
    typeof source.streamIncarnation === 'string' && source.streamIncarnation.length > 0 &&
    typeof fact.sourceAt === 'number' && Number.isFinite(fact.sourceAt) && fact.sourceAt >= 0
  );
}

export function ingestLifecycle(
  state: RegistryState,
  binding: ProcessBindingRef,
  fact: LifecycleFact,
): CommitResult {
  const resolveSession = state.input.resolveSession;
  if (resolveSession === undefined) {
    return { status: 'refused', error: relayError('relay_grant_unavailable') };
  }
  if (!validBinding(binding)) {
    return { status: 'refused', error: relayError('relay_auth_required') };
  }
  const ref = resolveSession(binding);
  if (ref === null || ref.originInstanceId !== state.input.originInstanceId) {
    return { status: 'refused', error: relayError('relay_origin_refused') };
  }
  if (!validFact(fact)) {
    return { status: 'refused', error: relayError('relay_protocol_refused') };
  }
  const key = sessionKey(ref);
  let row = state.sessions.get(key);
  if (row === undefined) {
    row = createSessionRow();
    state.sessions.set(key, row);
    state.refByRow.set(row, { ...ref });
  }
  if (row.quarantined || row.tombstoned) {
    return { status: 'refused', error: relayError('relay_origin_refused') };
  }
  const factKey = `${String(fact.factRef.id)}:${String(fact.factRef.revision)}`;
  const factDigest = String(fact.factRef.digest);
  const seen = row.seenFacts.get(factKey);
  if (seen !== undefined) {
    if (seen !== factDigest) {
      row.quarantined = true;
      return { status: 'refused', error: relayError('relay_origin_refused') };
    }
    return {
      status: 'local-committed',
      sessionRef: { ...ref },
      writerEpoch: row.writerEpoch,
      originRevision: row.originRevision,
      outboxRef: outboxRefFor(key, row.originRevision),
    };
  }
  if (!Number.isSafeInteger(row.originRevision) || row.originRevision >= Number.MAX_SAFE_INTEGER) {
    return { status: 'refused', error: relayError('relay_protocol_refused') };
  }
  row.seenFacts.set(factKey, factDigest);
  row.originRevision += 1;
  row.nativeBinding = { ...fact.sourceRef };
  row.state = TERMINAL_KINDS.has(fact.kind) ? 'ended' : 'running';
  if (fact.kind === 'tombstoned') row.tombstoned = true;
  ensureScheduler(state);
  return {
    status: 'local-committed',
    sessionRef: { ...ref },
    writerEpoch: row.writerEpoch,
    originRevision: row.originRevision,
    outboxRef: outboxRefFor(key, row.originRevision),
  };
}

export function ingestCapabilities(
  state: RegistryState,
  binding: ProcessBindingRef,
  capabilities: CapabilitiesRecord,
): CommitResult {
  const resolveSession = state.input.resolveSession;
  if (resolveSession === undefined) {
    return { status: 'refused', error: relayError('relay_grant_unavailable') };
  }
  const ref = resolveSession(binding);
  if (ref === null || ref.originInstanceId !== state.input.originInstanceId) {
    return { status: 'refused', error: relayError('relay_origin_refused') };
  }
  const source = capabilities.sourceRef;
  if (
    source === undefined ||
    typeof source.sourceSessionId !== 'string' || source.sourceSessionId.length === 0
  ) {
    return { status: 'refused', error: relayError('relay_protocol_refused') };
  }
  const key = sessionKey(ref);
  const row = state.sessions.get(key);
  if (row === undefined || row.quarantined || row.tombstoned) {
    return { status: 'refused', error: relayError('relay_origin_refused') };
  }
  if (!Number.isSafeInteger(row.originRevision) || row.originRevision >= Number.MAX_SAFE_INTEGER) {
    return { status: 'refused', error: relayError('relay_protocol_refused') };
  }
  const hostKind = typeof capabilities.hostKind === 'string' ? capabilities.hostKind : 'claude';
  const known: ProviderClass[] = ['claude', 'codex', 'agy', 'vibe', 'muse', 'app-native'];
  row.providerClass = (known as string[]).includes(hostKind) ? (hostKind as ProviderClass) : 'other-cli';
  row.capabilities = { ...capabilities };
  row.originRevision += 1;
  return {
    status: 'local-committed',
    sessionRef: { ...ref },
    writerEpoch: row.writerEpoch,
    originRevision: row.originRevision,
    outboxRef: outboxRefFor(key, row.originRevision),
  };
}
