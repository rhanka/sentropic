// TTS registry tests (r3 L6a): config-only engine selection, capability
// differences, unpinned refusal (no invented digests), unknown-engine refusal,
// exact argv, and temp-file hygiene. No binary, no audio payload anywhere.
import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  buildEspeakArgs,
  ESPEAK_MAX_CHARS,
  ESPEAK_SHA256_PINS,
  EspeakNgEngine,
  TtsRegistry,
  TtsSynthesisError,
  TtsUnsupportedError,
  type TtsAudio,
  type TtsEnginePort,
} from '../src/node/tts-registry.js';
import { assertNoAudioPayload } from './helpers.js';

function wavBytes(): Buffer {
  return Buffer.from([82, 73, 70, 70, 36, 0, 0, 0, 87, 65, 86, 69]);
}

function fakeEngine(engineId = 'fake-stream/1', streaming = true): TtsEnginePort {
  return {
    engineId,
    capabilities: { streaming: false, fileBased: true, maxChars: 500 },
    synthesize: async (text: string) => ({ wav: wavBytes(), voice: 'fake', chars: text.length }),
    close: async () => {},
  };
}

function withRunner(runner: (argv: string[], wavPath: string) => Promise<void>): EspeakNgEngine {
  return new EspeakNgEngine('/usr/bin/espeak-ng', ['0'.repeat(64)], runner);
}

describe('tts registry', () => {
  it('should refuse synthesis while no espeak-ng digest is pinned', async () => {
    expect(ESPEAK_SHA256_PINS).toEqual([]);
    const engine = new EspeakNgEngine();
    await expect(engine.synthesize('hello')).rejects.toThrow(TtsUnsupportedError);
    await expect(engine.synthesize('hello')).rejects.toThrow(/allowlist via ESPEAK_DIGESTS/);
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

  it('should expose capability differences between engines', () => {
    const registry = new TtsRegistry({ engines: { file: fakeEngine('file/1') } });
    const engine = registry.selectTtsEngine('file');
    expect(engine.capabilities).toMatchObject({ streaming: false, fileBased: true });
    expect(engine.capabilities.maxChars).toBeGreaterThan(0);
  });

  it('should build an exact espeak-ng argv with no shell metacharacters', () => {
    expect(buildEspeakArgs('hello world', { voice: 'en', speedWpm: 175, wavPath: '/tmp/x.wav' })).toEqual([
      '-v',
      'en',
      '-s',
      '175',
      '-w',
      '/tmp/x.wav',
      'hello world',
    ]);
  });

  it('should pass text as an argv element and report voice and chars', async () => {
    let seen: string[] = [];
    const engine = withRunner(async (argv) => {
      seen = argv;
    });
    const audio: TtsAudio = await engine.synthesize('hello', { voice: 'fr', speedWpm: 200 });
    expect(seen.slice(0, 5)).toEqual(['-v', 'fr', '-s', '200', '-w']);
    expect(seen[6]).toBe('hello');
    expect(audio).toMatchObject({ voice: 'fr', chars: 5 });
    assertNoAudioPayload({ voice: audio.voice, chars: audio.chars });
  });

  it('should refuse empty text, oversize text and bad speed without spawning', async () => {
    let spawned = 0;
    const engine = withRunner(async () => {
      spawned += 1;
    });
    await expect(engine.synthesize('')).rejects.toThrow(TtsSynthesisError);
    await expect(engine.synthesize('x'.repeat(ESPEAK_MAX_CHARS + 1))).rejects.toThrow(/too long/);
    await expect(engine.synthesize('hi', { speedWpm: 10 })).rejects.toThrow(/speed out of range/);
    await expect(engine.synthesize('hi', { voice: '' })).rejects.toThrow(/empty voice/);
    expect(spawned).toBe(0);
  });

  it('should delete the temp WAV whether synthesis succeeds or fails', async () => {
    const before = new Set(readdirSync(tmpdir()).filter((name) => name.startsWith('live-stt-tts-')));
    const okEngine = withRunner(async (_argv, wavPath) => {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(wavPath, wavBytes());
    });
    await okEngine.synthesize('hello');
    const failing = withRunner(async () => {
      throw new Error('runner boom');
    });
    await expect(failing.synthesize('hello')).rejects.toThrow('runner boom');
    const after = readdirSync(tmpdir()).filter((name) => name.startsWith('live-stt-tts-'));
    expect(after.filter((name) => !before.has(name))).toEqual([]);
  });
});
