// Playback tests (r3 L6a): natural end over a stdin pipe, exact-bytes proof,
// fence cancel with reap, sticky pre-spawn cancel, latency bound, nonzero
// exit, digest refusal and argv exactness. The node fixture plays the aplay
// role; no speaker, no audio files, no audio payload anywhere.
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
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

async function withMode<T>(mode: string | undefined, run: () => Promise<T>): Promise<T> {
  const key = 'FAKE_APLAY_MODE';
  const prior = process.env[key];
  try {
    if (mode === undefined) delete process.env[key];
    else process.env[key] = mode;
    return await run();
  } finally {
    if (prior === undefined) delete process.env[key];
    else process.env[key] = prior;
  }
}

async function withEnv<T>(vars: Record<string, string>, run: () => Promise<T>): Promise<T> {
  const prior: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    prior[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const STUB = Buffer.from([82, 73, 70, 70, 36, 0, 0, 0, 87, 65, 86, 69]);
const STUB_HEX = STUB.toString('hex');

describe('playback', () => {
  it('should build an exact stdin aplay argv with no shell metacharacters', () => {
    expect(buildAplayArgs({})).toEqual([]);
    expect(buildAplayArgs({ device: 'hw:0,0' })).toEqual(['-D', 'hw:0,0']);
  });

  it('should pin the vetted alsa-utils bytes like the arecord backend', () => {
    expect(APLAY_SHA256_PINS).toEqual(['4436d05a3f9ce9d92432ea73dd5b6233f69d6243a6cfb3b6b1b8852622cb26c5']);
  });

  it('should refuse an unpinned binary with a digest mismatch before spawning', async () => {
    const playback = new AplayPlayback(FAKE_APLAY, ['f'.repeat(64)]);
    await expect(playback.play(STUB)).rejects.toThrow(PlaybackError);
    await expect(playback.play(STUB)).rejects.toThrow(/digest mismatch/);
    expect(playback.playing).toBe(false);
  });

  it('should pipe exact bytes to natural end with no audio files', async () => {
    await withMode(undefined, async () => {
      await withEnv({ FAKE_APLAY_EXPECT_HEX: STUB_HEX }, async () => {
        const playback = new AplayPlayback(FAKE_APLAY, [digestOf(FAKE_APLAY)]);
        await playback.play(STUB);
        expect(playback.playing).toBe(false);
      });
    });
  });

  it('should fail a byte mismatch instead of playing the wrong audio', async () => {
    await withMode(undefined, async () => {
      await withEnv({ FAKE_APLAY_EXPECT_HEX: 'deadbeef' }, async () => {
        const playback = new AplayPlayback(FAKE_APLAY, [digestOf(FAKE_APLAY)]);
        await expect(playback.play(STUB)).rejects.toThrow(PlaybackError);
        await expect(playback.play(STUB)).rejects.toThrow(/exited 4/);
      });
    });
  });

  it('should fail a nonzero backend exit without hanging', async () => {
    await withMode('fail', async () => {
      const playback = new AplayPlayback(FAKE_APLAY, [digestOf(FAKE_APLAY)]);
      await expect(playback.play(STUB)).rejects.toThrow(PlaybackError);
      await expect(playback.play(STUB)).rejects.toThrow(/exited 3/);
    });
  });

  it('should cancel within the fence and leave no orphan behind', async () => {
    const pidFile = join(tmpdir(), `fake-aplay-${process.pid}.pid`);
    rmSync(pidFile, { force: true });
    try {
      await withEnv({ FAKE_APLAY_PIDFILE: pidFile }, async () => {
        await withMode('hang', async () => {
          const playback = new AplayPlayback(FAKE_APLAY, [digestOf(FAKE_APLAY)]);
          const pending = playback.play(STUB);
          const deadline = Date.now() + 10000;
          while (!playback.playing && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          expect(playback.playing).toBe(true);
          const start = Date.now();
          playback.cancel();
          await expect(pending).rejects.toThrow(PlaybackCancelledError);
          // Bounded by the §9 150 ms stop-to-silence gate.
          expect(Date.now() - start).toBeLessThanOrEqual(150);
          expect(playback.playing).toBe(false);
          const pid = Number(readFileSync(pidFile, 'utf8').trim());
          expect(Number.isInteger(pid) && pid > 0).toBe(true);
          expect(() => process.kill(pid, 0)).toThrow(/ESRCH/);
        });
      });
    } finally {
      rmSync(pidFile, { force: true });
    }
  });

  it('should escalate to SIGKILL for a child that ignores SIGTERM', async () => {
    const pidFile = join(tmpdir(), `fake-aplay-sigkill-${process.pid}.pid`);
    rmSync(pidFile, { force: true });
    try {
      await withEnv({ FAKE_APLAY_PIDFILE: pidFile }, async () => {
        await withMode('hang-ignore-term', async () => {
          const playback = new AplayPlayback(FAKE_APLAY, [digestOf(FAKE_APLAY)]);
          const pending = playback.play(STUB);
          const deadline = Date.now() + 10000;
          while (!playback.playing && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          expect(playback.playing).toBe(true);
          const start = Date.now();
          playback.cancel();
          await expect(pending).rejects.toThrow(PlaybackCancelledError);
          // Escalation at 100 ms plus CI margin; recorded in the receipt as
          // exceeding the 150 ms gate for hung children only.
          expect(Date.now() - start).toBeLessThanOrEqual(500);
          const pid = Number(readFileSync(pidFile, 'utf8').trim());
          expect(() => process.kill(pid, 0)).toThrow(/ESRCH/);
        });
      });
    } finally {
      rmSync(pidFile, { force: true });
    }
  });

  it('should never spawn after a cancel that lands before the spawn', async () => {
    const pidFile = join(tmpdir(), `fake-aplay-prespawn-${process.pid}.pid`);
    rmSync(pidFile, { force: true });
    try {
      await withEnv({ FAKE_APLAY_PIDFILE: pidFile }, async () => {
      await withMode('hang', async () => {
        const playback = new AplayPlayback(FAKE_APLAY, [digestOf(FAKE_APLAY)]);
        const pending = playback.play(STUB);
        // Cancel synchronously: the async verification has not finished, so
        // no child can exist yet. The play must reject without ever spawning
        // — the fixture would write its pidfile if it did.
        playback.cancel();
        await expect(pending).rejects.toThrow(PlaybackCancelledError);
        expect(playback.playing).toBe(false);
        await expect(
          (async () => readFileSync(pidFile, 'utf8'))(),
        ).rejects.toThrow(/ENOENT/);
        // Positive control: the same setup without the early cancel spawns
        // and the pidfile appears, so the absence above is meaningful.
        await withEnv({ FAKE_APLAY_PIDFILE: pidFile }, async () => {
          const second = playback.play(STUB);
          const deadline = Date.now() + 10000;
          while (!playback.playing && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          expect(playback.playing).toBe(true);
          const pid = Number(readFileSync(pidFile, 'utf8').trim());
          expect(Number.isInteger(pid) && pid > 0).toBe(true);
          playback.cancel();
          await expect(second).rejects.toThrow(PlaybackCancelledError);
        });
      });
    } finally {
      rmSync(pidFile, { force: true });
    }
  });
});
