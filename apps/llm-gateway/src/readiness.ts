/**
 * Host readiness (spec D3): `/readyz` is 200 only when every injected dependency
 * probe succeeds. Probes are bounded (2 s), results cached (5 s), and a shutdown
 * latch forces not-ready immediately. Responses stay coarse; the probe name and
 * failure kind go to the injected telemetry callback only.
 */

export const PROBE_TIMEOUT_MS = 2_000;
export const READINESS_CACHE_MS = 5_000;

export interface DependencyProbe {
  readonly name: string;
  check(signal: AbortSignal): Promise<boolean>;
}

export type ProbeFailure = 'not-ready' | 'timeout' | 'error';

export interface HostReadiness {
  isReady(): Promise<boolean>;
  /** Irreversible for this process: SIGTERM marks the host not-ready at once. */
  markNotReady(): void;
  readonly latched: boolean;
}

export interface HostReadinessOptions {
  readonly probes: readonly DependencyProbe[];
  readonly timeoutMs?: number;
  readonly cacheMs?: number;
  readonly now?: () => number;
  readonly onProbeFailure?: (name: string, failure: ProbeFailure) => void;
}

const runProbe = async (
  probe: DependencyProbe,
  timeoutMs: number,
  report: (failure: ProbeFailure) => void,
): Promise<boolean> => {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  try {
    const outcome = await Promise.race([probe.check(controller.signal), timeout]);
    if (outcome === 'timeout') {
      controller.abort();
      report('timeout');
      return false;
    }
    if (outcome !== true) report('not-ready');
    return outcome === true;
  } catch {
    report('error');
    return false;
  } finally {
    clearTimeout(timer);
  }
};

export const createHostReadiness = (options: HostReadinessOptions): HostReadiness => {
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  const cacheMs = options.cacheMs ?? READINESS_CACHE_MS;
  const now = options.now ?? Date.now;
  let latched = false;
  let cached: { readonly at: number; readonly ready: boolean } | undefined;
  let inflight: Promise<boolean> | undefined;

  const evaluate = async (): Promise<boolean> => {
    const results = await Promise.all(options.probes.map((probe) =>
      runProbe(probe, timeoutMs, (failure) => options.onProbeFailure?.(probe.name, failure))));
    return options.probes.length > 0 && results.every(Boolean);
  };

  return {
    get latched() { return latched; },
    markNotReady() {
      latched = true;
      cached = undefined;
    },
    async isReady() {
      if (latched) return false;
      if (cached && now() - cached.at < cacheMs) return cached.ready;
      inflight ??= evaluate().then((ready) => {
        cached = { at: now(), ready };
        return ready;
      }).finally(() => { inflight = undefined; });
      const ready = await inflight;
      return ready && !latched;
    },
  };
};
