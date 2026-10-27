// Playback tests (r3 L6a): natural end, fence cancel with reap, nonzero exit,
// digest refusal, argv exactness and temp-file hygiene. The node fixture plays
// the aplay role; no speaker, no audio payload anywhere.
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AplayPlayback,
  APLAY_SHA256_PINS,
  buildAplayArgs,
  PlaybackCancelledError,
  PlaybackError,
} from '../src/node/playback.js';

const FAKE_APLAY = fileURLToPath(new URL('./fixtures/fake-aplay.mjs', import.meta.url));

function digestOf(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function withMode<T>(mode: string | undefined, run: () => Promise<T>): Promise<T> {
  const key = 'FAKE_APLAY_MODE';
  const prior = process.env[key];
  try {
    if (mode === undefined) delete process.env[key];
    else process.env[key] = mode;
    return run();
  } finally {
    if (prior === undefined) delete process.env[key];
    else process.env[key] = prior;
  }
}

function leftoverPlayFiles(): string[] {
  return readdirSync(tmpdir()).filter((name) => name.startsWith('live-stt-play-'));
}

describe('playback', () => {
  it('should build an exact aplay argv with no shell metacharacters', () => {
    expect(buildAplayArgs('/tmp/x.wav', {})).toEqual(['/tmp/x.wav']);
    expect(buildAplayArgs('/tmp/x.wav', { device: 'hw:0,0' })).toEqual(['-D', 'hw:0,0', '/tmp/x.wav']);
  });

  it('should pin the vetted alsa-utils bytes like the arecord backend', () => {
    expect(APLAY_SHA256_PINS).toEqual(['4436d05a3f9ce9d92432ea73dd5b6233f69d6243a6cfb3b6b1b8852622cb26c5']);
  });

  it('should refuse an unpinned binary with a digest mismatch before spawning', async () => {
    const playback = new AplayPlayback(FAKE_APLAY, ['f'.repeat(64)]);
    await expect(playback.play(Buffer.from([1, 2, 3]))).rejects.toThrow(PlaybackError);
    await expect(playback.play(Buffer.from([1, 2, 3]))).rejects.toThrow(/digest mismatch/);
    expect(playback.playing).toBe(false);
  });

  it('should play to natural end and clean the temp file', async () => {
    await withMode(undefined, async () => {
      const playback = new AplayPlayback(FAKE_APLAY, [digestOf(FAKE_APLAY)]);
      const before = new Set(leftoverPlayFiles());
      await playback.play(Buffer.from([82, 73, 70, 70]));
      expect(playback.playing).toBe(false);
      expect(leftoverPlayFiles().filter((name) => !before.has(name))).toEqual([]);
    });
  });

  it('should fail a nonzero backend exit without hanging', async () => {
    await withMode('fail', async () => {
      const playback = new AplayPlayback(FAKE_APLAY, [digestOf(FAKE_APLAY)]);
      await expect(playback.play(Buffer.from([82, 73, 70, 70]))).rejects.toThrow(PlaybackError);
      await expect(playback.play(Buffer.from([82, 73, 70, 70]))).rejects.toThrow(/exited 3/);
    });
  });

  it('should cancel within the fence and leave no orphan behind', async () => {
    const pidFile = join(tmpdir(), `fake-aplay-${process.pid}.pid`);
    process.env.FAKE_APLAY_PIDFILE = pidFile;
    try {
      await withMode('hang', async () => {
        const playback = new AplayPlayback(FAKE_APLAY, [digestOf(FAKE_APLAY)]);
        const pending = playback.play(Buffer.from([82, 73, 70, 70]));
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(playback.playing).toBe(true);
        playback.cancel();
        await expect(pending).rejects.toThrow(PlaybackCancelledError);
        expect(playback.playing).toBe(false);
        const pid = Number(readFileSync(pidFile, 'utf8').trim());
        expect(Number.isInteger(pid) && pid > 0).toBe(true);
        expect(() => process.kill(pid, 0)).toThrow(/ESRCH/);
      });
    } finally {
      delete process.env.FAKE_APLAY_PIDFILE;
    }
  });
});
