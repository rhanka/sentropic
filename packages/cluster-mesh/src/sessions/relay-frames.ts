// CHAIN-FRAME-TRANSLATION frame re-framing evaluator (RC2.contract r3,
// vectors/state-transitions.json family CHAIN-FRAME-TRANSLATION, evaluator
// translation). Pure functions; no I/O.
import { createHash } from 'node:crypto';
import type { RelayErrorCode } from './registry-types.js';

export interface DataFrame {
  readonly kind: 'data';
  readonly circuitId: string;
  readonly tunnelId: string;
  readonly lane: string;
  readonly direction: string;
  readonly linkGeneration: number;
  readonly frameSequence: number;
  readonly byteOffset: number;
  readonly byteLength: number;
  readonly ciphertext: string; // base64
}

export interface TranslationInput {
  readonly incoming: readonly DataFrame[];
  readonly outgoing: readonly DataFrame[];
}

export interface TranslationResult {
  readonly decision: 'allow' | RelayErrorCode;
  readonly byteLength: number;
  readonly sha256: string;
  readonly incomingFrames: number;
  readonly outgoingFrames: number;
}

export const RELAY_DATA_MAX_ENCODED = 24576;
export const RELAY_DATA_MAX_DECODED = 16384;

const b64 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'base64'));

function concatCiphertext(frames: readonly DataFrame[]): Uint8Array | null {
  let expectedOffset = 0;
  let expectedSequence = 1;
  const parts: Uint8Array[] = [];
  for (const f of frames) {
    if (f.byteOffset !== expectedOffset || f.frameSequence !== expectedSequence) return null;
    const bytes = b64(f.ciphertext);
    if (bytes.length !== f.byteLength) return null;
    parts.push(bytes);
    expectedOffset += f.byteLength;
    expectedSequence += 1;
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// translation: the next link re-frames the identical byte stream — new tunnelId
// and linkGeneration, counters restart at 1/0, ciphertext preserved byte-for-
// byte. Any mutation, gap or overlap is a frame conflict.
export function chainTranslateFrames(input: TranslationInput): TranslationResult {
  const { incoming, outgoing } = input;
  if (incoming.length === 0 || outgoing.length === 0) {
    return { decision: 'relay_frame_conflict', byteLength: 0, sha256: '', incomingFrames: incoming.length, outgoingFrames: outgoing.length };
  }
  const inBytes = concatCiphertext(incoming);
  const outBytes = concatCiphertext(outgoing);
  if (!inBytes || !outBytes) {
    return { decision: 'relay_frame_conflict', byteLength: 0, sha256: '', incomingFrames: incoming.length, outgoingFrames: outgoing.length };
  }
  const head = incoming[0];
  for (const f of incoming) {
    if (f.tunnelId !== head.tunnelId || f.linkGeneration !== head.linkGeneration) {
      return { decision: 'relay_frame_conflict', byteLength: 0, sha256: '', incomingFrames: incoming.length, outgoingFrames: outgoing.length };
    }
  }
  for (const f of [...incoming, ...outgoing]) {
    if (f.circuitId !== head.circuitId || f.lane !== head.lane || f.direction !== head.direction) {
      return { decision: 'relay_frame_conflict', byteLength: 0, sha256: '', incomingFrames: incoming.length, outgoingFrames: outgoing.length };
    }
  }
  const outHead = outgoing[0];
  for (const f of outgoing) {
    if (f.tunnelId !== outHead.tunnelId || f.linkGeneration !== outHead.linkGeneration) {
      return { decision: 'relay_frame_conflict', byteLength: 0, sha256: '', incomingFrames: incoming.length, outgoingFrames: outgoing.length };
    }
  }
  if (inBytes.length !== outBytes.length) {
    return { decision: 'relay_frame_conflict', byteLength: inBytes.length, sha256: '', incomingFrames: incoming.length, outgoingFrames: outgoing.length };
  }
  for (let i = 0; i < inBytes.length; i += 1) {
    if (inBytes[i] !== outBytes[i]) {
      return { decision: 'relay_frame_conflict', byteLength: inBytes.length, sha256: '', incomingFrames: incoming.length, outgoingFrames: outgoing.length };
    }
  }
  const sha256 = createHash('sha256').update(inBytes).digest('hex');
  return { decision: 'allow', byteLength: inBytes.length, sha256, incomingFrames: incoming.length, outgoingFrames: outgoing.length };
}
