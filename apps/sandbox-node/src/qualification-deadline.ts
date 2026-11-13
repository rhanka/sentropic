/** All waits share cancellation; timers and process listeners belong to one run. */
export function qualificationDeadline(value = process.env.QUALIFICATION_TIMEOUT_MS): number {
  const timeout = value === undefined ? 120_000 : Number(value);
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 300_000) {
    throw new Error('QUALIFICATION_TIMEOUT_MS must be an integer from 1 to 300000');
  }
  return timeout;
}

export class QualificationDeadline {
  private readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  private readonly timer: ReturnType<typeof setTimeout>;
  private watch?: ReturnType<typeof setInterval>;
  private readonly interrupt = () => this.abort(new Error('qualification interrupted'));

  constructor(timeoutMs = qualificationDeadline()) {
    this.timer = setTimeout(() => this.abort(new Error('qualification global deadline exceeded')), timeoutMs);
    process.once('SIGINT', this.interrupt); process.once('SIGTERM', this.interrupt);
  }
  abort(reason: unknown): void { this.controller.abort(reason); }
  monitor(check: () => void): void {
    check();
    this.watch = setInterval(() => { try { check(); } catch (error) { this.abort(error); } }, 100);
  }
  stopMonitoring(): void { clearInterval(this.watch); }
  async wait<T>(operation: Promise<T>): Promise<T> {
    void operation.catch(() => {});
    this.signal.throwIfAborted();
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(this.signal.reason);
      this.signal.addEventListener('abort', abort, { once: true });
      operation.then(resolve, reject).finally(() => this.signal.removeEventListener('abort', abort));
    });
  }
  close(): void {
    clearTimeout(this.timer); this.stopMonitoring();
    process.removeListener('SIGINT', this.interrupt); process.removeListener('SIGTERM', this.interrupt);
  }
}
