/**
 * Listener and shutdown lifecycle (spec D3). On stop: mark not-ready, close
 * admission, keep serving probes and 503s while active requests and SSE streams
 * drain (bounded), cancel what remains, then close the HTTP server.
 */
import type { Server } from 'node:http';
import { serve } from '@hono/node-server';

import type { HostApp } from './app';
import type { HostConfig } from './config';

export interface StopReport {
  /** True when every active request/stream finished inside the drain bound. */
  readonly drained: boolean;
  /** Streams cancelled at the drain bound (provider work aborted through the gateway). */
  readonly cancelled: number;
}

export interface RunningHost {
  readonly port: number;
  /** Idempotent: every call returns the same stop outcome. */
  stop(): Promise<StopReport>;
}

const isEventStream = (response: Response): boolean =>
  (response.headers.get('content-type') ?? '').toLowerCase().startsWith('text/event-stream');

export const startHost = async (host: HostApp, config: HostConfig): Promise<RunningHost> => {
  // Drain accounting is at the HTTP layer: a response counts until its socket write
  // completes (`close`), so the listener never closes under unflushed SSE bytes.
  let inflight = 0;
  const idleWaiters = new Set<() => void>();
  const streams = new Set<(reason: unknown) => void>();

  // SSE bodies stay cancellable from here, which aborts the gateway request signal.
  const track = (response: Response): Response => {
    const reader = response.body!.getReader();
    const cancel = (reason: unknown): void => {
      streams.delete(cancel);
      void reader.cancel(reason).catch(() => undefined);
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
    const response = await host.app.fetch(request);
    return response.body && isEventStream(response) ? track(response) : response;
  };

  let server!: Server;
  const port = await new Promise<number>((resolve, reject) => {
    server = serve({ fetch, port: config.port, hostname: config.host }, (info) => resolve(info.port)) as Server;
    server.once('error', reject);
    server.on('request', (_request, response) => {
      inflight += 1;
      response.once('close', () => {
        inflight -= 1;
        if (inflight === 0) for (const wake of idleWaiters) wake();
      });
    });
  });

  const waitForIdle = (timeoutMs: number): Promise<boolean> => new Promise((resolve) => {
    if (inflight === 0) return resolve(true);
    const wake = (): void => { clearTimeout(timer); idleWaiters.delete(wake); resolve(true); };
    const timer = setTimeout(() => { idleWaiters.delete(wake); resolve(false); }, timeoutMs);
    idleWaiters.add(wake);
  });

  let stopping: Promise<StopReport> | undefined;
  const stop = async (): Promise<StopReport> => {
    host.readiness.markNotReady();
    host.closeAdmission();
    const drained = await waitForIdle(config.drainTimeoutMs);
    const remaining = [...streams];
    // Cancelling aborts provider work and settles the request as cancelled; it is not
    // awaited, so a provider ignoring the abort cannot extend the drain bound.
    for (const cancel of remaining) cancel(new Error('llm gateway host shutdown'));
    await new Promise<void>((resolve) => {
      const force = setTimeout(() => server.closeAllConnections(), drained ? 1_000 : 0);
      server.close(() => { clearTimeout(force); resolve(); });
      server.closeIdleConnections();
    });
    return { drained, cancelled: remaining.length };
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
  once(signal: 'SIGTERM' | 'SIGINT', listener: () => void): unknown;
}

/** First SIGTERM/SIGINT stops the host once, then exits (0 after a completed stop). */
export const handleShutdownSignals = (
  target: SignalTarget,
  running: RunningHost,
  exit: (code: number) => void,
): void => {
  const onSignal = (): void => {
    running.stop().then(() => exit(0), () => exit(1));
  };
  target.once('SIGTERM', onSignal);
  target.once('SIGINT', onSignal);
};
