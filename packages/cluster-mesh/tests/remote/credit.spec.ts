import { describe, expect, it } from 'vitest';
import { RELAY_LINK_MAX_FRAMES, RELAY_LINK_MAX_PAYLOAD_BYTES } from '../../src/sessions/relay-credit.js';
import {
  createRemoteChannelCreditWindow, evaluateRemoteCreditGrant, evaluateRemoteHopCreditTransfer,
  REMOTE_CATALOGUE_RECORD_MAX_BYTES, REMOTE_CREDIT_MAX_BYTES, REMOTE_CREDIT_MAX_RECORDS,
  REMOTE_TERMINAL_CHUNK_MAX_RAW_BYTES, type RemoteCreditGrant, type RemoteCreditLedgerState,
} from '../../src/remote/credit-baseline.js';

const makeLedgerState = (overrides: Partial<RemoteCreditLedgerState> = {}): RemoteCreditLedgerState => ({
  hopId: 'browser-sock-1', direction: 'app-to-browser', ch: 1, linkGeneration: 1, creditRevision: 1,
  receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 8, sendLimitBytes: 131072,
  recordEnds: [[0, 0], [8, 60000]], opened: true, ...overrides,
});

const makeGrant = (overrides: Partial<RemoteCreditGrant> = {}): RemoteCreditGrant => ({
  hopId: 'browser-sock-1', direction: 'app-to-browser', ch: 1, linkGeneration: 1, creditRevision: 2,
  receivedThroughSeq: 8, receivedThroughBytes: 60000, sendLimitSeq: 16, sendLimitBytes: 191072, ...overrides,
});

describe('RM-0 (d) credit proof: relay evaluator reuse and Remote two-node window', () => {
  it('pins Remote trunk credit bounds directly to the session relay evaluator constants', () => {
    expect(REMOTE_CREDIT_MAX_RECORDS).toBe(RELAY_LINK_MAX_FRAMES);
    expect(REMOTE_CREDIT_MAX_RECORDS).toBe(8);
    expect(REMOTE_CREDIT_MAX_BYTES).toBe(RELAY_LINK_MAX_PAYLOAD_BYTES);
    expect(REMOTE_CREDIT_MAX_BYTES).toBe(131072);
    expect(REMOTE_CREDIT_MAX_RECORDS * REMOTE_CATALOGUE_RECORD_MAX_BYTES).toBeLessThanOrEqual(REMOTE_CREDIT_MAX_BYTES);
    expect(REMOTE_CREDIT_MAX_RECORDS * REMOTE_TERMINAL_CHUNK_MAX_RAW_BYTES).toBe(REMOTE_CREDIT_MAX_BYTES);
  });

  it('delegates credit grant validation to chainCreditCheck across allow, backpressure, duplicate, and conflict cases', () => {
    const state = makeLedgerState();
    expect(evaluateRemoteCreditGrant(makeGrant(), state)).toBe('allow');
    expect(evaluateRemoteCreditGrant(makeGrant({ sendLimitSeq: 17 }), state)).toBe('relay_backpressure');
    expect(evaluateRemoteCreditGrant(makeGrant({ sendLimitBytes: 191073 }), state)).toBe('relay_backpressure');
    expect(evaluateRemoteCreditGrant(makeGrant({ creditRevision: 1, receivedThroughSeq: 0, receivedThroughBytes: 0, sendLimitSeq: 8, sendLimitBytes: 131072 }), state)).toBe('duplicate-no-grant');
    expect(evaluateRemoteCreditGrant(makeGrant({ sendLimitSeq: 7 }), state)).toBe('relay_frame_conflict');
    expect(evaluateRemoteCreditGrant(makeGrant({ receivedThroughBytes: 59999 }), state)).toBe('relay_frame_conflict');
    expect(evaluateRemoteCreditGrant(makeGrant({ hopId: 'other-socket' }), state)).toBe('relay_frame_conflict');
    expect(evaluateRemoteCreditGrant(makeGrant(), makeLedgerState({ opened: false }))).toBe('relay_protocol_refused');
  });

  it('delegates independent two-hop accounting to chainCreditTransfer and refuses copied downstream credit', () => {
    const upstream = makeGrant({ hopId: 'trunk-node-a', direction: 'node-to-app', creditRevision: 1, receivedThroughSeq: 4, receivedThroughBytes: 32768, sendLimitSeq: 8, sendLimitBytes: 131072 });
    const downstream = makeGrant({ hopId: 'browser-sock-1', direction: 'app-to-browser', creditRevision: 1, receivedThroughSeq: 2, receivedThroughBytes: 16384, sendLimitSeq: 8, sendLimitBytes: 131072 });
    const downstreamReceipt = makeGrant({ hopId: 'browser-sock-1', direction: 'app-to-browser', creditRevision: 2, receivedThroughSeq: 4, receivedThroughBytes: 32768, sendLimitSeq: 12, sendLimitBytes: 163840 });
    const base = {
      upstream, downstream, queueBefore: 16384, reservedBefore: 16384, queueAfter: 0, reservedAfter: 32768,
      totalBefore: 32768, totalAfter: 32768, upstreamNewCapacity: 0, reservedAfterReceipt: 16384,
    };

    expect(evaluateRemoteHopCreditTransfer({ ...base, downstreamReceiptValidated: true, copiedDownstreamCredit: false, downstreamReceipt })).toBe('independent-credit-and-transfer-model');
    expect(evaluateRemoteHopCreditTransfer({ ...base, downstreamReceiptValidated: false, copiedDownstreamCredit: true })).toBe('relay_frame_conflict');
  });

  it('exhausts 8 channel-1 records with Node A (7 parts + end), blocks Node B at zero credit, and emits Node B at catSeq=9', () => {
    const window = createRemoteChannelCreditWindow({
      hopId: 'browser-sock-1', direction: 'app-to-browser', ch: 1, linkGeneration: 1,
      maxRecordBytes: REMOTE_CATALOGUE_RECORD_MAX_BYTES,
    });

    const nodeASeqs: number[] = [];
    for (let part = 0; part < 7; part += 1) {
      const res = window.send('node-A', 7936);
      expect(res).toMatchObject({ ok: true, nodeId: 'node-A' });
      if (res.ok) nodeASeqs.push(res.seq);
    }
    const ackBytes = 7 * 7936 + 256;
    expect(window.send('node-A', 256)).toEqual({ ok: true, nodeId: 'node-A', seq: 8, cumulativeBytes: ackBytes });
    expect(nodeASeqs).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(window.send('node-B', 512)).toEqual({ ok: false, reason: 'credit_exhausted' });

    expect(window.applyCredit({
      hopId: 'browser-sock-1', direction: 'app-to-browser', ch: 1, linkGeneration: 1, creditRevision: 2,
      receivedThroughSeq: 8, receivedThroughBytes: ackBytes, sendLimitSeq: 16, sendLimitBytes: ackBytes + REMOTE_CREDIT_MAX_BYTES,
    })).toBe('allow');
    expect(window.send('node-B', 512)).toEqual({ ok: true, nodeId: 'node-B', seq: 9, cumulativeBytes: ackBytes + 512 });
  });

  it('enforces the terminal raw-byte ceiling before reaching 8 records and resumes at the next ordinal', () => {
    const window = createRemoteChannelCreditWindow({
      hopId: 'browser-sock-1', direction: 'app-to-browser', ch: 2, linkGeneration: 1,
      initialLimitBytes: 32768, maxRecordBytes: REMOTE_TERMINAL_CHUNK_MAX_RAW_BYTES,
    });

    expect(window.send('node-A', 16384)).toEqual({ ok: true, nodeId: 'node-A', seq: 1, cumulativeBytes: 16384 });
    expect(window.send('node-A', 16384)).toEqual({ ok: true, nodeId: 'node-A', seq: 2, cumulativeBytes: 32768 });
    expect(window.send('node-A', 1)).toEqual({ ok: false, reason: 'credit_exhausted' });
    expect(window.applyCredit({
      hopId: 'browser-sock-1', direction: 'app-to-browser', ch: 2, linkGeneration: 1, creditRevision: 2,
      receivedThroughSeq: 2, receivedThroughBytes: 32768, sendLimitSeq: 10, sendLimitBytes: 32768 + REMOTE_CREDIT_MAX_BYTES,
    })).toBe('allow');
    expect(window.send('node-A', 16384)).toEqual({ ok: true, nodeId: 'node-A', seq: 3, cumulativeBytes: 49152 });
  });

  it('rejects non-monotonic credit acks, invalid channel/window bounds, bad nodeIds, and keeps recordEnds bounded', () => {
    const advancedState = makeLedgerState({
      creditRevision: 2, receivedThroughSeq: 6, receivedThroughBytes: 6000, sendLimitSeq: 10, sendLimitBytes: 131072,
      recordEnds: [[0, 0], [2, 2000], [6, 6000]],
    });
    expect(evaluateRemoteCreditGrant(makeGrant({
      creditRevision: 3, receivedThroughSeq: 2, receivedThroughBytes: 2000, sendLimitSeq: 10, sendLimitBytes: 131072,
    }), advancedState)).toBe('relay_frame_conflict');
    expect(evaluateRemoteCreditGrant(makeGrant({
      creditRevision: 3, receivedThroughSeq: 6, receivedThroughBytes: 5999, sendLimitSeq: 10, sendLimitBytes: 131072,
    }), advancedState)).toBe('relay_frame_conflict');
    expect(evaluateRemoteCreditGrant(makeGrant({
      creditRevision: 3, receivedThroughSeq: 6, receivedThroughBytes: 6000, sendLimitSeq: 5, sendLimitBytes: 131072,
    }), advancedState)).toBe('relay_frame_conflict');
    expect(evaluateRemoteCreditGrant(makeGrant({
      creditRevision: 3, receivedThroughSeq: 6, receivedThroughBytes: 6000, sendLimitSeq: 10, sendLimitBytes: 5999,
    }), advancedState)).toBe('relay_frame_conflict');

    const base = { hopId: 'browser-sock-1', direction: 'app-to-browser' as const, ch: 1, linkGeneration: 1, maxRecordBytes: 8192 };
    expect(() => createRemoteChannelCreditWindow({ ...base, ch: 0 })).toThrow(RangeError);
    expect(() => createRemoteChannelCreditWindow({ ...base, linkGeneration: 0 })).toThrow(RangeError);
    expect(() => createRemoteChannelCreditWindow({ ...base, maxRecordBytes: 0 })).toThrow(RangeError);
    expect(() => createRemoteChannelCreditWindow({ ...base, initialLimitRecords: REMOTE_CREDIT_MAX_RECORDS + 1 })).toThrow(RangeError);
    expect(() => createRemoteChannelCreditWindow({ ...base, initialLimitBytes: REMOTE_CREDIT_MAX_BYTES + 1 })).toThrow(RangeError);

    const window = createRemoteChannelCreditWindow(base);
    expect(window.send('', 1000)).toEqual({ ok: false, reason: 'invalid_node_id' });
    expect(window.send('n'.repeat(37), 1000)).toEqual({ ok: false, reason: 'invalid_node_id' });
    expect(window.send('nœud-1', 1000)).toEqual({ ok: false, reason: 'invalid_node_id' });

    for (let i = 0; i < 6; i += 1) expect(window.send('node-A', 1000)).toMatchObject({ ok: true, seq: i + 1 });
    expect(window.applyCredit({
      hopId: 'browser-sock-1', direction: 'app-to-browser', ch: 1, linkGeneration: 1, creditRevision: 2,
      receivedThroughSeq: 6, receivedThroughBytes: 6000, sendLimitSeq: 10, sendLimitBytes: 131072,
    })).toBe('allow');
    expect(window.applyCredit({
      hopId: 'browser-sock-1', direction: 'app-to-browser', ch: 1, linkGeneration: 1, creditRevision: 3,
      receivedThroughSeq: 2, receivedThroughBytes: 2000, sendLimitSeq: 10, sendLimitBytes: 131072,
    })).toBe('relay_frame_conflict');

    let rev = 2;
    let seq = 6;
    let bytes = 6000;
    for (let cycle = 0; cycle < 30; cycle += 1) {
      for (let i = 0; i < 4; i += 1) {
        seq += 1;
        bytes += 1000;
        expect(window.send('node-A', 1000)).toEqual({ ok: true, nodeId: 'node-A', seq, cumulativeBytes: bytes });
      }
      rev += 1;
      expect(window.applyCredit({
        hopId: 'browser-sock-1', direction: 'app-to-browser', ch: 1, linkGeneration: 1, creditRevision: rev,
        receivedThroughSeq: seq, receivedThroughBytes: bytes,
        sendLimitSeq: seq + REMOTE_CREDIT_MAX_RECORDS, sendLimitBytes: bytes + REMOTE_CREDIT_MAX_BYTES,
      })).toBe('allow');
      expect(window.retainedBoundaryCount()).toBeLessThanOrEqual(REMOTE_CREDIT_MAX_RECORDS + 1);
    }
  });
});
