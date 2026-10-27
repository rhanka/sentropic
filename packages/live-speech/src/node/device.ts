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

  async open(): Promise<AudioStream> {
    throw new DeviceOpenError('streaming open lands with the frame pump');
  }
}
