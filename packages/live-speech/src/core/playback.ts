export interface PlaybackFrame {
  connectionEpoch: number; turnEpoch: number; outputItemId: string; responseId: string;
  sequence: number; sampleOffset: number; sampleCount: number; sampleRateHz: number; payload: Uint8Array;
}
interface Item {
  responseId: string; sampleRateHz: number; sequence: number;
  generatedSamples: number; playedSamples: number; uncertaintySamples: number; generationDone: boolean;
}
const integer = (n: number) => Number.isSafeInteger(n) && n >= 0;

/** Transient PCM16 queue. The device renderer, not transport receipt, acknowledges playback. */
export class Playback {
  private active = true;
  private queue: PlaybackFrame[] = [];
  private queuedMs = 0;
  private items = new Map<string, Item>();
  constructor(private connectionEpoch: number, private turnEpoch: number) {
    if (!integer(connectionEpoch) || !integer(turnEpoch)) throw new Error('Invalid playback epoch');
  }

  bind(connectionEpoch: number, turnEpoch: number): void {
    if (!integer(connectionEpoch) || !integer(turnEpoch) || connectionEpoch < this.connectionEpoch
      || turnEpoch < this.turnEpoch || (connectionEpoch === this.connectionEpoch && turnEpoch === this.turnEpoch)) {
      throw new Error('Stale playback epoch');
    }
    this.clear();
    this.items.clear();
    this.connectionEpoch = connectionEpoch;
    this.turnEpoch = turnEpoch;
    this.active = true;
  }

  enqueue(frame: PlaybackFrame): boolean {
    if (!this.active || frame.connectionEpoch !== this.connectionEpoch || frame.turnEpoch !== this.turnEpoch
      || !frame.outputItemId || !frame.responseId || !integer(frame.sequence) || !integer(frame.sampleOffset)
      || !integer(frame.sampleCount) || frame.sampleCount === 0 || ![16000, 24000, 48000].includes(frame.sampleRateHz)
      || !(frame.payload instanceof Uint8Array) || frame.payload.byteLength !== frame.sampleCount * 2) return false;
    const previous = this.items.get(frame.outputItemId);
    if ((!previous && (frame.sequence !== 0 || frame.sampleOffset !== 0 || this.items.size >= 64))
      || (previous && (previous.sequence + 1 !== frame.sequence || previous.generatedSamples !== frame.sampleOffset
        || previous.responseId !== frame.responseId || previous.sampleRateHz !== frame.sampleRateHz))) return false;
    const durationMs = frame.sampleCount / frame.sampleRateHz * 1000;
    if (this.queuedMs + durationMs > 250) return false;
    const item = previous ?? { responseId: frame.responseId, sampleRateHz: frame.sampleRateHz,
      sequence: -1, generatedSamples: 0, playedSamples: 0, uncertaintySamples: 0, generationDone: false };
    item.sequence = frame.sequence;
    item.generatedSamples += frame.sampleCount;
    this.items.set(frame.outputItemId, item);
    this.queue.push({ ...frame, payload: frame.payload.slice() });
    this.queuedMs += durationMs;
    return true;
  }

  take(): PlaybackFrame | undefined {
    const frame = this.queue.shift();
    if (frame) this.queuedMs = Math.max(0, this.queuedMs - frame.sampleCount / frame.sampleRateHz * 1000);
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
