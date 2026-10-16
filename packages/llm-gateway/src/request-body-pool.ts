import { GatewayError } from './router/errors.js';

/** 512 MiB host assumption: 256 MiB baseline, 8x body amplification, rounded down. */
export const GATEWAY_INFLIGHT_BODY_BYTES = 32_000_000;
export const REQUEST_BODY_CAPACITY_MESSAGE = 'Gateway request body capacity is temporarily exhausted; retry later.';

export interface GatewayBodyByteLease {
  readonly bytes: number;
  extend(bytes: number): void;
  shrink(bytes: number): void;
  release(): void;
}

/** One synchronous, byte-proportional pool; no request semaphore or waiting queue. */
export class GatewayBodyBytePool {
  private reserved = 0;
  private live = 0;
  private acquired = 0;
  private released = 0;
  constructor(readonly capacityBytes = GATEWAY_INFLIGHT_BODY_BYTES) {
    if (!Number.isSafeInteger(capacityBytes) || capacityBytes < 1) throw new Error('Invalid gateway body capacity');
  }
  get stats() {
    return { reservedBytes: this.reserved, liveLeases: this.live,
      acquisitions: this.acquired, releases: this.released };
  }
  acquire(): GatewayBodyByteLease {
    this.live += 1;
    this.acquired += 1;
    let held = 0;
    let done = false;
    return {
      get bytes() { return held; },
      extend: bytes => {
        if (done || !Number.isSafeInteger(bytes) || bytes < 0) throw new Error('Invalid gateway body extension');
        if (bytes > this.capacityBytes - this.reserved) {
          throw new GatewayError('request-body-capacity', REQUEST_BODY_CAPACITY_MESSAGE, 1);
        }
        this.reserved += bytes;
        held += bytes;
      },
      shrink: bytes => {
        if (done || !Number.isSafeInteger(bytes) || bytes < 0 || bytes > held) throw new Error('Invalid gateway body shrink');
        this.reserved -= held - bytes;
        held = bytes;
      },
      release: () => {
        if (done) return;
        done = true;
        this.reserved -= held;
        held = 0;
        this.live -= 1;
        this.released += 1;
      },
    };
  }
}

/** Shared by every router and exported pre-parser within this process. */
export const defaultGatewayBodyBytePool = new GatewayBodyBytePool();
