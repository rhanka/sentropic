export const FRAME_CAP = 1024 * 1024;
export const LOGICAL_CAP = 8 * 1024 * 1024;
export const MCP_JSON_CAP = 256 * 1024;

export class FramingError extends Error {
  constructor(
    readonly code: 'frame-too-large' | 'logical-update-too-large' | 'incomplete-frame',
  ) {
    super(code);
  }
}

export function assertFrameSize(frame: Uint8Array): void {
  if (!(frame instanceof Uint8Array)) throw new FramingError('incomplete-frame');
  if (frame.byteLength > FRAME_CAP) throw new FramingError('frame-too-large');
  if (frame.byteLength === 0) throw new FramingError('incomplete-frame');
}

export function reassemble(frames: readonly Uint8Array[], expectedLength?: number): Uint8Array {
  if (!Array.isArray(frames) || frames.length === 0) throw new FramingError('incomplete-frame');
  let total = 0;
  for (const frame of frames) {
    assertFrameSize(frame);
    total += frame.byteLength;
    if (total > LOGICAL_CAP) throw new FramingError('logical-update-too-large');
  }
  if (expectedLength !== undefined) {
    if (!Number.isSafeInteger(expectedLength) || expectedLength < 0 || expectedLength > LOGICAL_CAP) {
      throw new FramingError('logical-update-too-large');
    }
    if (total < expectedLength) throw new FramingError('incomplete-frame');
    if (total > expectedLength) throw new FramingError('logical-update-too-large');
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const frame of frames) {
    out.set(frame, offset);
    offset += frame.byteLength;
  }
  return out;
}

export function splitForTransport(update: Uint8Array, maxFrame: number = FRAME_CAP): Uint8Array[] {
  if (!(update instanceof Uint8Array)) throw new FramingError('incomplete-frame');
  if (update.byteLength === 0) throw new FramingError('incomplete-frame');
  if (update.byteLength > LOGICAL_CAP) throw new FramingError('logical-update-too-large');
  if (!Number.isSafeInteger(maxFrame) || maxFrame <= 0 || maxFrame > FRAME_CAP) {
    throw new FramingError('frame-too-large');
  }
  const frames: Uint8Array[] = [];
  for (let offset = 0; offset < update.byteLength; offset += maxFrame) {
    frames.push(update.slice(offset, offset + maxFrame));
  }
  return frames;
}
