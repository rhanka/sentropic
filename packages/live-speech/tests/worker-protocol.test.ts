// Worker-protocol round-trip: NodeWorkerClient against the real stt-worker.mjs
// over worker_threads with the scripted fake engine (no audio, no native code).
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { NodeWorkerClient, SessionClosedError } from '../src/node/worker-port.js';

const engineModule = fileURLToPath(new URL('./fixtures/fake-engine.mjs', import.meta.url));

describe('worker protocol round-trip', () => {
  it('should return segments and language through a real worker thread', async () => {
    const client = await NodeWorkerClient.create({
      engineModule,
      engineOptions: { script: [{ segments: [{ startSec: 0, endSec: 1, text: 'bonjour' }], language: 'fr' }] },
      modelPath: 'fake-model',
    });
    try {
      const result = await client.transcribe(new Float32Array(160).fill(0.1), { sampleRateHz: 16000, language: 'fr' });
      expect(result.language).toBe('fr');
      expect(result.segments).toMatchObject([{ startSec: 0, endSec: 1, text: 'bonjour', noSpeechProb: 0 }]);
    } finally {
      client.terminate();
    }
    expect(client.terminated).toBe(true);
  });

  it('should surface engine failures as rejections with the engine message', async () => {
    const client = await NodeWorkerClient.create({
      engineModule,
      engineOptions: { script: [{ error: 'fake decode boom' }] },
      modelPath: 'fake-model',
    });
    try {
      await expect(client.transcribe(new Float32Array(160), { sampleRateHz: 16000 })).rejects.toThrow('fake decode boom');
    } finally {
      client.terminate();
    }
  });

  it('should fail pending and future transcriptions with SessionClosedError after terminate', async () => {
    const client = await NodeWorkerClient.create({
      engineModule,
      engineOptions: { script: [{ hang: true }] },
      modelPath: 'fake-model',
    });
    const pending = client.transcribe(new Float32Array(160), { sampleRateHz: 16000 });
    client.terminate();
    await expect(pending).rejects.toThrow(SessionClosedError);
    await expect(client.transcribe(new Float32Array(160), { sampleRateHz: 16000 })).rejects.toThrow(SessionClosedError);
  });
});
