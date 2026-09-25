/**
 * Listener and shutdown lifecycle (spec D3). On stop: mark not-ready, close
 * admission, keep serving probes and 503s while active requests and SSE streams
 * drain (bounded), cancel what remains, await its settlement (bounded), then
 * close the HTTP server.
 */
import type { Server } from 'node:http';
import { serve } from '@hono/node-server';

import type { HostApp } from './app';
import type { HostConfig } from './config';

/** Bound on awaiting settlement of cancelled work; drain 25 s + 5 s + 1 s close stays inside the 40 s pod grace. */
export const SETTLE_TIMEOUT_MS = 5_000;

export interface StopReport {
  /** True when every active request/stream finished inside the drain bound. */
  readonly drained: boolean;
  /** Streams cancelled at the drain bound (provider work aborted through the gateway). */
  readonly cancelled: number;
  /** Requests aborted at the drain bound before producing a response (JSON, or SSE before its first frame). */
  readonly aborted: number;
  /** True when every cancelled stream and aborted request settled inside the settlement bound. */
  readonly settled: boolean;
}

export interface RunningHost {
  readonly port: number;
  /** Idempotent: every call returns the same stop outcome. */
  stop(): Promise<StopReport>;
}

export interface StartHostOptions {
  readonly log?: (line: string) => void;
  readonly settleTimeoutMs?: number;
  /** Test seam: observes the listening server (post-listen error handling). */
  readonly onListening?: (server: Server) => void;
}

const SHUTDOWN = 'llm gateway host shutdown';

const isEventStream = (response: Response): boolean =>
  (response.headers.get('content-type') ?? '').toLowerCase().startsWith('text/event-stream');

const errorCode = (error: unknown): string =>
  error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unknown';

/** Cancellable unit of in-flight work: `abort` starts cancellation, the promise resolves once it settled. */
type Cancel = (reason: unknown) => Promise<void>;

export const startHost = async (
  host: HostApp, config: HostConfig, options: StartHostOptions = {},
): Promise<RunningHost> => {
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const settleTimeoutMs = options.settleTimeoutMs ?? SETTLE_TIMEOUT_MS;
  // Drain accounting is at the HTTP layer: a response counts until its socket write
  // completes (`close`), so the listener never closes under unflushed SSE bytes.
  let inflight = 0;
  const idleWaiters = new Set<() => void>();
  // Requests still computing their response: JSON calls and SSE before the first frame.
  const requests = new Set<Cancel>();
  const streams = new Set<Cancel>();

  // SSE bodies stay cancellable from here; the gateway cancel resolves after settlement.
  const track = (response: Response): Response => {
    const reader = response.body!.getReader();
    const cancel: Cancel = (reason) => {
      streams.delete(cancel);
      return reader.cancel(reason).catch(() => undefined);
    };
    streams.add(cancel);
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await reader.read();
          if (next.done) { streams.delete(cancel); controller.close(); } else controller.enqueue(next.value);
        } catch (error) {
          streams.delete(cancel);
          controller.error(error);
        }
      },
      cancel,
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  };

  const fetch = async (request: Request): Promise<Response> => {
    // Per-request abort: the gateway reads `request.signal` and settles the request as cancelled.
    // A client disconnect (the listener's own signal) still aborts through the same controller.
    const controller = new AbortController();
    const forward = (): void => controller.abort(request.signal.reason);
    if (request.signal.aborted) forward();
    else request.signal.addEventListener('abort', forward, { once: true });
    const scoped = new Request(request, { signal: controller.signal });
    const responding = host.app.fetch(scoped) as Promise<Response>;
    const cancel: Cancel = (reason) => {
      controller.abort(reason);
      return responding.then(
        async (response) => { if (isEventStream(response)) await response.body?.cancel(reason).catch(() => undefined); },
        () => undefined,
      );
    };
    requests.add(cancel);
    try {
      const response = await responding;
      if (controller.signal.aborted) return response;
      return response.body && isEventStream(response) ? track(response) : response;
    } finally {
      requests.delete(cancel);
    }
  };

  let server!: Server;
  const port = await new Promise<number>((resolve, reject) => {
    server = serve({ fetch, port: config.port, hostname: config.host }, (info) => {
      // Startup failures reject; once listening, errors are logged (code only) and never reject.
      server.off('error', reject);
      server.on('error', (error) => log(`llm-gateway-host server error code=${errorCode(error)}`));
      resolve(info.port);
    }) as Server;
    server.once('error', reject);
    server.on('request', (_request, response) => {
      inflight += 1;
      response.once('close', () => {
        inflight -= 1;
        if (inflight === 0) for (const wake of idleWaiters) wake();
      });
    });
  });
  options.onListening?.(server);

  const waitForIdle = (timeoutMs: number): Promise<boolean> => new Promise((resolve) => {
    if (inflight === 0) return resolve(true);
    const wake = (): void => { clearTimeout(timer); idleWaiters.delete(wake); resolve(true); };
    const timer = setTimeout(() => { idleWaiters.delete(wake); resolve(false); }, timeoutMs);
    idleWaiters.add(wake);
  });

  const within = (work: Promise<unknown>, timeoutMs: number): Promise<boolean> => new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    void work.then(() => { clearTimeout(timer); resolve(true); });
  });

  let stopping: Promise<StopReport> | undefined;
  const stop = async (): Promise<StopReport> => {
    host.readiness.markNotReady();
    host.closeAdmission();
    const drained = await waitForIdle(config.drainTimeoutMs);
    const pendingRequests = [...requests];
    const openStreams = [...streams];
    // Cancelling aborts provider work; the gateway then records the cancelled settlement.
    // Settlement is awaited, bounded, so a provider ignoring the abort cannot hold the pod.
    const reason = new Error(SHUTDOWN);
    const settling = Promise.all([...pendingRequests, ...openStreams].map((cancel) => cancel(reason)));
    const settled = await within(settling, settleTimeoutMs);
    if (!settled) log(`llm-gateway-host shutdown settlement bound reached pending=${pendingRequests.length + openStreams.length}`);
    await new Promise<void>((resolve) => {
      const force = setTimeout(() => server.closeAllConnections(), drained ? 1_000 : 0);
      server.close(() => { clearTimeout(force); resolve(); });
      server.closeIdleConnections();
    });
    return { drained, cancelled: openStreams.length, aborted: pendingRequests.length, settled };
  };

  return {
    port,
    stop() {
      stopping ??= stop();
      return stopping;
    },
  };
};

export interface SignalTarget {
  on(signal: 'SIGTERM' | 'SIGINT', listener: () => void): unknown;
}

/**
 * SIGTERM/SIGINT stop the host once, then exit (0 after a completed stop). Listeners
 * stay attached, so a repeated signal during the drain is absorbed instead of
 * falling back to the default kill.
 */
export const handleShutdownSignals = (
  target: SignalTarget,
  running: RunningHost,
  exit: (code: number) => void,
): void => {
  let signalled = false;
  const onSignal = (): void => {
    if (signalled) return;
    signalled = true;
    running.stop().then(() => exit(0), () => exit(1));
  };
  target.on('SIGTERM', onSignal);
  target.on('SIGINT', onSignal);
};
