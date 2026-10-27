// OS audio-device port (r3 L4). The session never touches hardware: capture
// consumes this port, tests inject fakes, and the arecord backend spawns the
// vetted system binary with an explicit argv (no shell, no audio files).
import { spawn } from 'node:child_process';

export interface AudioDeviceInfo {
  /** Backend device selector passed back to open(), e.g. 'hw:2,0'. */
  readonly id: string;
  readonly name: string;
  readonly backend: 'arecord' | 'fake';
}

export interface OpenDeviceOptions {
  readonly sampleRateHz: number;
  /** Mono capture only: the L4 path is single-channel 16-bit PCM. */
  readonly channels: 1;
  readonly frameMs: number;
}

export interface AudioStream {
  /** Yields 16-bit mono PCM frames; throws DeviceLostError when the device dies. */
  frames(): AsyncIterable<Float32Array>;
  close(): void;
  readonly closed: boolean;
}

export interface DevicePort {
  listDevices(): Promise<AudioDeviceInfo[]>;
  open(deviceId: string, options: OpenDeviceOptions): Promise<AudioStream>;
}

export class DeviceUnavailableError extends Error {
  readonly code = 'stt_device_unavailable';
  constructor(message: string) {
    super(`Audio device unavailable: ${message}`);
    this.name = 'DeviceUnavailableError';
  }
}

export class DeviceOpenError extends Error {
  readonly code = 'stt_device_open';
  constructor(message: string) {
    super(`Cannot open audio device: ${message}`);
    this.name = 'DeviceOpenError';
  }
}

export class DeviceLostError extends Error {
  readonly code = 'stt_device_lost';
  constructor(message: string) {
    super(`Audio device lost: ${message}`);
    this.name = 'DeviceLostError';
  }
}

/** Exact arecord argv for raw mono capture. Pure: unit-tested without spawning. */
export function buildArecordArgs(deviceId: string, options: OpenDeviceOptions): string[] {
  return ['-D', deviceId, '-f', 'S16_LE', '-r', String(options.sampleRateHz), '-c', '1', '-t', 'raw'];
}

/** Parse `arecord -l` capture-device lines. Pure: unit-tested without hardware. */
export function parseArecordList(output: string): AudioDeviceInfo[] {
  const devices: AudioDeviceInfo[] = [];
  for (const line of output.split('\n')) {
    const match = /^card (\d+): (.+), device (\d+): (.+)$/.exec(line.trim());
    if (!match) continue;
    devices.push({
      id: `hw:${match[1]},${match[3]}`,
      name: `${match[2]}, device ${match[3]}: ${match[4]}`,
      backend: 'arecord',
    });
  }
  return devices;
}

/** Backend spawning the system arecord binary (alsa-utils). Fails closed. */
export class ArecordDevice implements DevicePort {
  constructor(private readonly binary = process.env.ARECORD_BIN ?? 'arecord') {}

  async listDevices(): Promise<AudioDeviceInfo[]> {
    return new Promise<AudioDeviceInfo[]>((resolve, reject) => {
      const child = spawn(this.binary, ['-l'], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.on('error', () => reject(new DeviceUnavailableError(`${this.binary} is not installed or not executable`)));
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.on('close', (code) => {
        if (code === 0) resolve(parseArecordList(stdout));
        else reject(new DeviceUnavailableError(`\`${this.binary} -l\` exited ${String(code)}: ${stderr.slice(-300)}`));
      });
    });
  }

  async open(deviceId: string, options: OpenDeviceOptions): Promise<AudioStream> {
    const child = spawn(this.binary, buildArecordArgs(deviceId, options), {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stream = new ArecordAudioStream(child, options);
    // A spawn failure (missing binary) rejects the open, never yields frames.
    const failure = await stream.ready();
    if (failure !== null) throw failure;
    return stream;
  }
}
/** Stdout of one arecord child as Float32Array frames with stream backpressure. */
class ArecordAudioStream implements AudioStream {
  private _closed = false;
  private readonly queue: Float32Array[] = [];
  private waiter: (() => void) | null = null;
  private failure: DeviceLostError | DeviceOpenError | DeviceUnavailableError | null = null;
  private spawned: (() => void) | null = null;
  private readonly readyPromise: Promise<DeviceLostError | DeviceOpenError | DeviceUnavailableError | null>;
  private leftover = Buffer.alloc(0);
  private stderrTail = '';
  private settled = false;

  constructor(
    private readonly child: ReturnType<typeof spawn>,
    private readonly options: OpenDeviceOptions,
  ) {
    this.readyPromise = new Promise((resolve) => {
      this.spawned = () => resolve(this.failure);
    });
    child.on('error', () => {
      this.fail(new DeviceUnavailableError('arecord is not installed or not executable'));
    });
    child.stdout?.on('data', (chunk: Buffer) => this.onBytes(chunk));
    child.stderr?.on('data', (chunk: Buffer) => {
      this.stderrTail = `${this.stderrTail}${chunk.toString('utf8')}`.slice(-300);
    });
    // An exit before streaming fails the open; a later exit fails the iterator.
    child.on('close', (code) => {
      if (this._closed) return;
      const message = `arecord exited ${String(code)}: ${this.stderrTail}`;
      if (this.queue.length === 0 && !this.settled) {
        this.fail(new DeviceOpenError(`${message} (before first frame)`));
      } else {
        this.fail(new DeviceLostError(message));
      }
    });
    // First bytes (or first tick) prove the child spawned: resolve ready then.
    const probe = setTimeout(() => this.spawned?.(), 50);
    probe.unref?.();
  }

  get closed(): boolean {
    return this._closed;
  }

  /** Resolves null once the child is up, or the open/stream failure. Never yields. */
  ready(): Promise<DeviceLostError | DeviceOpenError | DeviceUnavailableError | null> {
    return this.readyPromise.then((failure) => {
      this.settled = true;
      return failure;
    });
  }

  private onBytes(chunk: Buffer): void {
    this.spawned?.();
    this.leftover = Buffer.concat([this.leftover, chunk]);
    const frameBytes = Math.floor((this.options.frameMs / 1000) * this.options.sampleRateHz) * 2;
    while (this.leftover.length >= frameBytes) {
      const slice = this.leftover.subarray(0, frameBytes);
      this.leftover = this.leftover.subarray(frameBytes);
      const frame = new Float32Array(frameBytes / 2);
      for (let i = 0; i < frame.length; i++) frame[i] = slice.readInt16LE(i * 2) / 32768;
      this.queue.push(frame);
      // Bounded device edge: pause stdout while the consumer is behind.
      if (this.queue.length > 8) this.child.stdout?.pause();
    }
    this.waiter?.();
  }

  private fail(error: DeviceLostError | DeviceOpenError | DeviceUnavailableError): void {
    if (this.failure !== null || this._closed) return;
    this.failure = error;
    this.spawned?.();
    this.waiter?.();
  }

  async *frames(): AsyncIterable<Float32Array> {
    try {
      for (;;) {
        while (this.queue.length === 0) {
          if (this._closed) return;
          if (this.failure !== null) throw this.failure;
          await new Promise<void>((resolve) => {
            this.waiter = resolve;
          });
          this.waiter = null;
        }
        const frame = this.queue.shift();
        if (this.queue.length <= 2) this.child.stdout?.resume();
        if (frame) yield frame;
        if (this._closed) return;
        if (this.failure !== null && this.queue.length === 0) throw this.failure;
      }
    } finally {
      this.close();
    }
  }

  close(): void {
    if (this._closed) return;
    this._closed = true;
    this.waiter?.();
    try {
      this.child.kill('SIGTERM');
    } catch {
      // Already gone.
    }
  }
}
