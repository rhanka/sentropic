// Transport to the isolated STT worker (r3 L3). The session depends on this
// interface; NodeWorkerClient runs the real worker_threads worker, tests inject
// fakes. Terminating the worker never takes the session down with it.
import type { SttTranscription } from './engine-port.js';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

export interface WorkerPort {
  transcribe(window: Float32Array, options: { sampleRateHz: number; language?: string }): Promise<SttTranscription>;
  terminate(): void;
  readonly terminated: boolean;
}

export class SessionClosedError extends Error {
  readonly code = 'stt_session_closed';
  constructor() { super('Local STT session is closed'); this.name = 'SessionClosedError'; }
}

/**
 * Node worker_threads client for stt-worker.mjs. The engine module path is injected
 * (real engine in production/bench, fake engine in worker-protocol tests).
 */
export class NodeWorkerClient implements WorkerPort {
  private readonly worker: Worker;
  private readonly pending = new Map<number, { resolve: (value: SttTranscription) => void; reject: (reason: Error) => void }>();
  private nextId = 1;
  private _terminated = false;

  private constructor(worker: Worker) {
    this.worker = worker;
    worker.on('message', (message: { type: string; id?: number; segments?: SttTranscription['segments']; language?: string; message?: string }) => {
      if (message.type !== 'result' && message.type !== 'error') return;
      const slot = message.id === undefined ? undefined : this.pending.get(message.id);
      if (!slot) return;
      this.pending.delete(message.id as number);
      if (message.type === 'result') {
        slot.resolve({ segments: message.segments ?? [], language: message.language });
      } else {
        slot.reject(new Error(message.message ?? 'worker error'));
      }
    });
    worker.on('error', (error: Error) => this.failAll(error));
    worker.on('exit', () => this.failAll(new SessionClosedError()));
  }

  static async create(options: { engineModule: string; engineOptions?: unknown; modelPath: string; timeoutMs?: number }): Promise<NodeWorkerClient> {
    const workerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'stt-worker.mjs');
    const worker = new Worker(workerPath);
    const client = new NodeWorkerClient(worker);
    const timeoutMs = options.timeoutMs ?? 60000;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('worker init timed out')), timeoutMs);
      const onMessage = (message: { type: string; message?: string }) => {
        if (message.type !== 'ready' && message.type !== 'error') return;
        clearTimeout(timer);
        worker.off('message', onMessage);
        if (message.type === 'ready') resolve();
        else reject(new Error(message.message ?? 'worker init failed'));
      };
      worker.on('message', onMessage);
      worker.postMessage({ type: 'init', engineModule: options.engineModule, engineOptions: options.engineOptions ?? {}, modelPath: options.modelPath });
    });
    return client;
  }

  private failAll(error: Error): void {
    for (const slot of this.pending.values()) slot.reject(error);
    this.pending.clear();
  }

  get terminated(): boolean { return this._terminated; }

  transcribe(window: Float32Array, options: { sampleRateHz: number; language?: string }): Promise<SttTranscription> {
    if (this._terminated) return Promise.reject(new SessionClosedError());
    const id = this.nextId++;
    const copy = window.slice();
    return new Promise<SttTranscription>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage(
        { type: 'transcribe', id, pcm: copy.buffer, sampleRateHz: options.sampleRateHz, language: options.language },
        [copy.buffer],
      );
    });
  }

  terminate(): void {
    if (this._terminated) return;
    this._terminated = true;
    this.failAll(new SessionClosedError());
    void this.worker.terminate();
  }
}
