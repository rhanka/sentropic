// CHAIN-FRAME-TRANSLATION credit evaluators (RC2.contract r3,
// vectors/state-transitions.json family CHAIN-FRAME-TRANSLATION, evaluators
// creditCheck / creditTransfer). Pure functions over plain JSON records.
// Per link/direction the credit ledger is absolute and monotonic; charges
// transfer once across links and are never copied downstream.
import type { RelayErrorCode } from './registry-types.js';

export type FrameDecision = 'allow' | RelayErrorCode | 'duplicate-no-grant';
export type TransferDecision = 'independent-credit-and-transfer-model' | 'premature-uncharge' | 'frame-map-required' | 'reservation-accounting-refused' | RelayErrorCode;

export const RELAY_LINK_MAX_FRAMES = 8;
export const RELAY_LINK_MAX_PAYLOAD_BYTES = 131072;

export interface CreditFrame {
  readonly circuitId: string;
  readonly tunnelId: string;
  readonly lane: string;
  readonly direction: string;
  readonly linkGeneration: number;
  readonly creditRevision: number;
  readonly receivedThroughFrame: number;
  readonly receivedThroughOffset: number;
  readonly sendLimitFrame: number;
  readonly sendLimitOffset: number;
}

export interface CreditState extends CreditFrame {
  readonly lastCredit: CreditFrame | null;
  readonly frameEnds: readonly (readonly [number, number])[];
  readonly opened: boolean;
}

// creditCheck: per link/direction the credit ledger is absolute and monotonic —
// foreign tuple, credit before Opened, old revision, same-revision conflict,
// non-boundary ack and a regressed ceiling are frame conflicts; a duplicate of
// the current credit grants nothing; a window beyond 8 frames / 131072 bytes of
// outstanding payload is backpressure.
export function chainCreditCheck(credit: CreditFrame, state: CreditState): FrameDecision {
  const tuple = ['circuitId', 'tunnelId', 'lane', 'direction', 'linkGeneration'] as const;
  for (const key of tuple) if (credit[key] !== state[key]) return 'relay_frame_conflict';
  if (state.opened === false) return 'relay_protocol_refused';
  if (credit.creditRevision < state.creditRevision) return 'relay_frame_conflict';
  if (credit.creditRevision === state.creditRevision) {
    const same = credit.receivedThroughFrame === state.receivedThroughFrame
      && credit.receivedThroughOffset === state.receivedThroughOffset
      && credit.sendLimitFrame === state.sendLimitFrame
      && credit.sendLimitOffset === state.sendLimitOffset;
    return same ? 'duplicate-no-grant' : 'relay_frame_conflict';
  }
  if (credit.creditRevision > state.creditRevision + 1) return 'relay_frame_conflict';
  if (!state.frameEnds.some(([f, o]) => f === credit.receivedThroughFrame && o === credit.receivedThroughOffset)) return 'relay_frame_conflict';
  if (credit.sendLimitFrame < state.sendLimitFrame || credit.sendLimitOffset < state.sendLimitOffset) return 'relay_frame_conflict';
  if (credit.sendLimitFrame - credit.receivedThroughFrame > RELAY_LINK_MAX_FRAMES) return 'relay_backpressure';
  if (credit.sendLimitOffset - credit.receivedThroughOffset > RELAY_LINK_MAX_PAYLOAD_BYTES) return 'relay_backpressure';
  return 'allow';
}

export interface CreditTransferInput {
  readonly upstream: CreditFrame;
  readonly downstream: CreditFrame;
  readonly queueBefore: number;
  readonly reservedBefore: number;
  readonly queueAfter: number;
  readonly reservedAfter: number;
  readonly totalBefore: number;
  readonly totalAfter: number;
  readonly upstreamNewCapacity: number;
  readonly downstreamReceiptValidated: boolean;
  readonly reservedAfterReceipt: number;
  readonly copiedDownstreamCredit: boolean;
  readonly downstreamReceipt?: CreditFrame;
}

// creditTransfer: each link keeps an independent credit ledger — charges
// transfer once (queue → reserved, total constant), never copied downstream.
// A reservation may be released only by a validated receipt on the downstream
// leg that is current (its own generation, next revision) and advancing.
export function chainCreditTransfer(input: CreditTransferInput): TransferDecision {
  if (input.copiedDownstreamCredit) return 'relay_frame_conflict';
  if (!(input.upstream.receivedThroughOffset > input.downstream.receivedThroughOffset)) return 'frame-map-required';
  if (input.upstreamNewCapacity > 0 && input.reservedAfter !== input.reservedBefore) return 'reservation-accounting-refused';
  if (input.totalBefore !== input.totalAfter) return 'relay_frame_conflict';
  if (input.queueAfter + input.reservedAfter !== input.queueBefore + input.reservedBefore) return 'relay_frame_conflict';
  if (input.reservedAfterReceipt < input.reservedAfter) {
    const r = input.downstreamReceipt;
    const d = input.downstream;
    if (!input.downstreamReceiptValidated || !r) return 'premature-uncharge';
    if (r.tunnelId !== d.tunnelId || r.lane !== d.lane || r.direction !== d.direction) return 'premature-uncharge';
    if (r.linkGeneration !== d.linkGeneration) return 'premature-uncharge';
    if (r.creditRevision !== d.creditRevision + 1) return 'premature-uncharge';
    if (!(r.receivedThroughFrame > d.receivedThroughFrame
      || (r.receivedThroughFrame === d.receivedThroughFrame && r.receivedThroughOffset > d.receivedThroughOffset))) return 'premature-uncharge';
  }
  return 'independent-credit-and-transfer-model';
}

