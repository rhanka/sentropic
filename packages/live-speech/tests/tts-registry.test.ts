// TTS registry tests (r3 L6a): config-only engine selection, capability
// differences, stdin/stdout argv (text never in argv), stdout buffering,
// abort killing the child, unpinned refusal, unknown-engine refusal. No
// binary, no audio files, no audio payload anywhere.
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildEspeakArgs,
  ESPEAK_MAX_CHARS,
  ESPEAK_SHA256_PINS,
  EspeakNgEngine,
  TtsRegistry,
  TtsSynthesisError,
  TtsUnsupportedError,
  type EspeakRunner,
  type TtsAudio,
  type TtsEnginePort,
} from '../src/node/tts-registry.js';
import { assertNoAudioPayload } from './helpers.js';

function wavBytes(): Buffer {
  return Buffer.from([82, 73, 70, 70, 36, 0, 0, 0, 87, 65, 86, 69]);
}

function fakeEngine(engineId = 'fake-tts/1'): TtsEnginePort {
  return {
    engineId,
    capabilities: { streaming: false, fileBased: false, pipedStdin: true, maxChars: 500 },
    synthesize: async (text: string) => ({ wav: wavBytes(), voice: 'fake', chars: text.length }),
    close: async () => {},
  };
}

const FAKE_BIN = fileURLToPath(new URL('./fixtures/fake-aplay.mjs', import.meta.url));

function digestOf(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function withRunner(runner: EspeakRunner): EspeakNgEngine {
  return new EspeakNgEngine('/nonexistent-espeak', [], runner);
}

describe('tts registry', () => {
  it('should carry no pinned digest until a qualified binary is measured', () => {
    expect(ESPEAK_SHA256_PINS).toEqual([]);
  });

  it('should refuse synthesis while no espeak-ng digest is pinned', async () => {
    const engine = new EspeakNgEngine(FAKE_BIN, []);
    await expect(engine.synthesize('hello')).rejects.toThrow(TtsUnsupportedError);
    await expect(engine.synthesize('hello')).rejects.toThrow(/allowlist via ESPEAK_DIGESTS/);
  });

  it('should refuse a missing helper binary explicitly', async () => {
    const engine = new EspeakNgEngine('/nonexistent-espeak', []);
    await expect(engine.synthesize('hello')).rejects.toThrow(TtsUnsupportedError);
    await expect(engine.synthesize('hello')).rejects.toThrow(/not installed or not executable/);
  });

  it('should switch engines by configuration name only', () => {
    const registry = new TtsRegistry({ engines: { a: fakeEngine('a/1'), b: fakeEngine('b/2') } });
    expect(registry.availableEngines().sort()).toEqual(['a', 'b']);
    expect(registry.selectTtsEngine('a').engineId).toBe('a/1');
    expect(registry.selectTtsEngine('b').engineId).toBe('b/2');
  });

  it('should fail closed on unknown engines with the Lp1 pointer', () => {
    const registry = new TtsRegistry({ engines: {} });
    expect(() => registry.selectTtsEngine('cloud-fable')).toThrow(TtsUnsupportedError);
    expect(() => registry.selectTtsEngine('cloud-fable')).toThrow(/Lp1/);
  });

  it('should expose piped capability differences between engines', () => {
    const registry = new TtsRegistry({ engines: { file: fakeEngine('file/1') } });
    const engine = registry.selectTtsEngine('file');
    expect(engine.capabilities).toMatchObject({ streaming: false, fileBased: false, pipedStdin: true });
    expect(engine.capabilities.maxChars).toBeGreaterThan(0);
  });

  it('should identify the unpinned engine honestly', () => {
    expect(new EspeakNgEngine().engineId).toBe('espeak-ng/unpinned');
  });

  it('should build an exact piped argv with no text element', () => {
    const argv = buildEspeakArgs({ voice: 'fr', speedWpm: 200 });
    expect(argv).toEqual(['--stdin', '-v', 'fr', '-s', '200', '--stdout']);
    expect(argv.join(' ')).not.toMatch(/hello/);
  });

  it('should pass text on stdin and report voice and chars', async () => {
    let seenArgv: string[] = [];
    let seenText = '';
    const engine = withRunner(async (argv, stdinText) => {
      seenArgv = argv;
      seenText = stdinText;
      return wavBytes();
    });
    const audio: TtsAudio = await engine.synthesize('hello world', { voice: 'fr', speedWpm: 200 });
    expect(seenArgv).toEqual(['--stdin', '-v', 'fr', '-s', '200', '--stdout']);
    expect(seenText).toBe('hello world');
    expect(audio).toMatchObject({ voice: 'fr', chars: 11 });
    assertNoAudioPayload({ voice: audio.voice, chars: audio.chars });
  });

  it('should propagate the abort signal to the runner', async () => {
    let seenSignal: AbortSignal | undefined;
    const engine = withRunner(async (_argv, _text, signal) => {
      seenSignal = signal;
      return wavBytes();
    });
    const controller = new AbortController();
    await engine.synthesize('hello', { signal: controller.signal });
    expect(seenSignal).toBe(controller.signal);
  });

  it('should refuse empty text, oversize text and bad speed without running', async () => {
    let spawned = 0;
    const engine = withRunner(async () => {
      spawned += 1;
      return wavBytes();
    });
    await expect(engine.synthesize('')).rejects.toThrow(TtsSynthesisError);
    await expect(engine.synthesize('x'.repeat(ESPEAK_MAX_CHARS + 1))).rejects.toThrow(/too long/);
    await expect(engine.synthesize('hi', { speedWpm: 10 })).rejects.toThrow(/speed out of range/);
    await expect(engine.synthesize('hi', { voice: '' })).rejects.toThrow(/empty voice/);
    expect(spawned).toBe(0);
  });

  it('should reject an empty runner buffer without audio', async () => {
    const engine = withRunner(async () => Buffer.alloc(0));
    await expect(engine.synthesize('hello')).rejects.toThrow(/empty WAV/);
  });

  it('should verify the digest before running the real path', async () => {
    const engine = new EspeakNgEngine(FAKE_BIN, ['0'.repeat(64)]);
    await expect(engine.synthesize('hello')).rejects.toThrow(/digest mismatch/);
    const pinned = new EspeakNgEngine(FAKE_BIN, [digestOf(FAKE_BIN)]);
    await expect(pinned.synthesize('hello')).rejects.toThrow(TtsSynthesisError);
  });
});
