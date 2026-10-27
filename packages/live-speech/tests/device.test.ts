// Device-port tests, part 1 (r3 L4): pure argv/list parsers and the fail-closed
// backend path. Streaming (open/frames/loss) lands with the frame pump.
import { describe, expect, it } from 'vitest';
import { ArecordDevice, buildArecordArgs, DeviceUnavailableError, parseArecordList } from '../src/node/device.js';

describe('arecord backend', () => {
  it('should fail closed with DeviceUnavailableError when the binary is missing', async () => {
    const device = new ArecordDevice('/nonexistent/arecord');
    await expect(device.listDevices()).rejects.toThrow(DeviceUnavailableError);
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
