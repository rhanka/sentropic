// Capture-session tests, core (r3 L4): mic starts off, toggle forwards frames
// with VAD flags, mute is independent of VAD and metering, drain empties.
// Loss events and mailbox bounds land in the second slice.
import { describe, expect, it } from 'vitest';
import { CaptureSession } from '../src/node/capture.js';
import { FakeDevice } from './fixtures/fake-device.js';
import type { FakeDeviceStep } from './fixtures/fake-device.js';
import { flush, silence, tone } from './helpers.js';

const opts = { sampleRateHz: 16000, channels: 1 as const, frameMs: 50, energyThresholdDb: -45 };

async function opened(
  scripts: FakeDeviceStep[][],
  micOn = false,
): Promise<{ capture: CaptureSession; device: FakeDevice }> {
  const device = new FakeDevice(scripts);
  const capture = new CaptureSession(device, { ...opts, maxMailboxFrames: 32 });
  await capture.open('fake-default');
  // Set the mic state before the pump drains the finite script.
  if (micOn) capture.setMicOn(true);
  await flush(10);
  return { capture, device };
}

describe('capture session core', () => {
  it('should start with the mic off while the meter keeps running', async () => {
    const { capture } = await opened([[tone(0.1)]]);
    expect(capture.diagnostics()).toMatchObject({ micOn: false, buffered: 0 });
    // Nothing forwarded, but the level meter observed the loud frame.
    expect(capture.drain()).toEqual([]);
    expect(capture.levelDb).toBeGreaterThan(-45);
    await capture.close();
  });

  it('should forward frames with VAD flags once the mic is on', async () => {
    const { capture } = await opened([[tone(0.1), silence(0.1)]], true);
    const frames = capture.drain();
    expect(frames.length).toBeGreaterThan(0);
    expect(frames[0]).toMatchObject({ seq: 0, speech: true });
    expect(frames.every((frame) => typeof frame.levelDb === 'number')).toBe(true);
    await capture.close();
  });

  it('should keep metering and VAD while muted without forwarding', async () => {
    const device = new FakeDevice([[tone(0.1)], [tone(0.1)]]);
    const capture = new CaptureSession(device, { ...opts, maxMailboxFrames: 32 });
    await capture.open('fake-default');
    capture.setMicOn(true);
    capture.setMuted(true);
    await flush(10);
    // Muted: nothing forwarded, but the meter still observed the loud frame —
    // control and VAD are independent paths.
    expect(capture.drain()).toEqual([]);
    expect(capture.levelDb).toBeGreaterThan(-45);
    // Close resets to mic-off/unmuted; reopening resumes forwarding.
    await capture.close();
    await capture.open('fake-default');
    capture.setMicOn(true);
    await flush(10);
    expect(capture.drain().length).toBeGreaterThan(0);
    await capture.close();
  });

  it('should empty the mailbox on drain', async () => {
    const { capture } = await opened([[tone(0.1)]], true);
    expect(capture.diagnostics().buffered).toBeGreaterThan(0);
    capture.drain();
    expect(capture.diagnostics()).toMatchObject({ buffered: 0, dropped: 0 });
    await capture.close();
  });
});

describe('capture session bounds and loss', () => {
  it('should bound the mailbox by dropping the oldest frames with a counter', async () => {
    const dropped: number[] = [];
    const device = new FakeDevice([[tone(0.05), tone(0.05), tone(0.05), tone(0.05), tone(0.05)]]);
    const capture = new CaptureSession(
      device,
      { ...opts, maxMailboxFrames: 2 },
      { onDropped: (count) => dropped.push(count) },
    );
    await capture.open('fake-default');
    capture.setMicOn(true);
    await flush(10);
    const frames = capture.drain();
    // Only the newest 2 survive; the 3 oldest dropped exactly once each.
    expect(frames).toHaveLength(2);
    expect(frames.map((frame) => frame.seq)).toEqual([3, 4]);
    expect(capture.diagnostics().dropped).toBe(3);
    expect(dropped).toEqual([1, 1, 1]);
    await capture.close();
  });

  it('should auto-close and report a mid-stream device loss', async () => {
    const lost: string[] = [];
    const device = new FakeDevice([[tone(0.05), { lost: 'device unplugged' }]]);
    const capture = new CaptureSession(
      device,
      { ...opts, maxMailboxFrames: 8 },
      { onDeviceLost: (error) => lost.push(error.message) },
    );
    await capture.open('fake-default');
    capture.setMicOn(true);
    await flush(10);
    // The loud frame made it out before the loss; the loss is recorded.
    expect(capture.drain()).toHaveLength(1);
    expect(capture.diagnostics()).toMatchObject({ open: false });
    expect(capture.diagnostics().lost).toMatch(/device unplugged/);
    expect(lost).toHaveLength(1);
    expect(device.closedCount).toBeGreaterThanOrEqual(1);
    // Closing after a loss is safe and idempotent.
    await capture.close();
    await capture.close();
  });

  it('should reject a second open while already open', async () => {
    const { capture } = await opened([[tone(0.05)]], true);
    await expect(capture.open('fake-default')).rejects.toThrow('already open');
    await capture.close();
  });
});
