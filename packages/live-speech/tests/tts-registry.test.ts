// TTS registry tests (r3 L6a): config-only engine selection, capability
// differences, stdin/stdout argv (text never in argv), stdout buffering,
// abort killing the child, unpinned refusal, unknown-engine refusal. No
// binary, no audio files, no audio payload anywhere.
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

/** Pids the fixture logged at spawn time, one per line. Throws ENOENT when nothing spawned. */
function readSpawnLog(path: string): number[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map(Number);
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

  it('should expose the unpinned engine id', () => {
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

  it('should abort a real synthesis child on barge and reap it', async () => {
    const pidFile = join(tmpdir(), `fake-espeak-abort-${process.pid}.pid`);
    rmSync(pidFile, { force: true });
    const priorMode = process.env.FAKE_APLAY_MODE;
    const priorPid = process.env.FAKE_APLAY_PIDFILE;
    try {
      process.env.FAKE_APLAY_MODE = 'hang';
      process.env.FAKE_APLAY_PIDFILE = pidFile;
      const engine = new EspeakNgEngine(FAKE_BIN, [digestOf(FAKE_BIN)]);
      const controller = new AbortController();
      const pending = engine.synthesize('a narration that is still synthesizing', {
        signal: controller.signal,
      });
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        try {
          readFileSync(pidFile, 'utf8');
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
      controller.abort();
      await expect(pending).rejects.toThrow(/aborted by barge-in/);
      const pid = Number(readFileSync(pidFile, 'utf8').trim());
      expect(Number.isInteger(pid) && pid > 0).toBe(true);
      expect(() => process.kill(pid, 0)).toThrow(/ESRCH/);
    } finally {
      if (priorMode === undefined) delete process.env.FAKE_APLAY_MODE;
      else process.env.FAKE_APLAY_MODE = priorMode;
      if (priorPid === undefined) delete process.env.FAKE_APLAY_PIDFILE;
      else process.env.FAKE_APLAY_PIDFILE = priorPid;
      rmSync(pidFile, { force: true });
    }
  });

  it('should not spawn when the barge lands during binary verification', async () => {
    const pidFile = join(tmpdir(), `fake-espeak-prespawn-${process.pid}.pid`);
    const spawnLog = join(tmpdir(), `fake-espeak-prespawn-${process.pid}.log`);
    rmSync(pidFile, { force: true });
    rmSync(spawnLog, { force: true });
    const priorMode = process.env.FAKE_APLAY_MODE;
    const priorPid = process.env.FAKE_APLAY_PIDFILE;
    const priorLog = process.env.FAKE_APLAY_SPAWNLOG;
    try {
      process.env.FAKE_APLAY_MODE = 'hang';
      process.env.FAKE_APLAY_PIDFILE = pidFile;
      process.env.FAKE_APLAY_SPAWNLOG = spawnLog;
      const engine = new EspeakNgEngine(FAKE_BIN, [digestOf(FAKE_BIN)]);
      const controller = new AbortController();
      // Abort synchronously: synthesize() is parked in verifiedBinary()'s
      // async digest I/O, so the barge lands before any spawn.
      const pending = engine.synthesize('a narration barged during verification', {
        signal: controller.signal,
      });
      controller.abort();
      await expect(pending).rejects.toThrow(/aborted/);
      // No child was ever spawned: the fixture logs every spawn before
      // reading stdin, so a stdin-held orphan would still show up here.
      expect(() => readFileSync(pidFile, 'utf8')).toThrow(/ENOENT/);
      expect(() => readSpawnLog(spawnLog)).toThrow(/ENOENT/);
      // Positive control: the same setup without an early barge does spawn.
      // The control child boots after any orphan would have, and it logs at
      // spawn time while the pidfile needs stdin EOF: once the pidfile is
      // present, every earlier spawn is already in the log. Exactly one
      // line — the control pid — proves the barged attempt spawned nothing.
      const secondController = new AbortController();
      const second = engine.synthesize('a narration that does spawn', {
        signal: secondController.signal,
      });
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        try {
          readFileSync(pidFile, 'utf8');
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
      secondController.abort();
      await expect(second).rejects.toThrow(/aborted by barge-in/);
      const pid = Number(readFileSync(pidFile, 'utf8').trim());
      expect(Number.isInteger(pid) && pid > 0).toBe(true);
      expect(readSpawnLog(spawnLog)).toEqual([pid]);
      expect(() => process.kill(pid, 0)).toThrow(/ESRCH/);
    } finally {
      if (priorMode === undefined) delete process.env.FAKE_APLAY_MODE;
      else process.env.FAKE_APLAY_MODE = priorMode;
      if (priorPid === undefined) delete process.env.FAKE_APLAY_PIDFILE;
      else process.env.FAKE_APLAY_PIDFILE = priorPid;
      if (priorLog === undefined) delete process.env.FAKE_APLAY_SPAWNLOG;
      else process.env.FAKE_APLAY_SPAWNLOG = priorLog;
      rmSync(pidFile, { force: true });
      rmSync(spawnLog, { force: true });
    }
  });
});
