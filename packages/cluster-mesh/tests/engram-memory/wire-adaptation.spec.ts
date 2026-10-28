import { describe, expect, it } from 'vitest';
import { memoryJcs } from '../../src/engram-memory/codec.js';
import { captureProofToKernel, captureProofToWire, createMemoryNeutralTransaction, journalBytesWithIntentHash, memoryCommitIndexKey, neutralQueryResult, neutralUnitToPg, stripJournalIntentHash, translateMemoryAggregateRead, translateMemoryUpdateWrite, withMemoryCaptureReceipt, type MemoryKernelTransactionPort } from '../../src/engram-memory/wire-adaptation.js';
import type { NeutralAtomicUnit } from '../../src/engram-memory/neutral-contract.js';

const captureKey = JSON.stringify(['memory-capture-idempotency-v1', 'cand-1']);
const outcomeKey = JSON.stringify(['memory-admission-outcome-v1', 'cand-1']);
const snakeCapture = { candidate_id: 'cand-1', content: 'body', cursor: '7' };
const snakeDone = { ...snakeCapture, record_digest: 'sha256:digest' };
const kernelDone = { candidateId: 'cand-1', revision: 2, recordDigest: 'sha256:digest', createdCursor: '7', proof: { candidate_id: 'cand-1', content: 'body', cursor: '7' } };
const unit = (over: Partial<NeutralAtomicUnit> = {}): NeutralAtomicUnit => ({ guards: [], records: [], appends: [], updates: [], relationships: [], barriers: [], purgeIntents: [], indexWrites: [], ...over });

describe('memory K7/K8 wire adaptation', () => {
  it('translates a created capture proof to the kernel model and back', () => {
    expect(captureProofToKernel(snakeCapture)).toEqual({
      candidateId: 'cand-1', revision: 1, recordDigest: null, createdCursor: '7',
      proof: { candidate_id: 'cand-1', content: 'body', cursor: '7' },
    });
    const row = { kind: 'capture', key: captureKey, value: memoryJcs(snakeCapture), version: '1' };
    const written = translateMemoryUpdateWrite(row);
    expect(JSON.parse(written.value.data)).toEqual(captureProofToKernel(snakeCapture));
    expect(JSON.parse(translateMemoryAggregateRead(captureKey, written.value).data)).toEqual(snakeCapture);
  });
  it('translates a completed capture proof both ways with its record digest', () => {
    expect(captureProofToKernel(snakeDone).revision).toBe(2);
    expect(captureProofToWire(kernelDone)).toEqual(snakeDone);
    const row = { kind: 'capture', key: captureKey, value: memoryJcs(snakeDone), version: '2' };
    const written = translateMemoryUpdateWrite(row);
    expect(JSON.parse(translateMemoryAggregateRead(captureKey, written.value).data)).toEqual(snakeDone);
  });
  it('translates an admission outcome both ways through its proof', () => {
    const snakeOutcome = { candidate_id: 'cand-1', status: 'accepted', record_id: 'rec-1' };
    const row = { kind: 'outcome', key: outcomeKey, value: memoryJcs(snakeOutcome), version: '1' };
    const written = translateMemoryUpdateWrite(row);
    expect(JSON.parse(written.value.data))
      .toEqual({ candidateId: 'cand-1', outcome: 'accepted', proof: snakeOutcome });
    expect(JSON.parse(translateMemoryAggregateRead(outcomeKey, written.value).data)).toEqual(snakeOutcome);
  });
  it('leaves foreign keys and already-translated values unchanged', () => {
    const foreign = { kind: 'x', key: '["other-v1","cand-1"]', value: memoryJcs(snakeCapture), version: '1' };
    expect(translateMemoryUpdateWrite(foreign)).toBe(foreign);
    const camel = { kind: 'capture', key: captureKey, value: memoryJcs(kernelDone), version: '2' };
    expect(translateMemoryUpdateWrite(camel)).toBe(camel);
    expect(translateMemoryAggregateRead('["other-v1","cand-1"]', memoryJcs(snakeCapture)))
      .toEqual(memoryJcs(snakeCapture));
  });
  it('rejoins the capture receipt digest from the pending control only', async () => {
    const stored = memoryJcs({ candidateId: 'cand-1', revision: 1, recordDigest: null, createdCursor: '7', proof: { ...snakeCapture } });
    let calls = 0;
    const joined = await withMemoryCaptureReceipt(captureKey, stored, async () => {
      calls += 1; return memoryJcs({ capture_receipt_digest: 'sha256:receipt' });
    });
    expect(JSON.parse(joined.data)).toEqual({ ...snakeCapture, receipt_digest: 'sha256:receipt' });
    const absent = await withMemoryCaptureReceipt(captureKey, stored, async () => null);
    expect(JSON.parse(absent.data)).toEqual(snakeCapture);
    const present = await withMemoryCaptureReceipt(captureKey,
      memoryJcs({ candidateId: 'cand-1', revision: 1, recordDigest: null, createdCursor: '7',
        proof: { ...snakeCapture, receipt_digest: 'sha256:kept' } }),
      async () => { calls += 1; return memoryJcs({ capture_receipt_digest: 'sha256:other' }); });
    expect(JSON.parse(present.data).receipt_digest).toBe('sha256:kept');
    expect(calls).toBe(1);
  });
  it('carries the journal intent hash in stored bytes and strips it on read', () => {
    const carried = journalBytesWithIntentHash('{"event_digest":"sha256:ev","event_id":"e1"}', 'hash-1');
    expect(JSON.parse(carried)).toEqual({ event_digest: 'sha256:ev', event_id: 'e1', intent_hash: 'sha256:ev' });
    expect(JSON.parse(journalBytesWithIntentHash('{"event_id":"e1"}', 'hash-1')).intent_hash).toBe('hash-1');
    const existing = '{"event_id":"e1","intent_hash":"sha256:kept"}';
    expect(journalBytesWithIntentHash(existing, 'hash-1')).toBe(existing);
    expect(JSON.parse(stripJournalIntentHash(carried))).toEqual({ event_digest: 'sha256:ev', event_id: 'e1' });
  });
  it('refuses unsupported effects and non-JSON wire values', () => {
    expect(() => neutralUnitToPg(unit({ relationships: [{ kind: 'add' }] })))
      .toThrow(expect.objectContaining({ code: 'invalid-schema' }));
    expect(() => neutralUnitToPg(unit({
      indexWrites: [{ index: 'i', key: 'k', value: { format: 'utf8', data: 'not-json' } }],
    }))).toThrow(expect.objectContaining({ code: 'invalid-command' }));
    expect(() => translateMemoryUpdateWrite(
      { kind: 'capture', key: captureKey, value: { format: 'utf8', data: 'not-json' }, version: '1' }))
      .toThrow(expect.objectContaining({ code: 'invalid-command' }));
  });
  it('maps guards and shapes named query results', () => {
    const pg = neutralUnitToPg(unit({ guards: [
      { kind: 'aggregate-version', aggregateKey: 'k', version: '3' },
      { kind: 'chain-head', chain: 'memory-journal', hash: 'h' },
      { kind: 'chain-absent', chain: 'memory-journal' },
    ] }));
    expect(pg.guards).toEqual([
      { kind: 'aggregate-version', key: 'k', version: 3 },
      { kind: 'head', chainId: 'memory-journal', hash: 'h' },
      { kind: 'absent', chainId: 'memory-journal' },
    ]);
    expect(JSON.parse(neutralQueryResult('scope-chain-index', []).data))
      .toEqual({ chain: 'memory-journal', head: `sha256:${'0'.repeat(64)}`, allocation: '0' });
    expect(JSON.parse(neutralQueryResult('memory-journal-page',
      [{ event_id: 'e1', event_hash: 'h1', intent_hash: 'i1', cursor: '1' }]).data))
      .toEqual([{ id: 'e1', hash: 'h1', value: memoryJcs({ event_id: 'e1', event_hash: 'h1', cursor: '1' }) }]);
    expect(JSON.parse(neutralQueryResult('memory-record-by-id', []).data)).toEqual({ found: false });
  });
});

describe('memory neutral transaction', () => {
  const fakeTx = () => {
    const applied: unknown[] = [];
    const aggregates = new Map<string, { version: number; value: { format: 'utf8'; data: string } }>([[captureKey, { version: 2, value: memoryJcs(kernelDone) }], [JSON.stringify(['memory-pending-control-v1', 'cand-1']), { version: 1, value: memoryJcs({ capture_receipt_digest: 'sha256:receipt' }) }]]);
    const tx: MemoryKernelTransactionPort = {
      readAggregate: async (key) => aggregates.get(key) ?? null,
      readRecords: async (keys) => keys.map((key) => ({ key, bytes: memoryJcs({ key }), contentHash: 'h' })),
      readChain: async ({ cursor }) => cursor
        ? { records: [{ id: 'e2', hash: 'h2', bytes: '{"cursor":"2","event_id":"e2","intent_hash":"i2"}' }], nextCursor: null }
        : { records: [{ id: 'e1', hash: 'h1', bytes: '{"cursor":"1","event_id":"e1","intent_hash":"i1"}' }], nextCursor: 'next' },
      findIdempotency: async ({ key }) => key === memoryCommitIndexKey('commit-1')
        ? { digest: 'sha256:intent', resultHash: '{"format":"utf8","data":"{}"}' } : null,
      apply: async (appliedUnit) => { applied.push(appliedUnit); },
    };
    return { tx, applied };
  };
  it('reads aggregates with the receipt rejoined and chains without intent hashes', async () => {
    const { tx } = fakeTx();
    const neutral = createMemoryNeutralTransaction(tx, {});
    const read = await neutral.readAggregate('capture', captureKey);
    expect(JSON.parse(read!.value.data)).toEqual({ ...snakeDone, receipt_digest: 'sha256:receipt' });
    const page = await neutral.readChain({ chain: 'memory-journal', afterAllocation: '1', limit: 10 });
    expect(page.records.map((row) => row.id)).toEqual(['e2']);
    expect(page.records[0]!.value.data).not.toContain('intent_hash');
    expect(await neutral.findIdempotency({ commitIdentity: 'commit-1' }))
      .toEqual({ key: 'commit-1', intentHash: 'sha256:intent', moduleResult: { format: 'utf8', data: '{}' } });
    expect(await neutral.findIdempotency({ commitIdentity: 'absent' })).toBeNull();
  });
  it('applies translated units with the host commit index', async () => {
    const { tx, applied } = fakeTx();
    const units: NeutralAtomicUnit[] = [];
    const neutral = createMemoryNeutralTransaction(tx, { units, identity: 'commit-1' });
    await neutral.apply(unit({
      updates: [{ kind: 'capture', key: captureKey, value: memoryJcs(snakeDone), version: '2' }],
      appends: [{ chain: 'memory-journal', kind: 'event', id: 'e1', hash: 'h1',
        value: memoryJcs({ event_id: 'e1', event_digest: 'sha256:ev' }),
        expectation: { kind: 'absent', allocation: '0' } }],
    }));
    const written = applied[0] as { updates: { value: { data: string } }[];
      appends: { record: { bytes: string } }[]; indexWrites: { key: string }[] };
    expect(JSON.parse(written.updates[0]!.value.data)).toEqual(kernelDone);
    expect(JSON.parse(written.appends[0]!.record.bytes).intent_hash).toBe('sha256:ev');
    expect(written.indexWrites.at(-1)!.key).toBe(memoryCommitIndexKey('commit-1'));
    expect(units).toHaveLength(1);
  });
});
