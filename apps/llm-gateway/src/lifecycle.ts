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
  let inflight = 0;
  const idleWaiters = new Set<() => void>();
  const streams = new Set<(reason: unknown) => Promise<void>>();
  const release = (): void => {
    inflight -= 1;
    if (inflight === 0) for (const wake of idleWaiters) wake();
  };

  const track = (response: Response): Response => {
    const reader = response.body!.getReader();
    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      streams.delete(cancel);
      release();
    };
    const cancel = async (reason: unknown): Promise<void> => {
      finish();
      await reader.cancel(reason).catch(() => undefined);
    };
    streams.add(cancel);
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await reader.read();
          if (next.done) { finish(); controller.close(); } else controller.enqueue(next.value);
        } catch (error) {
          finish();
          controller.error(error);
        }
      },
      cancel,
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  };

  const fetch = async (request: Request): Promise<Response> => {
    inflight += 1;
    let response: Response;
    try {
      response = await host.app.fetch(request);
    } catch (error) {
      release();
      throw error;
    }
    if (response.body && isEventStream(response)) return track(response);
    release();
    return response;
  };

  let server!: Server;
  const port = await new Promise<number>((resolve, reject) => {
    server = serve({ fetch, port: config.port, hostname: config.host }, (info) => resolve(info.port)) as Server;
    server.once('error', reject);
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
    await Promise.all(remaining.map((cancel) => cancel(new Error('llm gateway host shutdown'))));
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
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
