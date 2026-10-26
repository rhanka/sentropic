// Transport to the isolated STT worker (r3 L3). The session depends on this
// interface; NodeWorkerClient runs the real worker_threads worker, tests inject
// fakes. Terminating the worker never takes the session down with it.
import type { SttTranscription } from './engine-port.js';
import type { LocalSttProfile } from './profiles.js';
import { ENGINE_VAD_ASSET, resolveModelDir, verifyModelDir } from './model-pins.js';
import { createRequire } from 'node:module';
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

export interface NodeWorkerClientOptions {
  /** Selected profile: determines the loaded model directory and pins. */
  readonly profile: LocalSttProfile;
  /** Provisioned models root containing one directory per profile (`modelDirName`). */
  readonly modelsRoot: string;
  /**
   * Engine module path injected into the worker (fake engine in tests).
   * Defaults to the owned faster-whisper adapter, whose engine bundle
   * (including the VAD asset) is then hash-verified as well.
   */
  readonly engineModule?: string;
  readonly engineOptions?: unknown;
  readonly timeoutMs?: number;
}

/** Resolve the owned adapter and its engine-bundled VAD asset. Fails closed. */
function defaultEnginePaths(): { engineModule: string; vadAssetPath: string } {
  const adapterPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'engines', 'faster-whisper.mjs');
  let engineRoot: string;
  try {
    engineRoot = path.dirname(createRequire(import.meta.url).resolve('faster-whisper-ts/package.json'));
  } catch {
    throw new Error('faster-whisper-ts is not installed: provide engineModule explicitly or install the pinned engine');
  }
  return { engineModule: adapterPath, vadAssetPath: path.join(engineRoot, ENGINE_VAD_ASSET) };
}

/**
 * Node worker_threads client for stt-worker.mjs. The model directory is resolved
 * from the selected profile and every loaded file is hash-checked before the
 * worker reports ready; any failure (pins or init) terminates the worker.
 */
export class NodeWorkerClient implements WorkerPort {
  private readonly worker: Worker;
  private readonly pending = new Map<number, { resolve: (value: SttTranscription) => void; reject: (reason: Error) => void }>();
  private nextId = 1;
  private _terminated = false;
  private _engineId: string | null = null;

  private constructor(worker: Worker) {
    this.worker = worker;
    worker.on('message', (message: { type: string; id?: number; segments?: SttTranscription['segments']; language?: string; message?: string; engineId?: string }) => {
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

  static async create(options: NodeWorkerClientOptions): Promise<NodeWorkerClient> {
    const modelDir = resolveModelDir(options.profile, options.modelsRoot);
    const engine = options.engineModule === undefined
      ? defaultEnginePaths()
      : { engineModule: options.engineModule, vadAssetPath: undefined as string | undefined };
    // Pins first: no worker exists yet, so nothing can leak on mismatch.
    await verifyModelDir(options.profile, modelDir, engine.vadAssetPath);
    const workerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'stt-worker.mjs');
    const worker = new Worker(workerPath);
    const client = new NodeWorkerClient(worker);
    try {
      await client.initHandshake({
        engineModule: engine.engineModule,
        engineOptions: options.engineOptions ?? {},
        modelPath: modelDir,
        timeoutMs: options.timeoutMs ?? 60000,
      });
    } catch (error) {
      // Init failed: terminate the worker (it may hold a loaded engine) and reject.
      client.terminate();
      throw error;
    }
    return client;
  }

  /** Engine identity reported by the worker at ready (null before ready). */
  get engineId(): string | null { return this._engineId; }

  private initHandshake(options: { engineModule: string; engineOptions: unknown; modelPath: string; timeoutMs: number }): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('worker init timed out')), options.timeoutMs);
      const onMessage = (message: { type: string; message?: string; engineId?: string }) => {
        if (message.type !== 'ready' && message.type !== 'error') return;
        clearTimeout(timer);
        this.worker.off('message', onMessage);
        if (message.type === 'ready') {
          this._engineId = message.engineId ?? null;
          resolve();
        } else {
          reject(new Error(message.message ?? 'worker init failed'));
        }
      };
      this.worker.on('message', onMessage);
      this.worker.postMessage({ type: 'init', engineModule: options.engineModule, engineOptions: options.engineOptions, modelPath: options.modelPath });
    });
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
