// Device-port tests, part 1 (r3 L4): pure argv/list parsers, the fail-closed
// backend path, and the scripted fake device. Streaming (open/frames/loss)
// lands with the frame pump.
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ArecordDevice,
  ARECORD_SHA256_PINS,
  buildArecordArgs,
  DeviceLostError,
  DeviceOpenError,
  DeviceUnavailableError,
  parseArecordList,
} from '../src/node/device.js';
import { FakeDevice } from './fixtures/fake-device.js';
import { silence, tone } from './helpers.js';

const FAKE_ARECORD = fileURLToPath(new URL('./fixtures/fake-arecord.mjs', import.meta.url));
const OPEN_OPTS = { sampleRateHz: 16000, channels: 1 as const, frameMs: 20 };

function digestOf(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

async function withMode<T>(mode: string, run: () => Promise<T>): Promise<T> {
  const prior = process.env.FAKE_ARECORD_MODE;
  process.env.FAKE_ARECORD_MODE = mode;
  try {
    return await run();
  } finally {
    if (prior === undefined) delete process.env.FAKE_ARECORD_MODE;
    else process.env.FAKE_ARECORD_MODE = prior;
  }
}

describe('fake device', () => {
  it('should list the scripted input devices', async () => {
    const device = new FakeDevice();
    await expect(device.listDevices()).resolves.toEqual([
      { id: 'fake-default', name: 'Fake microphone', backend: 'fake' },
    ]);
  });

  it('should yield scripted frames in order, one script per open', async () => {
    const device = new FakeDevice([[tone(0.1)], [silence(0.1)]]);
    const first = await device.open('fake-default');
    const frames: Float32Array[] = [];
    for await (const frame of first.frames()) frames.push(frame);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toHaveLength(Math.floor(0.1 * 16000));
    expect(first.closed).toBe(true);
    const second = await device.open('fake-default');
    const more: Float32Array[] = [];
    for await (const frame of second.frames()) more.push(frame);
    expect(more).toHaveLength(1);
    expect(device.opened).toEqual(['fake-default', 'fake-default']);
  });

  it('should fail open with DeviceOpenError and never yield', async () => {
    const device = new FakeDevice([], { failOpen: 'no such device' });
    await expect(device.open('missing')).rejects.toThrow(DeviceOpenError);
  });

  it('should surface a mid-stream loss as DeviceLostError and close the stream', async () => {
    const device = new FakeDevice([[tone(0.05), { lost: 'device unplugged' }]]);
    const stream = await device.open('fake-default');
    const frames: Float32Array[] = [];
    await expect(
      (async () => {
        for await (const frame of stream.frames()) frames.push(frame);
      })(),
    ).rejects.toThrow(DeviceLostError);
    expect(frames).toHaveLength(1);
    expect(stream.closed).toBe(true);
  });

  it('should fail listing with DeviceUnavailableError when the backend is down', async () => {
    const device = new FakeDevice([], { failList: 'backend gone' });
    await expect(device.listDevices()).rejects.toThrow(DeviceUnavailableError);
  });
});

describe('arecord backend', () => {
  it('should fail closed with DeviceUnavailableError when the binary is missing', async () => {
    const device = new ArecordDevice('/nonexistent/arecord');
    await expect(device.listDevices()).rejects.toThrow(DeviceUnavailableError);
    await expect(device.open('hw:0,0', OPEN_OPTS)).rejects.toThrow(DeviceUnavailableError);
  });

  it('should refuse an unpinned binary with a digest mismatch before spawning', async () => {
    // The node binary is executable but not a vetted helper: verification must
    // refuse it even though it would spawn fine.
    expect(ARECORD_SHA256_PINS).not.toContain(digestOf(process.execPath));
    const device = new ArecordDevice(process.execPath);
    await expect(device.open('hw:0,0', OPEN_OPTS)).rejects.toThrow(/digest mismatch/);
  });

  it('should honor the constructor allowlist for a measured binary', async () => {
    // Same node binary, now allowlisted by its measured digest: verification
    // passes and the failure moves to the spawn path (no arecord protocol).
    const device = new ArecordDevice(process.execPath, [digestOf(process.execPath)]);
    await expect(device.open('hw:0,0', OPEN_OPTS)).rejects.toThrow(/before first frame/);
  });

  it('should verify the digest before listing devices, not just before open', async () => {
    // G-NATIVE: enumeration executes the helper too, so the check applies here.
    const device = new ArecordDevice(process.execPath);
    await expect(device.listDevices()).rejects.toThrow(/digest mismatch/);
  });

  it('should decode frames and surface a nonzero exit as device loss', async () => {
    await withMode('frames-loss', async () => {
      const device = new ArecordDevice(FAKE_ARECORD, [digestOf(FAKE_ARECORD)]);
      const stream = await device.open('hw:9,9', OPEN_OPTS);
      const frames: Float32Array[] = [];
      await expect(
        (async () => {
          for await (const frame of stream.frames()) frames.push(frame);
        })(),
      ).rejects.toThrow(DeviceLostError);
      // 4 emitted frames of 320 samples each, then exit 1.
      expect(frames).toHaveLength(4);
      expect(frames.every((frame) => frame.length === 320)).toBe(true);
      expect(stream.closed).toBe(true);
    });
  });

  it('should fail open with DeviceOpenError when the child exits with no bytes after 60 ms', async () => {
    await withMode('exit-early', async () => {
      const device = new ArecordDevice(FAKE_ARECORD, [digestOf(FAKE_ARECORD)]);
      // 60 ms sits past any fixed ready probe (e.g. 50 ms): restoring one
      // would resolve the open as healthy and fail this assertion.
      const error = await device.open('hw:9,9', OPEN_OPTS).then(
        () => null,
        (reason: unknown) => reason,
      );
      expect(error).toBeInstanceOf(DeviceOpenError);
      expect((error as DeviceOpenError).message).toMatch(/no such device/);
    });
  });

  it('should close a streaming child without hanging', async () => {
    await withMode('infinite', async () => {
      const device = new ArecordDevice(FAKE_ARECORD, [digestOf(FAKE_ARECORD)]);
      const stream = await device.open('hw:9,9', OPEN_OPTS);
      let count = 0;
      for await (const frame of stream.frames()) {
        void frame;
        count += 1;
        if (count === 2) break;
      }
      stream.close();
      expect(stream.closed).toBe(true);
      stream.close();
    });
  });

  it('should parse `arecord -l` card/device lines without running anything', () => {
    const output = [
      '**** List of CAPTURE Hardware Devices ****',
      'card 2: USB [USB Audio Device], device 0: USB Audio [USB Audio]',
      '  Subdevices: 1/1',
      'card 2: USB [USB Audio Device], device 1: USB Audio #1 [USB Audio #1]',
    ].join('\n');
    expect(parseArecordList(output)).toEqual([
      { id: 'hw:2,0', name: 'USB [USB Audio Device], device 0: USB Audio [USB Audio]', backend: 'arecord' },
      { id: 'hw:2,1', name: 'USB [USB Audio Device], device 1: USB Audio #1 [USB Audio #1]', backend: 'arecord' },
    ]);
    expect(parseArecordList('no soundcards found...\n')).toEqual([]);
  });

  it('should parse the French-locale `arecord -l` form to the same canonical ids', () => {
    // Real host capture (fr_FR.UTF-8): locale words change, ids must not.
    const output = [
      '**** Liste des périphériques matériels CAPTURE ****',
      'carte 1 : Generic_1 [HD-Audio Generic], périphérique 0 : ALC294 Analog [ALC294 Analog]',
      '  Sous-périphériques : 1/1',
    ].join('\n');
    expect(parseArecordList(output)).toEqual([
      { id: 'hw:1,0', name: 'Generic_1 [HD-Audio Generic], device 0: ALC294 Analog [ALC294 Analog]', backend: 'arecord' },
    ]);
  });

  it('should build an exact argv with no shell metacharacters', () => {
    expect(buildArecordArgs('hw:2,0', { sampleRateHz: 16000, channels: 1, frameMs: 20 })).toEqual([
      '-D',
      'hw:2,0',
      '-f',
      'S16_LE',
      '-r',
      '16000',
      '-c',
      '1',
      '-t',
      'raw',
    ]);
    // A hostile device id becomes one opaque argv element, never shell syntax.
    const hostile = buildArecordArgs('hw:0,0; rm -rf /', { sampleRateHz: 16000, channels: 1, frameMs: 20 });
    expect(hostile[1]).toBe('hw:0,0; rm -rf /');
    expect(hostile.join(' ')).not.toMatch(/[`$()]/);
  });
});
