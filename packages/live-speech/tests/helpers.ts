// Deterministic PCM fixtures and a scripted in-process worker port (no microphone,
// no native code). All timing derives from sample counts; only the event order matters.
import type { SttTranscription } from '../src/node/engine-port.js';
import { SessionClosedError, type WorkerPort } from '../src/node/worker-port.js';

export const RATE = 16000;

/** Full-scale sine loud enough to open an utterance (energyThresholdDb is -45 dBFS). */
export function tone(seconds: number, freqHz = 440, amplitude = 0.3, rate = RATE): Float32Array {
  const count = Math.floor(seconds * rate);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = amplitude * Math.sin((2 * Math.PI * freqHz * i) / rate);
  return out;
}

export function silence(seconds: number, rate = RATE): Float32Array {
  return new Float32Array(Math.floor(seconds * rate));
}

/** Deterministic low-level pseudo-random signal (LCG) below the speech gate. */
export function faintNoise(seconds: number, rate = RATE, amplitude = 0.0005): Float32Array {
  const count = Math.floor(seconds * rate);
  const out = new Float32Array(count);
  let state = 0x12345678;
  for (let i = 0; i < count; i++) {
    state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
    out[i] = amplitude * (state / 0x7fffffff - 0.5) * 2;
  }
  return out;
}

export function concat(...parts: Float32Array[]): Float32Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Yield to pending promise jobs (worker replies, session handlers). */
export async function flush(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve));
}

export type ScriptStep =
  | { segments: Array<{ startSec?: number; endSec?: number; text?: string; noSpeechProb?: number }>; language?: string }
  | { error: string }
  | { hang: true };

/** Scripted in-process WorkerPort. Each transcribe call consumes the next script step. */
export class FakePort implements WorkerPort {
  calls: Array<{ window: Float32Array; sampleRateHz?: number; language?: string }> = [];
  terminated = false;
  terminateCount = 0;
  constructor(private readonly script: ScriptStep[] = [{ segments: [] }]) {}

  transcribe(window: Float32Array, options: { sampleRateHz: number; language?: string }): Promise<SttTranscription> {
    if (this.terminated) return Promise.reject(new SessionClosedError());
    const index = this.calls.length;
    this.calls.push({ window: window.slice(), sampleRateHz: options.sampleRateHz, language: options.language });
    const step = this.script[index] ?? this.script[this.script.length - 1] ?? { segments: [] };
    if ('error' in step) return Promise.reject(new Error(step.error));
    if ('hang' in step) return new Promise<SttTranscription>(() => {});
    return Promise.resolve({
      segments: (step.segments ?? []).map((segment) => ({
        startSec: segment.startSec ?? 0,
        endSec: segment.endSec ?? 0,
        text: segment.text ?? '',
        noSpeechProb: segment.noSpeechProb ?? 0,
      })),
      language: step.language,
    });
  }

  terminate(): void {
    this.terminated = true;
    this.terminateCount += 1;
  }
}

const seg = (text: string, noSpeechProb = 0) => ({ startSec: 0, endSec: 1, text, noSpeechProb });

export const SEG = seg;

/** Assert an event tree carries no audio payload (only counts, revisions and text). */
export function assertNoAudioPayload(value: unknown, path = '$'): void {
  if (value instanceof Float32Array || value instanceof Uint8Array || value instanceof ArrayBuffer) {
    throw new Error(`audio payload leaked at ${path}`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoAudioPayload(item, `${path}[${index}]`));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) assertNoAudioPayload(item, `${path}.${key}`);
  }
}
