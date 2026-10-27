// Device-port tests, part 1 (r3 L4): pure argv/list parsers, the fail-closed
// backend path, and the scripted fake device. Streaming (open/frames/loss)
// lands with the frame pump.
import { describe, expect, it } from 'vitest';
import {
  ArecordDevice,
  buildArecordArgs,
  DeviceLostError,
  DeviceOpenError,
  DeviceUnavailableError,
  parseArecordList,
} from '../src/node/device.js';
import { FakeDevice } from './fixtures/fake-device.js';
import { silence, tone } from './helpers.js';

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
    await expect(
      device.open('hw:0,0', { sampleRateHz: 16000, channels: 1, frameMs: 20 }),
    ).rejects.toThrow(DeviceUnavailableError);
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
