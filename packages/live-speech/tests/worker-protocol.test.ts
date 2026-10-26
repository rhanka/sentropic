// Worker-protocol round-trip: NodeWorkerClient against the real stt-worker.mjs
// over worker_threads with the scripted fake engine (no audio, no native code).
// The model directory always comes from the selected profile, and every loaded
// file is hash-checked before ready; init failures terminate the worker.
import { describe, expect, it } from 'vitest';
import { NodeWorkerClient, SessionClosedError } from '../src/node/worker-port.js';
import { fakeClientOptions, fakeTinyProfile } from './helpers.js';

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
  });
});
