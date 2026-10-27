// Microphone capture session (r3 L4). Owns one device stream and pumps PCM
// frames into a bounded mailbox the consumer drains. The mic starts off and
// resets to off on close; mute drops frames without buffering them. Level
// metering and VAD classification run regardless of mic/mute state, so the
// control path and the VAD path stay independent. Device loss auto-closes the
// stream and is observable via diagnostics (events land in the next slice).
import type { AudioStream, DevicePort, OpenDeviceOptions } from './device.js';
import { DeviceLostError, DeviceOpenError } from './device.js';
import { rmsDbfs } from './utterance-buffer.js';

export interface CaptureFrame {
  readonly seq: number;
  readonly pcm: Float32Array;
  /** Energy-gate VAD decision, computed even when muted or mic-off. */
  readonly speech: boolean;
  readonly levelDb: number;
}

export interface CaptureSessionOptions extends OpenDeviceOptions {
  readonly energyThresholdDb: number;
  /** Mailbox cap: oldest frames drop with a counter, never unbounded growth. */
  readonly maxMailboxFrames: number;
}

export interface CaptureDiagnostics {
  readonly open: boolean;
  readonly micOn: boolean;
  readonly muted: boolean;
  readonly buffered: number;
  readonly dropped: number;
  readonly lost: string | null;
}

export interface CaptureSessionEvents {
  readonly onDeviceLost?: (error: DeviceLostError) => void;
  readonly onDropped?: (count: number) => void;
}

/** Mic capture over a DevicePort with independent control and VAD paths. */
export class CaptureSession {
  private stream: AudioStream | null = null;
  private pumpDone: Promise<void> | null = null;
  private micOn = false;
  private muted = false;
  private mailbox: CaptureFrame[] = [];
  private dropped = 0;
  private seq = 0;
  private lastLevelDb = -Infinity;
  private lost: string | null = null;

  constructor(
    private readonly device: DevicePort,
    private readonly options: CaptureSessionOptions,
    private readonly events: CaptureSessionEvents = {},
  ) {}

  /** Last observed frame level in dBFS, updated even when muted or mic-off. */
  get levelDb(): number {
    return this.lastLevelDb;
  }

  async open(deviceId: string): Promise<void> {
    if (this.stream !== null) throw new DeviceOpenError('capture already open');
    this.lost = null;
    const stream = await this.device.open(deviceId, this.options);
    this.stream = stream;
    this.pumpDone = this.pump(stream);
  }

  setMicOn(on: boolean): void {
    this.micOn = on;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  /** Take all buffered frames and clear the mailbox. Never audio-logged. */
  drain(): CaptureFrame[] {
    const frames = this.mailbox;
    this.mailbox = [];
    return frames;
  }

  diagnostics(): CaptureDiagnostics {
    const stream = this.stream;
    return {
      open: stream !== null && !stream.closed,
      micOn: this.micOn,
      muted: this.muted,
      buffered: this.mailbox.length,
      dropped: this.dropped,
      lost: this.lost,
    };
  }

  /** Stop the pump, close the device stream, reset control state. Idempotent. */
  async close(): Promise<void> {
    this.micOn = false;
    this.muted = false;
    this.mailbox = [];
    const stream = this.stream;
    this.stream = null;
    stream?.close();
    await this.pumpDone;
    this.pumpDone = null;
  }

  private async pump(stream: AudioStream): Promise<void> {
    try {
      for await (const pcm of stream.frames()) {
        const level = rmsDbfs(pcm);
        this.lastLevelDb = level;
        const frame: CaptureFrame = {
          seq: this.seq++,
          pcm,
          speech: level > this.options.energyThresholdDb,
          levelDb: level,
        };
        if (!this.micOn || this.muted) continue;
        if (this.mailbox.length >= this.options.maxMailboxFrames) {
          this.mailbox.shift();
          this.dropped += 1;
          this.events.onDropped?.(1);
        }
        this.mailbox.push(frame);
      }
    } catch (error) {
      if (error instanceof DeviceLostError) {
        this.lost = error.message;
        stream.close();
        this.events.onDeviceLost?.(error);
      } else {
        throw error;
      }
    }
  }
}
