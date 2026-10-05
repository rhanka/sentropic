export const NATIVE_MAX_SSE_FRAME_BYTES = 1024 * 1024; // 1 MiB

export class NativeSseFrameOverflowError extends Error {
  constructor(message = 'SSE frame exceeded 1 MiB limit') {
    super(message);
    this.name = 'NativeSseFrameOverflowError';
  }
}

export interface NativeSseFrame {
  readonly rawBytes: Uint8Array;
  readonly event?: string;
  readonly data?: string;
  readonly id?: string;
  readonly retry?: number;
  readonly comments: readonly string[];
}

export const concatBytes = (parts: Uint8Array[]): Uint8Array => {
  if (parts.length === 1) return parts[0]!;
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let pos = 0;
  for (const part of parts) { out.set(part, pos); pos += part.length; }
  return out;
};

export const parseSseFrameText = (rawBytes: Uint8Array): {
  event?: string; data?: string; id?: string; retry?: number; comments: readonly string[];
} => {
  const lines = new TextDecoder('utf-8').decode(rawBytes).split(/\r\n|\r|\n/);
  let event: string | undefined;
  const dataLines: string[] = [];
  let id: string | undefined;
  let retry: number | undefined;
  const comments: string[] = [];
  for (const line of lines) {
    if (line.length === 0) continue;
    if (line.startsWith(':')) {
      comments.push(line.slice(1).startsWith(' ') ? line.slice(2) : line.slice(1));
      continue;
    }
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'data') dataLines.push(value);
    else if (field === 'id') id = value;
    else if (field === 'retry' && Number.isSafeInteger(Number(value))) retry = Number(value);
  }
  return {
    ...(event !== undefined ? { event } : {}),
    ...(dataLines.length > 0 ? { data: dataLines.join('\n') } : {}),
    ...(id !== undefined ? { id } : {}),
    ...(retry !== undefined ? { retry } : {}),
    comments: Object.freeze(comments),
  };
};

export class NativeSseFramer {
  private pendingSegments: Uint8Array[] = [];
  private pendingBytes = 0;
  private lineLength = 0;
  private hasContent = false;
  private pendingCr = false;

  constructor(private readonly maxFrameBytes = NATIVE_MAX_SSE_FRAME_BYTES) {}

  push(chunk: Uint8Array): NativeSseFrame[] {
    return [...this.frames(chunk)];
  }

  /** Yield each completed frame before inspecting later bytes in the transport chunk. */
  *frames(chunk: Uint8Array): Generator<NativeSseFrame> {
    const frames: NativeSseFrame[] = [];
    let segmentStart = 0;

    const emitFrame = (end: number) => {
      const slice = chunk.subarray(segmentStart, end);
      const frameBytes = this.pendingBytes + slice.length;
      if (frameBytes > this.maxFrameBytes) throw new NativeSseFrameOverflowError();
      const parts = slice.length > 0 ? [...this.pendingSegments, slice] : this.pendingSegments;
      if (parts.length === 0) return;
      const rawBytes = concatBytes(parts);
      this.pendingSegments = [];
      this.pendingBytes = 0;
      frames.push({ rawBytes, ...parseSseFrameText(rawBytes) });
      segmentStart = end;
    };

    const endLine = (endIndex: number) => {
      if (this.lineLength === 0) {
        emitFrame(endIndex);
        this.hasContent = false;
      } else {
        this.hasContent = true;
        this.lineLength = 0;
      }
    };

    for (let i = 0; i < chunk.length; i += 1) {
      const b = chunk[i]!;
      if (this.pendingCr) {
        this.pendingCr = false;
        if (b === 0x0a) {
          if (this.pendingBytes + (i + 1 - segmentStart) > this.maxFrameBytes) {
            throw new NativeSseFrameOverflowError();
          }
          endLine(i + 1);
          if (frames.length) yield frames.pop()!;
          continue;
        }
        if (this.pendingBytes + (i - segmentStart) > this.maxFrameBytes) {
          throw new NativeSseFrameOverflowError();
        }
        endLine(i);
        if (frames.length) yield frames.pop()!;
      }
      if (this.pendingBytes + (i + 1 - segmentStart) > this.maxFrameBytes) {
        throw new NativeSseFrameOverflowError();
      }
      if (b === 0x0d) this.pendingCr = true;
      else if (b === 0x0a) {
        endLine(i + 1);
        if (frames.length) yield frames.pop()!;
      }
      else this.lineLength += 1;
    }

    if (segmentStart < chunk.length) {
      const slice = chunk.subarray(segmentStart);
      this.pendingSegments.push(slice);
      this.pendingBytes += slice.length;
      if (this.pendingBytes > this.maxFrameBytes) throw new NativeSseFrameOverflowError();
    }
  }

  finish(): NativeSseFrame[] {
    const frames: NativeSseFrame[] = [];
    if (this.pendingCr) {
      this.pendingCr = false;
      if (this.lineLength === 0) {
        if (this.pendingBytes > this.maxFrameBytes) throw new NativeSseFrameOverflowError();
        if (this.pendingSegments.length > 0) {
          const rawBytes = concatBytes(this.pendingSegments);
          this.pendingSegments = [];
          this.pendingBytes = 0;
          frames.push({ rawBytes, ...parseSseFrameText(rawBytes) });
        }
      } else {
        this.lineLength = 0;
        this.hasContent = true;
      }
    }
    return frames;
  }
}

export async function* parseNativeSseStream(
  source: AsyncIterable<Uint8Array>, maxFrameBytes = NATIVE_MAX_SSE_FRAME_BYTES,
): AsyncGenerator<NativeSseFrame, void, undefined> {
  const framer = new NativeSseFramer(maxFrameBytes);
  for await (const chunk of source) {
    if (!(chunk instanceof Uint8Array)) throw new TypeError('Invalid native stream chunk');
    yield* framer.frames(chunk);
  }
  for (const frame of framer.finish()) yield frame;
}
