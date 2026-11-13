import { CustodyRevoked, type CustodyIssuer, type CustodyLease, type CustodySubject } from './data-plane';
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
      let timer: ReturnType<typeof setTimeout> | undefined;
      const fail = () => {
        if (!stopped) { watch.revoked = true; stop(); revoke(); }
      };
      const stop = () => {
        stopped = true; clearTimeout(timer); controller.abort();
        const set = watches.get(subject); set?.delete(watch); if (!set?.size) watches.delete(subject);
      };
      const check = async () => {
        const current = versionOf(await rpc('watch', subject, controller.signal));
        if (stopped || (version !== undefined && current !== version)) throw new CustodyRevoked();
        version = current; return current;
      };
      // Defer network work until the watch is registered, including synchronous transport failures.
      const ready = Promise.resolve().then(check);
      const watch: Watch = { ready, check, stop, revoked: false };
      const set = watches.get(subject) ?? new Set<Watch>(); set.add(watch); watches.set(subject, set);
      const schedule = () => {
        if (!stopped) { timer = setTimeout(() => { void check().then(schedule, fail); }, 250); timer.unref(); }
      };
      void ready.then(schedule, fail);
      return stop;
    },
    async issue(subject, signal) {
      const active = [...(watches.get(subject) ?? [])];
      if (!active.length || signal.aborted) throw new CustodyRevoked();
      try {
        await Promise.all(active.map(watch => watch.ready));
        if (signal.aborted || active.some(watch => watch.revoked)) throw new CustodyRevoked();
        const lease = await rpc('issue', subject, signal) as CustodyLease;
        await Promise.all(active.map(watch => watch.check()));
        if (signal.aborted || active.some(watch => watch.revoked) || !lease || typeof lease !== 'object') throw new CustodyRevoked();
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
