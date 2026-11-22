import {
  chainCreditCheck,
  chainCreditTransfer,
  RELAY_LINK_MAX_FRAMES,
  RELAY_LINK_MAX_PAYLOAD_BYTES,
  type CreditFrame,
  type CreditState,
  type FrameDecision,
  type TransferDecision,
} from '../sessions/relay-credit.js';

export const REMOTE_CREDIT_MAX_RECORDS = RELAY_LINK_MAX_FRAMES;
export const REMOTE_CREDIT_MAX_BYTES = RELAY_LINK_MAX_PAYLOAD_BYTES;
export const REMOTE_CATALOGUE_RECORD_MAX_BYTES = 8192;
export const REMOTE_TERMINAL_CHUNK_MAX_RAW_BYTES = 16384;

export interface RemoteCreditGrant {
  readonly hopId: string;
  readonly direction: 'node-to-app' | 'app-to-browser';
  readonly ch: number;
  readonly linkGeneration: number;
  readonly creditRevision: number;
  readonly receivedThroughSeq: number;
  readonly receivedThroughBytes: number;
  readonly sendLimitSeq: number;
  readonly sendLimitBytes: number;
}

export interface RemoteCreditLedgerState extends RemoteCreditGrant {
  readonly recordEnds: readonly (readonly [number, number])[];
  readonly opened: boolean;
}

export interface RemoteHopTransferInput {
  readonly upstream: RemoteCreditGrant;
  readonly downstream: RemoteCreditGrant;
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
  readonly downstreamReceipt?: RemoteCreditGrant;
}

const toCreditFrame = (grant: RemoteCreditGrant): CreditFrame => ({
  circuitId: 'remote-trunk',
  tunnelId: grant.hopId,
  lane: `ch:${grant.ch}`,
  direction: grant.direction,
  linkGeneration: grant.linkGeneration,
  creditRevision: grant.creditRevision,
  receivedThroughFrame: grant.receivedThroughSeq,
  receivedThroughOffset: grant.receivedThroughBytes,
  sendLimitFrame: grant.sendLimitSeq,
  sendLimitOffset: grant.sendLimitBytes,
});

export function evaluateRemoteCreditGrant(
  grant: RemoteCreditGrant,
  state: RemoteCreditLedgerState,
): FrameDecision {
  if (
    grant.receivedThroughSeq < state.receivedThroughSeq
    || grant.receivedThroughBytes < state.receivedThroughBytes
    || grant.sendLimitSeq < grant.receivedThroughSeq
    || grant.sendLimitBytes < grant.receivedThroughBytes
  ) {
    return 'relay_frame_conflict';
  }
  const relayState: CreditState = {
    ...toCreditFrame(state),
    lastCredit: null,
    frameEnds: state.recordEnds,
    opened: state.opened,
  };
  return chainCreditCheck(toCreditFrame(grant), relayState);
}

export function evaluateRemoteHopCreditTransfer(
  input: RemoteHopTransferInput,
): TransferDecision {
  const { upstream, downstream, downstreamReceipt, ...rest } = input;
  return chainCreditTransfer({
    ...rest,
    upstream: toCreditFrame(upstream),
    downstream: toCreditFrame(downstream),
    ...(downstreamReceipt ? { downstreamReceipt: toCreditFrame(downstreamReceipt) } : {}),
  });
}

export type RemoteWindowSendResult =
  | { readonly ok: true; readonly nodeId: string; readonly seq: number; readonly cumulativeBytes: number }
  | { readonly ok: false; readonly reason: 'credit_exhausted' | 'record_oversize' | 'invalid_node_id' };

const NODE_ID_ASCII = /^[\x21-\x7e]{1,36}$/;

export function createRemoteChannelCreditWindow(options: {
  readonly hopId: string;
  readonly direction: 'node-to-app' | 'app-to-browser';
  readonly ch: number;
  readonly linkGeneration: number;
  readonly maxRecordBytes: number;
  readonly initialLimitRecords?: number;
  readonly initialLimitBytes?: number;
}) {
  if (!Number.isInteger(options.ch) || options.ch < 1) {
    throw new RangeError('Remote credit window requires integer ch >= 1 (ch 0 carries no credit)');
  }
  if (!Number.isInteger(options.linkGeneration) || options.linkGeneration < 1) {
    throw new RangeError('Remote credit window requires integer linkGeneration >= 1');
  }
  if (!Number.isInteger(options.maxRecordBytes) || options.maxRecordBytes < 1) {
    throw new RangeError('Remote credit window requires integer maxRecordBytes >= 1');
  }
  const initialLimitRecords = options.initialLimitRecords ?? REMOTE_CREDIT_MAX_RECORDS;
  const initialLimitBytes = options.initialLimitBytes ?? REMOTE_CREDIT_MAX_BYTES;
  if (!Number.isInteger(initialLimitRecords) || initialLimitRecords < 0 || initialLimitRecords > REMOTE_CREDIT_MAX_RECORDS) {
    throw new RangeError(`initialLimitRecords must be an integer in 0..${REMOTE_CREDIT_MAX_RECORDS}`);
  }
  if (!Number.isInteger(initialLimitBytes) || initialLimitBytes < 0 || initialLimitBytes > REMOTE_CREDIT_MAX_BYTES) {
    throw new RangeError(`initialLimitBytes must be an integer in 0..${REMOTE_CREDIT_MAX_BYTES}`);
  }

  let creditRevision = 1;
  let receivedThroughSeq = 0;
  let receivedThroughBytes = 0;
  let sendLimitSeq = initialLimitRecords;
  let sendLimitBytes = initialLimitBytes;
  let nextSeq = 1;
  let sentBytes = 0;
  const recordEnds: Array<readonly [number, number]> = [[0, 0]];

  return {
    send(nodeId: string, byteLength: number): RemoteWindowSendResult {
      if (typeof nodeId !== 'string' || !NODE_ID_ASCII.test(nodeId)) {
        return { ok: false, reason: 'invalid_node_id' };
      }
      if (!Number.isInteger(byteLength) || byteLength < 1 || byteLength > options.maxRecordBytes) {
        return { ok: false, reason: 'record_oversize' };
      }
      if (nextSeq > sendLimitSeq || sentBytes + byteLength > sendLimitBytes) {
        return { ok: false, reason: 'credit_exhausted' };
      }
      const seq = nextSeq;
      nextSeq += 1;
      sentBytes += byteLength;
      recordEnds.push([seq, sentBytes]);
      return { ok: true, nodeId, seq, cumulativeBytes: sentBytes };
    },
    applyCredit(grant: RemoteCreditGrant): FrameDecision {
      const decision = evaluateRemoteCreditGrant(grant, {
        hopId: options.hopId,
        direction: options.direction,
        ch: options.ch,
        linkGeneration: options.linkGeneration,
        creditRevision,
        receivedThroughSeq,
        receivedThroughBytes,
        sendLimitSeq,
        sendLimitBytes,
        recordEnds,
        opened: true,
      });
      if (decision === 'allow') {
        creditRevision = grant.creditRevision;
        receivedThroughSeq = grant.receivedThroughSeq;
        receivedThroughBytes = grant.receivedThroughBytes;
        sendLimitSeq = grant.sendLimitSeq;
        sendLimitBytes = grant.sendLimitBytes;
        while (recordEnds.length > 1 && recordEnds[0]![0] < grant.receivedThroughSeq) {
          recordEnds.shift();
        }
      }
      return decision;
    },
    retainedBoundaryCount(): number {
      return recordEnds.length;
    },
  };
}
