// Scripted fake engine for worker-protocol tests (no audio, no native code).
// options.script: array consumed per transcribe call. Each step is either:
//   { segments: [{ startSec, endSec, text, noSpeechProb? }], language? } — resolve,
//   { error: <message> } — reject,
//   { hang: true } — never settle (starvation probe).
// options.failPreload: when set, preload() rejects with that message (init probe).
export function createEngine(options = {}, modelPath = 'unknown') {
  const script = Array.isArray(options.script) ? options.script : [];
  const tag = String(modelPath).split('/').pop();
  let calls = 0;
  // Real thread-blocking: spins the worker thread (not the session event loop).
  function blockMs(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) Math.sqrt(calls + 1);
  }
  return {
    engineId: `fake-stt/1:${tag}`,
    async preload() {
      if (options.failPreload) throw new Error(options.failPreload);
    },
    async transcribe(window, { sampleRateHz } = {}) {
      calls += 1;
      const step = script[calls - 1] ?? script[script.length - 1] ?? { segments: [] };
      if (step.error) throw new Error(step.error);
      if (step.hang === true) return new Promise(() => {});
      if (typeof step.blockMs === 'number') blockMs(step.blockMs);
      if (step.delayMs) await new Promise((resolve) => setTimeout(resolve, step.delayMs));
      return {
        segments: (step.segments ?? []).map((segment) => ({
          startSec: segment.startSec ?? 0,
          endSec: segment.endSec ?? 0,
          text: segment.text ?? '',
          noSpeechProb: segment.noSpeechProb ?? 0,
        })),
        language: step.language,
      };
    },
    async close() {},
  };
}
