import { Worker } from 'node:worker_threads';
import { getAsset, isSea } from 'node:sea';
import { ExecutionNodeError, EXECUTION_NODE_HTTP_STATUS } from './errors.js';
import type { ExecutionNodeDevScope } from './contract.js';
import type { RuntimeAdapter, RunSandboxOptions } from './runtime-adapter.js';

/** Host commands/mounts run off the event loop that owns revocable TLS streams. */
export class ThreadRuntimeAdapter implements RuntimeAdapter {
  readonly kind = 'runsc-systrap';
  private readonly worker: Worker;
  private next = 0;
  private readonly pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
  private readonly exits = new Map<string, (code: number | null) => void>();
  healthy = true;
  constructor(binary: string, production = false) {
    this.worker = isSea()
      ? new Worker(getAsset('runtime-worker', 'utf8'), { eval: true, workerData: { binary, production } })
      : new Worker(new URL('../dist/runtime-worker.js', import.meta.url), { workerData: { binary, production } });
    this.worker.on('message', message => {
      if (message.event === 'exit') { this.exits.get(message.uid)?.(message.code); return; }
      const call = this.pending.get(message.id); if (!call) return;
      this.pending.delete(message.id);
      if (message.error) {
        const data = message.error;
        const error = Object.hasOwn(EXECUTION_NODE_HTTP_STATUS, data.code)
          ? new ExecutionNodeError(data.code, data.message, data.retryAfterMs) : new Error(data.message);
        call.reject(Object.assign(error, data));
      } else call.resolve(message.result);
    });
    const failed = () => {
      this.healthy = false;
      for (const call of this.pending.values()) call.reject(new Error('runtime worker unavailable'));
      this.pending.clear();
    };
    this.worker.on('error', failed); this.worker.on('exit', failed);
    this.worker.unref();
  }
  hasRunsc() { return this.healthy; }
  private call<T>(method: string, args: unknown[], runtimeId?: string): Promise<T> {
    if (!this.healthy || this.pending.size >= 8) return Promise.reject(Object.assign(new Error('runtime worker unavailable or busy'), { runtimeId }));
    return new Promise<T>((resolve, reject) => {
      const id = ++this.next;
      const timer = setTimeout(() => {
        this.healthy = false; this.pending.delete(id);
        reject(Object.assign(new Error('runtime worker deadline exceeded'), { runtimeId }));
      }, 30_000);
      this.pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(Object.assign(error, { runtimeId: (error as any).runtimeId ?? runtimeId })); } });
      try { this.worker.postMessage({ id, method, args }); }
      catch (error) { this.pending.get(id)!.reject(error as Error); this.pending.delete(id); }
    });
  }
  async runSandbox(options: RunSandboxOptions) {
    const { onExit, ...serializable } = options;
    if (onExit) this.exits.set(options.sandboxUid, onExit);
    return this.call<{ runtimeId: string }>('runSandbox', [serializable], `runsc-${options.tenantId}-${options.sandboxUid}`);
  }
  assertRunning(id: string) { return this.call<void>('assertRunning', [id], id); }
  portTarget(id: string, port: number) { return this.call<{ socketPath: string }>('portTarget', [id, port], id); }
  writeFile(id: string, path: string, bytes: Buffer, scope: ExecutionNodeDevScope) {
    return this.call<void>('writeFile', [id, path, bytes, scope], id);
  }
  stopSandbox(id: string) { return this.call<boolean>('stopSandbox', [id], id); }
  async exportOutput(id: string, path: string, max?: number) {
    return Buffer.from(await this.call<Uint8Array>('exportOutput', [id, path, max], id));
  }
  async destroySandbox(id: string) { await this.call<void>('destroySandbox', [id], id); this.exits.delete(id.split('-').slice(2).join('-')); }
  forwardUsage() { return this.call<{ limit: number; inUse: number }>('forwardUsage', []); }
  async close() { await this.worker.terminate(); }
}
