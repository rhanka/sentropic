/**
 * Graceful exit on SIGTERM / SIGINT.
 *
 * Node as PID 1 of a container ignores SIGTERM unless the process installs a handler: Kubernetes
 * then waits the whole termination grace period before SIGKILL. The legacy API and IdP pods stayed
 * Terminating for about 31 s after the T3 fence (rehearsal r9), still able to write meanwhile.
 *
 * The handler stops accepting connections, lets in-flight requests finish for a bounded drain,
 * closes what is left (long-lived streams never end on their own) and exits. Before a server is
 * attached (boot, migrations) it exits at once.
 */
export interface ClosableServer {
  close(callback?: (error?: Error) => void): unknown;
  closeIdleConnections?: () => void;
  closeAllConnections?: () => void;
}

export interface ShutdownProcess {
  on(signal: NodeJS.Signals, listener: () => void): unknown;
  exit(code?: number): unknown;
}

export interface GracefulShutdownOptions {
  log: { info(message: string): void };
  /** Longest wait for in-flight requests before the remaining connections are closed. */
  drainMs?: number;
  proc?: ShutdownProcess;
}

export const SHUTDOWN_DRAIN_MS = 5_000;
const SIGNALS: readonly NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];

export function installGracefulShutdown(options: GracefulShutdownOptions) {
  const proc: ShutdownProcess = options.proc ?? process;
  const drainMs = options.drainMs ?? SHUTDOWN_DRAIN_MS;
  let server: ClosableServer | null = null;
  let stopping = false;

  const stop = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    options.log.info(`${signal} received, shutting down`);
    const current = server;
    if (!current) {
      proc.exit(0);
      return;
    }
    let exited = false;
    const exit = () => {
      if (exited) return;
      exited = true;
      proc.exit(0);
    };
    const timer = setTimeout(() => {
      current.closeAllConnections?.();
      exit();
    }, drainMs);
    current.close(() => {
      clearTimeout(timer);
      exit();
    });
    current.closeIdleConnections?.();
  };

  for (const signal of SIGNALS) proc.on(signal, () => stop(signal));
  return {
    attach(next: ClosableServer) {
      server = next;
    },
  };
}
