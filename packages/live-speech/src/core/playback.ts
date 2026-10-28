export interface PlaybackFrame {
  speechSessionId: string; streamId: string;
  connectionEpoch: number; turnEpoch: number; outputItemId: string; responseId: string;
  sequence: number; sampleOffset: number; sampleCount: number; payload: Uint8Array;
  format: { codec: 'pcm16-le' | 'opus'; sampleRateHz: 16000 | 24000 | 48000; channels: 1 };
}
interface Item {
  responseId: string; streamId: string; sampleRateHz: number;
  generatedSamples: number; playedSamples: number; uncertaintySamples: number; generationDone: boolean;
}
const integer = (n: number) => Number.isSafeInteger(n) && n >= 0;

/** Transient PCM16 queue. The device renderer, not transport receipt, acknowledges playback. */
export class Playback {
  private active = true;
  private queue: PlaybackFrame[] = [];
  private queuedMs = 0;
  private items = new Map<string, Item>();
  private streams = new Map<string, number>();
  constructor(private readonly speechSessionId: string, private connectionEpoch: number, private turnEpoch: number) {
    if (!speechSessionId || !integer(connectionEpoch) || !integer(turnEpoch)) throw new Error('Invalid playback epoch');
  }

  bind(connectionEpoch: number, turnEpoch: number): void {
    if (!integer(connectionEpoch) || !integer(turnEpoch) || connectionEpoch < this.connectionEpoch
      || turnEpoch < this.turnEpoch || (connectionEpoch === this.connectionEpoch && turnEpoch === this.turnEpoch)) {
      throw new Error('Stale playback epoch');
    }
    this.clear();
    this.items.clear();
    this.streams.clear();
    this.connectionEpoch = connectionEpoch;
    this.turnEpoch = turnEpoch;
    this.active = true;
  }

  enqueue(frame: PlaybackFrame): boolean {
    if (!this.active || frame.speechSessionId !== this.speechSessionId
      || frame.connectionEpoch !== this.connectionEpoch || frame.turnEpoch !== this.turnEpoch
      || !frame.outputItemId || !frame.responseId || !frame.streamId || !integer(frame.sequence) || !integer(frame.sampleOffset)
      || !integer(frame.sampleCount) || frame.sampleCount === 0 || !frame.format
      || frame.format.codec !== 'pcm16-le' || frame.format.channels !== 1
      || ![16000, 24000, 48000].includes(frame.format.sampleRateHz)
      || !(frame.payload instanceof Uint8Array) || frame.payload.byteLength !== frame.sampleCount * 2) return false;
    const streamSequence = this.streams.get(frame.streamId) ?? -1;
    if (frame.sequence !== streamSequence + 1 || (!this.streams.has(frame.streamId) && this.streams.size >= 64)) return false;
    const previous = this.items.get(frame.outputItemId);
    if ((!previous && (frame.sampleOffset !== 0 || this.items.size >= 64))
      || (previous && (previous.generatedSamples !== frame.sampleOffset || previous.streamId !== frame.streamId
        || previous.responseId !== frame.responseId || previous.sampleRateHz !== frame.format.sampleRateHz))) return false;
    const durationMs = frame.sampleCount / frame.format.sampleRateHz * 1000;
    if (this.queuedMs + durationMs > 250) return false;
    const item = previous ?? { responseId: frame.responseId, streamId: frame.streamId, sampleRateHz: frame.format.sampleRateHz,
      generatedSamples: 0, playedSamples: 0, uncertaintySamples: 0, generationDone: false };
    item.generatedSamples += frame.sampleCount;
    this.items.set(frame.outputItemId, item);
    this.streams.set(frame.streamId, frame.sequence);
    this.queue.push({ ...frame, format: { ...frame.format }, payload: frame.payload.slice() });
    this.queuedMs += durationMs;
    return true;
  }

  take(): PlaybackFrame | undefined {
    const frame = this.queue.shift();
    if (frame) this.queuedMs = Math.max(0, this.queuedMs - frame.sampleCount / frame.format.sampleRateHz * 1000);
    return frame;
  }

  rendered(outputItemId: string, samples: number, uncertaintySamples: number): void {
    const item = this.items.get(outputItemId);
    if (!this.active || !item || !integer(samples) || !integer(uncertaintySamples) || samples < item.playedSamples) return;
    item.playedSamples = Math.min(samples, item.generatedSamples);
    item.uncertaintySamples = Math.min(uncertaintySamples, item.generatedSamples);
  }

  generatedDone(outputItemId: string): void {
    const item = this.items.get(outputItemId);
    if (item) item.generationDone = true;
  }

  progress(outputItemId: string) {
    const item = this.items.get(outputItemId);
    return item ? { outputItemId, generatedSamples: item.generatedSamples, playedSamples: item.playedSamples,
      uncertaintySamples: item.uncertaintySamples, generationDone: item.generationDone } : undefined;
  }

  clear() {
    const heard = [...this.items].map(([outputItemId, item]) => ({ outputItemId,
      playedSamples: item.playedSamples, uncertaintySamples: item.uncertaintySamples }));
    this.active = false;
    this.queue = [];
    this.queuedMs = 0;
    return heard;
  }
}
