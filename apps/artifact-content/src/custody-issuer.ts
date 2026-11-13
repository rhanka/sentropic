import { CustodyRevoked, isCustodyLease, type CustodyIssuer, type CustodySubject } from './data-plane';
import { custodyRpcFromEnv, type CustodyRpc } from './custody-rpc';

type Watch = { ready: Promise<string>; check(): Promise<string>; stop(): void; revoked: boolean };
const versionOf = (value: unknown) => {
  const version = (value as { version?: unknown } | null)?.version;
  if (typeof version !== 'string' || !/^[a-f0-9]{64}$/.test(version)) throw new CustodyRevoked();
  return version;
};

/** Each replica watches its own attached subjects; no single-replica push subscription can lose a revocation. */
export function createRpcCustodyIssuer(rpc: CustodyRpc): CustodyIssuer {
  const watches = new Map<CustodySubject, Set<Watch>>();
  return {
    watch(subject, revoke) {
      const controller = new AbortController(); let stopped = false; let version: string | undefined;
      let freshness: ReturnType<typeof setTimeout>;
      let lastVerifiedSent = performance.now();
      const fail = () => {
        if (!stopped) { watch.revoked = true; stop(); revoke(); }
      };
      const stop = () => {
        stopped = true; clearInterval(poll); clearTimeout(freshness); controller.abort();
        const set = watches.get(subject); set?.delete(watch); if (!set?.size) watches.delete(subject);
      };
      const check = async () => {
        const sent = performance.now();
        const current = versionOf(await rpc('watch', subject, controller.signal));
        if (stopped || performance.now() - sent >= 900
          || (version !== undefined && current !== version)) throw new CustodyRevoked();
        // An old response can never move the authoritative freshness window forward.
        lastVerifiedSent = Math.max(lastVerifiedSent, sent);
        clearTimeout(freshness);
        freshness = setTimeout(fail, Math.max(0, lastVerifiedSent + 900 - performance.now())); freshness.unref();
        version = current; return current;
      };
      // Defer network work until the watch is registered, including synchronous transport failures.
      const ready = Promise.resolve().then(check);
      const watch: Watch = { ready, check, stop, revoked: false };
      const set = watches.get(subject) ?? new Set<Watch>(); set.add(watch); watches.set(subject, set);
      // Fixed cadence overlaps bounded RPCs; the independent watchdog includes response latency.
      const poll = setInterval(() => { void check().catch(fail); }, 250); poll.unref();
      freshness = setTimeout(fail, 900); freshness.unref();
      void ready.catch(fail);
      return stop;
    },
    async issue(subject, signal) {
      const active = [...(watches.get(subject) ?? [])];
      if (!active.length || signal.aborted) throw new CustodyRevoked();
      try {
        await Promise.all(active.map(watch => watch.ready));
        if (signal.aborted || active.some(watch => watch.revoked)) throw new CustodyRevoked();
        const lease = await rpc('issue', subject, signal);
        await Promise.all(active.map(watch => watch.check()));
        if (signal.aborted || active.some(watch => watch.revoked) || !isCustodyLease(lease)) throw new CustodyRevoked();
        // The data-plane transport validates every lease field and the TTL before opening a node connection.
        return lease;
      } catch { throw new CustodyRevoked(); }
    },
  };
}

export function custodyIssuerFromEnv(env: NodeJS.ProcessEnv) {
  if ((env.APP_ARTIFACT_SANDBOX_BACKEND ?? 'k8s') !== 'execution-node') return undefined;
  return createRpcCustodyIssuer(custodyRpcFromEnv(env));
}
