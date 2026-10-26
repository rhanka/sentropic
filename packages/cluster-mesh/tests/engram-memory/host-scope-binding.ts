import type {
  CanonicalMemoryStorePort, CryptoPort, ModuleStorageMemoryStoreOptionsV1, MemoryOperation,
  Result, SealedCandidateEnvelopeV1,
} from '@sentropic/engram/memory-substrate';

export interface HostInvocation {
  readonly invocationId: string;
  readonly storeId: string;
  readonly scopeRef: string;
}

export interface HostScopeOptions {
  readonly store: CanonicalMemoryStorePort;
  readonly crypto: CryptoPort;
  readonly binding: ModuleStorageMemoryStoreOptionsV1['scope_binding'];
  readonly currentInvocation: () => HostInvocation | null;
}

/** Host-only composition. Neither these dependencies nor the invocation resolver
 * may be handed to callers. Only Engram's private crypto callback issues a binding.
 * The host must restore authority separately on restart; an empty ledger refuses.
 * Keep the original store object: Engram 0.21.1 stamps its provenance by identity.
 */
export const bindHostCandidateScope = (options: HostScopeOptions): { store: CanonicalMemoryStorePort; crypto: CryptoPort } => {
  const { store, crypto, binding, currentInvocation } = options;
  const scope = { ...binding.scope };
  const storeId = binding.store_id;
  type Entry = { invocation: HostInvocation; identity: HostInvocation;
    sealed?: SealedCandidateEnvelopeV1; state: 'sealing' | 'sealed' | 'pending' | 'spent' };
  const candidates = new Map<string, Entry>();
  const denied = <T>(operation: MemoryOperation): Result<T> => ({ ok: false,
    error: { code: 'UNAUTHORIZED', operation, retryable: false, message: 'host candidate authority refused' } });
  const invocation = (): HostInvocation | null => {
    try {
      const current = currentInvocation();
      if (!current || !current.invocationId || current.storeId !== storeId) return null;
      const resolved = binding.resolveScope(current.scopeRef);
      return resolved?.tenantId === scope.tenantId && resolved.workspaceId === scope.workspaceId ? current : null;
    } catch { return null; }
  };
  const owns = (entry: Entry | undefined): entry is Entry => {
    const current = invocation();
    return !!entry && current === entry.invocation
      && current.invocationId === entry.identity.invocationId
      && current.storeId === entry.identity.storeId && current.scopeRef === entry.identity.scopeRef;
  };
  const commit = store.commitPending.bind(store);
  store.commitPending = async (input) => {
    const entry = candidates.get(input.control.candidate_id);
    if (!owns(entry) || entry.state !== 'sealed' || !entry.sealed
      || input.capture_event.candidate_id !== input.control.candidate_id
      || input.control.envelope_digest !== entry.sealed.envelope_digest
      || Object.keys(entry.sealed).some((key) => input.sealed[key as keyof SealedCandidateEnvelopeV1]
        !== entry.sealed![key as keyof SealedCandidateEnvelopeV1])) return denied('capture');
    entry.state = 'spent'; // Reserve before awaiting: no parallel or ambiguous retry.
    const result = await commit(input);
    if (result.ok) entry.state = 'pending';
    return result;
  };
  const lifecycle = store.applyLifecycle.bind(store);
  store.applyLifecycle = async (input) => {
    if ('candidate_id' in input.command) {
      const entry = candidates.get(input.command.candidate_id);
      if (!owns(entry) || entry.state !== 'pending'
        || input.event.candidate_id !== input.command.candidate_id) return denied(input.command.operation);
      entry.state = 'spent';
    }
    return lifecycle(input);
  };
  const admission = store.applyAdmission?.bind(store);
  if (admission) store.applyAdmission = async (input) => {
    const entry = candidates.get(input.candidate_id);
    const scopeRef = input.outcome === 'accept' ? input.record.scope_ref : input.scope_ref;
    if (!owns(entry) || entry.state !== 'pending' || scopeRef !== entry.identity.scopeRef
      || input.event.candidate_id !== input.candidate_id) return denied('request_admission');
    entry.state = 'spent';
    return admission(input);
  };
  const read = store.readPending?.bind(store);
  if (read) store.readPending = async (input) => {
    const entry = candidates.get(input.candidate_id);
    return owns(entry) && entry.state === 'pending' ? read(input) : denied('request_admission');
  };
  const complete = store.recordCaptureIdempotency?.bind(store);
  if (complete) store.recordCaptureIdempotency = async (input) => {
    const entry = candidates.get(input.candidate_id);
    return owns(entry) && entry.state === 'pending' ? complete(input) : denied('capture');
  };
  return { store, crypto: {
    ...crypto,
    version: crypto.version,
    // Preserve class-backed host crypto ports as well as plain fixture objects.
    open: crypto.open?.bind(crypto), destroy: crypto.destroy?.bind(crypto), rotate: crypto.rotate?.bind(crypto),
    seal: async (input: Parameters<CryptoPort['seal']>[0]): ReturnType<CryptoPort['seal']> => {
      const current = invocation();
      if (!current || !input.candidate_id || candidates.has(input.candidate_id)) return denied('capture');
      const entry: Entry = { invocation: current, identity: { ...current }, state: 'sealing' };
      candidates.set(input.candidate_id, entry);
      const result = await crypto.seal(input);
      if (!result.ok) return result;
      if (!owns(entry) || result.value.candidate_id !== input.candidate_id) return denied('capture');
      entry.sealed = Object.freeze({ ...result.value });
      entry.state = 'sealed';
      return result;
    },
  } };
};
