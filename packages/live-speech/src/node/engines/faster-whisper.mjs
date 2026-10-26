// Real faster-whisper-ts engine behind the isolated worker protocol (r3 L3).
// createEngine(options, modelPath) mirrors the worker's expected factory shape:
// `{ engineId, transcribe(Float32Array, { sampleRateHz, language? }), close() }`.
// Loaded only inside stt-worker.mjs; never imported by the session, the bench
// driver (it goes through the worker) or unit tests (they use the fake).
//
// The engine consumes 16 kHz mono PCM; anything else is rejected — resampling
// happens once at the capture edge per the selected profile, never here.
//
// The engine module is loaded lazily so validation and segment mapping stay
// unit-testable with an injected loader; production passes no loader.
const ENGINE_ID = 'faster-whisper-ts/1.2.1';
const EXPECTED_RATE_HZ = 16000;

/** Map one native segment onto the worker protocol shape (seconds, 0..1 speech score). */
function toSegment(segment) {
  return {
    startSec: Number(segment.start ?? 0),
    endSec: Number(segment.end ?? 0),
    text: String(segment.text ?? ''),
    noSpeechProb: Number(segment.no_speech_prob ?? 0),
  };
}

export function createEngine(options = {}, modelPath, loader = null) {
  if (typeof modelPath !== 'string' || modelPath.length === 0) {
    throw new Error('faster-whisper engine requires a model directory path');
  }
  const load = loader ?? (() => import('faster-whisper-ts'));
  let modelPromise = null;
  let closed = false;

  const getModel = () => {
    if (!modelPromise) {
      modelPromise = Promise.resolve()
        .then(load)
        .then((engineModule) => {
          if (!engineModule || typeof engineModule.WhisperModel !== 'function') {
            throw new Error('engine module has no WhisperModel export');
          }
          return new engineModule.WhisperModel(
            modelPath,
            options.device ?? 'cpu',
            options.deviceIndex ?? 0,
            options.computeType ?? 'default',
          );
        });
    }
    return modelPromise;
  };

  return {
    engineId: ENGINE_ID,
    async transcribe(window, { sampleRateHz, language } = {}) {
      if (closed) throw new Error('engine is closed');
      if (!(window instanceof Float32Array)) throw new Error('engine requires Float32Array PCM');
      if (sampleRateHz !== EXPECTED_RATE_HZ) {
        throw new Error(`engine requires ${EXPECTED_RATE_HZ} Hz PCM, got ${String(sampleRateHz)}`);
      }
      const model = await getModel();
      // The native call returns a [segments, info] tuple, not an object.
      const [segments] = await model.transcribe(window, { language: language ?? 'en' }, language ?? 'en');
      return { segments: (segments ?? []).map(toSegment), language: language ?? 'en' };
    },
    async close() {
      if (closed) return;
      closed = true;
      const model = await modelPromise;
      if (model && typeof model.free === 'function') model.free();
    },
  };
}
