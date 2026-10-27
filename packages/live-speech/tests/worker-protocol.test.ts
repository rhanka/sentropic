// Worker-protocol round-trip: NodeWorkerClient against the real stt-worker.mjs
// over worker_threads with the scripted fake engine (no audio, no native code).
// The model directory always comes from the selected profile, and every loaded
// file is hash-checked before ready; init failures terminate the worker.
import { describe, expect, it } from 'vitest';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { NodeWorkerClient, SessionClosedError } from '../src/node/worker-port.js';
import { FAKE_ENGINE_MODULE, FAKE_MODELS_ROOT, fakeClientOptions, fakeTinyProfile, SEG } from './helpers.js';

function liveWorkers(): number {
  return process.getActiveResourcesInfo().filter((resource) => resource === 'Worker').length;
}

async function settledWorkers(timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (liveWorkers() > 0 && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('worker protocol round-trip', () => {
  it('should load the profile-selected model and return segments plus language', async () => {
    const client = await NodeWorkerClient.create(
      fakeClientOptions([{ segments: [{ startSec: 0, endSec: 1, text: 'bonjour' }], language: 'fr' }]),
    );
    try {
      // Selection determines the load: engineId carries the profile's model dir.
      expect(client.engineId).toBe('fake-stt/1:fake-tiny');
      const result = await client.transcribe(new Float32Array(160).fill(0.1), { sampleRateHz: 16000, language: 'fr' });
      expect(result.language).toBe('fr');
      expect(result.segments).toMatchObject([{ startSec: 0, endSec: 1, text: 'bonjour', noSpeechProb: 0 }]);
    } finally {
      client.terminate();
    }
    expect(client.terminated).toBe(true);
  });

  it('should await engine preload before reporting ready', async () => {
    const options = fakeClientOptions([]);
    const failing = { ...options, engineOptions: { script: [], failPreload: 'preload boom' } };
    await expect(NodeWorkerClient.create(failing)).rejects.toThrow('preload boom');
    await settledWorkers();
    expect(liveWorkers()).toBe(0);
  });

  it('should fail closed when a pinned digest mismatches, before any load', async () => {
    const options = fakeClientOptions([]);
    const tampered = {
      ...options,
      profile: {
        ...fakeTinyProfile(),
        model: {
          ...fakeTinyProfile().model,
          files: { ...fakeTinyProfile().model.files, modelBin: `sha256:${'0'.repeat(64)}` },
        },
      },
    };
    await expect(NodeWorkerClient.create(tampered)).rejects.toThrow('model.bin');
    expect(liveWorkers()).toBe(0);
  });

  it('should terminate the worker when the engine module is missing', async () => {
    const options = { ...fakeClientOptions([]), engineModule: '/nonexistent/fake-engine.mjs' };
    await expect(NodeWorkerClient.create({ ...options, timeoutMs: 5000 })).rejects.toThrow();
    // The failed worker is reaped: no thread (and no loaded engine) survives init failure.
    await settledWorkers();
    expect(liveWorkers()).toBe(0);
  });

  it('should surface engine failures as rejections with the engine message', async () => {
    const client = await NodeWorkerClient.create(fakeClientOptions([{ error: 'fake decode boom' }]));
    try {
      await expect(client.transcribe(new Float32Array(160), { sampleRateHz: 16000 })).rejects.toThrow('fake decode boom');
    } finally {
      client.terminate();
    }
  });

  it('should fail pending and future transcriptions with SessionClosedError after terminate', async () => {
    const client = await NodeWorkerClient.create(fakeClientOptions([{ hang: true }]));
    const pending = client.transcribe(new Float32Array(160), { sampleRateHz: 16000 });
    client.terminate();
    await expect(pending).rejects.toThrow(SessionClosedError);
    await expect(client.transcribe(new Float32Array(160), { sampleRateHz: 16000 })).rejects.toThrow(SessionClosedError);
    // The hung engine never drains, so the 2 s fallback force-terminates the worker.
    await settledWorkers();
    expect(liveWorkers()).toBe(0);
  });

  it('should let an in-flight decode finish before closing the worker', async () => {
    // A close that lands while a decode is pending must drain it first: killing
    // the worker mid-native-call aborts the host process. Drive stt-worker.mjs
    // directly (the client drops late results by design) with an async decode.
    const worker = new Worker(fileURLToPath(new URL('../src/node/stt-worker.mjs', import.meta.url)));
    const seen: string[] = [];
    let resultText = '';
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('close timed out')), 10000);
        worker.on('message', (message: { type: string; segments?: Array<{ text?: string }> }) => {
          if (message.type === 'ready') {
            worker.postMessage({ type: 'transcribe', id: 1, pcm: new Float32Array(160).buffer, sampleRateHz: 16000 });
            // Land close while the decode is still pending (delayMs yields the loop).
            setTimeout(() => worker.postMessage({ type: 'close' }), 50);
          }
          if (message.type === 'result') {
            seen.push('result');
            resultText = String(message.segments?.[0]?.text ?? '');
          }
          if (message.type === 'closed') {
            seen.push('closed');
            clearTimeout(timer);
            resolve();
          }
        });
        worker.on('error', reject);
        worker.on('exit', (code) => {
          if (!seen.includes('closed')) reject(new Error(`worker exited ${code} before closed`));
        });
        worker.postMessage({
          type: 'init',
          engineModule: FAKE_ENGINE_MODULE,
          engineOptions: { script: [{ delayMs: 300, segments: [SEG('late')] }] },
          modelPath: `${FAKE_MODELS_ROOT}/fake-tiny`,
        });
      });
      // The decode completed instead of being torn down: result before closed.
      expect(seen).toEqual(['result', 'closed']);
      expect(resultText).toBe('late');
    } finally {
      await worker.terminate();
    }
    await settledWorkers();
    expect(liveWorkers()).toBe(0);
  });
});
