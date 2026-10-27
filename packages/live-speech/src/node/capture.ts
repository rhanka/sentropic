// Microphone capture session (r3 L4). Owns one device stream and pumps PCM
// frames into a bounded mailbox the consumer drains. The mic starts off and
// resets to off on close; mute drops frames without buffering them. Level
// metering and VAD classification run regardless of mic/mute state, so the
// control path and the VAD path stay independent. Device loss auto-closes the
// stream and is observable via diagnostics (events land in the next slice).
import type { AudioStream, DevicePort, OpenDeviceOptions } from './device.js';
import { DeviceLostError, DeviceOpenError } from './device.js';
import { rmsDbfs } from './utterance-buffer.js';
// L1c mic mode consumed as a type only: no runtime dependency on the mesh.
import type { SpeechMicMode } from '../../../llm-mesh/src/speech/contracts.js';

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
  /** Explicit session choice, driven by the L1c profile micMode. Starts 'key'. */
  readonly micMode?: SpeechMicMode;
}

export interface CaptureDiagnostics {
  readonly open: boolean;
  readonly micMode: SpeechMicMode;
  readonly micOn: boolean;
  readonly muted: boolean;
  readonly buffered: number;
  readonly dropped: number;
  readonly lost: string | null;
  readonly error: string | null;
}

export interface CaptureSessionEvents {
  readonly onDeviceLost?: (error: DeviceLostError) => void;
  readonly onDropped?: (count: number) => void;
  /** VAD onset/offset for barge-in. Fires on the VAD path, independent of mic/mute. */
  readonly onSpeechStart?: (frame: CaptureFrame) => void;
  readonly onSpeechEnd?: (frame: CaptureFrame) => void;
  /** Non-loss pump failure (engine bug, never a device loss). Session closes. */
  readonly onError?: (error: Error) => void;
}

/** Mic capture over a DevicePort with independent control and VAD paths. */
export class CaptureSession {
  private stream: AudioStream | null = null;
  private pumpDone: Promise<void> | null = null;
  private micMode: SpeechMicMode;
  private micOn = false;
  private muted = false;
  private mailbox: CaptureFrame[] = [];
  private dropped = 0;
  private seq = 0;
  private speaking = false;
  private lastLevelDb = -Infinity;
  private lost: string | null = null;
  private fatal: string | null = null;

  constructor(
    private readonly device: DevicePort,
    private readonly options: CaptureSessionOptions,
    private readonly events: CaptureSessionEvents = {},
  ) {
    this.micMode = options.micMode ?? 'key';
  }

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

  /** Explicit open-mic session choice (spec §5.1: opt-in, never the default). */
  setMicMode(mode: SpeechMicMode): void {
    this.micMode = mode;
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
      micMode: this.micMode,
      micOn: this.micOn,
      muted: this.muted,
      buffered: this.mailbox.length,
      dropped: this.dropped,
      lost: this.lost,
      error: this.fatal,
    };
  }

  /** Stop the pump, close the device stream, reset control state. Idempotent. */
  async close(): Promise<void> {
    this.micMode = 'key';
    this.micOn = false;
    this.muted = false;
    this.speaking = false;
    this.fatal = null;
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
        const speech = level > this.options.energyThresholdDb;
        const frame: CaptureFrame = {
          seq: this.seq++,
          pcm,
          speech,
          levelDb: level,
        };
        // VAD onset/offset runs on its own path: independent of mic, mute and mode.
        if (speech && !this.speaking) {
          this.speaking = true;
          this.events.onSpeechStart?.(frame);
        } else if (!speech && this.speaking) {
          this.speaking = false;
          this.events.onSpeechEnd?.(frame);
        }
        // Open mic stays on: only mute gates the mailbox, never a key.
        if (this.muted) continue;
        if (this.micMode === 'key' && !this.micOn) continue;
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
        this.events.onDeviceLost?.(error);
      } else {
        // A non-loss pump failure must never reject unobserved: record it,
        // report it, and park the session closed so reopen starts clean.
        const failure = error instanceof Error ? error : new Error(String(error));
        this.fatal = failure.message;
        this.events.onError?.(failure);
      }
      stream.close();
      this.stream = null;
    }
  }
}
