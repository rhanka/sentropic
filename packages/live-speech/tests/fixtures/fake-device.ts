// Scripted fake audio device (no microphone, no native code). Each open() consumes
// one script: an array of Float32Array frames, { lost: <message> } to inject a
// mid-stream device loss, or { hang: true } to never yield again.
import type { AudioDeviceInfo, AudioStream, DevicePort } from '../../src/node/device.js';
import { DeviceLostError, DeviceOpenError, DeviceUnavailableError } from '../../src/node/device.js';

export type FakeDeviceStep = Float32Array | { lost: string } | { error: string } | { hang: true };

export class FakeAudioStream implements AudioStream {
  private consumed = false;
  private _closed = false;
  private unpark: (() => void) | null = null;
  constructor(private readonly steps: FakeDeviceStep[]) {}

  get closed(): boolean { return this._closed; }

  async *frames(): AsyncGenerator<Float32Array> {
    if (this.consumed) return;
    this.consumed = true;
    try {
      for (const step of this.steps) {
        if (this._closed) return;
        if (step instanceof Float32Array) {
          yield step.slice();
        } else if ('lost' in step) {
          throw new DeviceLostError(step.lost);
        } else if ('error' in step) {
          throw new Error(step.error);
        } else {
          await new Promise<void>((resolve) => {
            this.unpark = resolve;
          });
          this.unpark = null;
        }
      }
    } finally {
      this._closed = true;
    }
  }

  close(): void {
    this._closed = true;
    this.unpark?.();
    this.unpark = null;
  }
}

export interface FakeDeviceOptions {
  devices?: AudioDeviceInfo[];
  failList?: string;
  failOpen?: string;
}

/** Scripted DevicePort. One script per open() call, consumed in order. */
export class FakeDevice implements DevicePort {
  readonly opened: string[] = [];
  closedCount = 0;
  private readonly scripts: FakeDeviceStep[][];
  constructor(
    scripts: FakeDeviceStep[][] = [],
    private readonly options: FakeDeviceOptions = {},
  ) {
    this.scripts = scripts.map((steps) => [...steps]);
  }

  async listDevices(): Promise<AudioDeviceInfo[]> {
    if (this.options.failList) throw new DeviceUnavailableError(this.options.failList);
    return (this.options.devices ?? [{ id: 'fake-default', name: 'Fake microphone', backend: 'fake' }]).map(
      (device) => ({ ...device }),
    );
  }

  async open(deviceId: string): Promise<AudioStream> {
    this.opened.push(deviceId);
    if (this.options.failOpen) throw new DeviceOpenError(this.options.failOpen);
    const steps = this.scripts.shift() ?? [];
    const stream = new FakeAudioStream(steps);
    const inner = stream.close.bind(stream);
    stream.close = () => {
      this.closedCount += 1;
      inner();
    };
    return stream;
  }
}
