// Isolated local-STT worker entry (r3 L3, plain JS: worker_threads cannot load TS).
// Protocol over parentPort:
//   { type: 'init', engineModule: <absolute path>, engineOptions: {...}, modelPath: <string> }
//     -> { type: 'ready', engineId }
//   { type: 'transcribe', id, pcm: ArrayBuffer (transferred), sampleRateHz, language? }
//     -> { type: 'result', id, segments, language } | { type: 'error', id, message }
//   { type: 'close' } -> { type: 'closed' } then exit(0).
// The engine module must export a `createEngine(options, modelPath)` factory returning
// `{ engineId, transcribe(Float32Array, {sampleRateHz, language?}), close(), preload?() }`.
// When `preload` exists, init awaits it before reporting ready, so ready means loaded.
// Audio buffers are consumed, never retained; logs carry byte counts only, never payload.
import { parentPort } from 'node:worker_threads';

if (!parentPort) throw new Error('stt-worker must run inside a worker thread');

let engine = null;

const fail = (id, message) => {
  parentPort.postMessage({ type: 'error', id, message: String(message).slice(0, 500) });
};

parentPort.on('message', async (message) => {
  try {
    if (message.type === 'init') {
      const module = await import(message.engineModule);
      if (typeof module.createEngine !== 'function') {
        fail(message.id ?? 'init', 'engine module has no createEngine factory');
        return;
      }
      engine = await module.createEngine(message.engineOptions ?? {}, message.modelPath);
      if (engine && typeof engine.preload === 'function') await engine.preload();
      parentPort.postMessage({ type: 'ready', id: message.id ?? 'init', engineId: engine.engineId });
      return;
    }
    if (message.type === 'transcribe') {
      if (!engine) {
        fail(message.id, 'transcribe before init');
        return;
      }
      const pcm = new Float32Array(message.pcm);
      const result = await engine.transcribe(pcm, {
        sampleRateHz: message.sampleRateHz,
        language: message.language,
      });
      parentPort.postMessage({
        type: 'result',
        id: message.id,
        segments: (result.segments ?? []).map((segment) => ({
          startSec: segment.startSec,
          endSec: segment.endSec,
          text: String(segment.text ?? ''),
          noSpeechProb: segment.noSpeechProb ?? 0,
        })),
        language: result.language,
      });
      return;
    }
    if (message.type === 'close') {
      try {
        await engine?.close();
      } finally {
        engine = null;
        parentPort.postMessage({ type: 'closed' });
        process.exit(0);
      }
    }
    fail(message.id, `unknown message type: ${message.type}`);
  } catch (error) {
    fail(message.id, error?.message ?? error);
  }
});
