// Scripted fake engine for worker-protocol tests (no audio, no native code).
// options.script: array consumed per transcribe call. Each step is either:
//   { segments: [{ startSec, endSec, text, noSpeechProb? }], language? } — resolve,
//   { error: <message> } — reject,
//   { hang: true } — never settle (starvation probe).
export function createEngine(options = {}, modelPath = 'unknown') {
  const script = Array.isArray(options.script) ? options.script : [];
  const tag = String(modelPath).split('/').pop();
  let calls = 0;
  return {
    engineId: `fake-stt/1:${tag}`,
    async transcribe(window, { sampleRateHz } = {}) {
      calls += 1;
      const step = script[calls - 1] ?? script[script.length - 1] ?? { segments: [] };
      if (step.error) throw new Error(step.error);
      if (step.hang === true) return new Promise(() => {});
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
