import { describe, expect, it } from 'vitest';
import { memoryJcs } from '../../src/engram-memory/codec.js';
import { captureProofToKernel, captureProofToWire, createMemoryNeutralTransaction, journalBytesWithIntentHash, memoryCommitIndexKey, neutralQueryResult, neutralUnitToPg, stripJournalIntentHash, translateMemoryAggregateRead, translateMemoryUpdateWrite, type MemoryKernelTransactionPort } from '../../src/engram-memory/wire-adaptation.js';
import type { NeutralAtomicUnit } from '../../src/engram-memory/neutral-contract.js';
import { validateAdmissionTransition, validateCaptureTransition } from '../../src/engram-memory/validation.js';

const captureKey = JSON.stringify(['memory-capture-idempotency-v1', 'cand-1']);
const outcomeKey = JSON.stringify(['memory-admission-outcome-v1', 'cand-1']);
const snakeCapture = { candidate_id: 'cand-1', content: 'body', cursor: '7',
  receipt_digest: 'sha256:receipt', extension: { text: 'é𐐀', values: [null, false, 0] } };
const snakeDone = { ...snakeCapture, record_digest: 'sha256:digest' };
const kernelDone = { candidateId: 'cand-1', revision: 2, recordDigest: 'sha256:digest', createdCursor: '7', proof: snakeCapture };
const unit = (over: Partial<NeutralAtomicUnit> = {}): NeutralAtomicUnit => ({ intentHash: 'producer-intent', guards: [], records: [], appends: [], updates: [], relationships: [], barriers: [], purgeIntents: [], indexWrites: [], ...over });

describe('memory K7/K8 wire adaptation', () => {
  it.each([
    [captureKey, { content: 'body', cursor: '7' }],
    [captureKey, { ...snakeCapture, candidate_id: '' }],
    [captureKey, { ...snakeCapture, cursor: 7 }],
    [captureKey, { candidate_id: 'cand-1', cursor: '7' }],
    [captureKey, { ...snakeCapture, record_digest: 7 }],
    [outcomeKey, { candidate_id: 'cand-1' }],
    [outcomeKey, { candidate_id: 7, status: 'accepted' }],
    [captureKey, []], [captureKey, null],
  ])('should refuse malformed wire proof %s %j', (key, proof) => {
    expect(() => translateMemoryUpdateWrite({ kind: 'proof', key, value: memoryJcs(proof), version: '1' }))
      .toThrow(expect.objectContaining({ code: 'invalid-command' }));
  });
  it.each([
    [captureKey, { candidateId: 'cand-1', revision: 1, recordDigest: null, createdCursor: '7' }],
    [outcomeKey, { candidateId: 'cand-1', outcome: 'accepted' }],
    [captureKey, []], [outcomeKey, null],
  ])('should refuse malformed stored proof %s %j in both directions', (key, proof) => {
    const value = memoryJcs(proof);
    expect(() => translateMemoryAggregateRead(key, value))
      .toThrow(expect.objectContaining({ code: 'invalid-command' }));
    expect(() => translateMemoryUpdateWrite({ kind: 'proof', key, value, version: '1' }))
      .toThrow(expect.objectContaining({ code: 'invalid-command' }));
  });
  it('should satisfy the installed K7 creation/completion and K8 transition validators', () => {
    const created = captureProofToKernel(snakeCapture);
    expect(validateCaptureTransition(null, created)).toMatchObject({ ok: true });
    expect(validateCaptureTransition(created, captureProofToKernel(snakeDone))).toMatchObject({ ok: true });
    const outcome = translateMemoryUpdateWrite({ kind: 'outcome', key: outcomeKey, version: '1',
      value: memoryJcs({ candidate_id: 'cand-1', status: 'accepted' }) });
    expect(validateAdmissionTransition(null, JSON.parse(outcome.value.data))).toMatchObject({ ok: true });
  });
  it('translates a created capture proof to the kernel model and back', () => {
    expect(captureProofToKernel(snakeCapture)).toEqual({
      candidateId: 'cand-1', revision: 1, recordDigest: null, createdCursor: '7',
      proof: snakeCapture,
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
  it.each([
    [captureKey, snakeCapture, { ...kernelDone, revision: 1, recordDigest: null }],
    [captureKey, snakeDone, kernelDone],
    [outcomeKey, { candidate_id: 'cand-1', status: 'accepted', extra: 'é𐐀' },
      { candidateId: 'cand-1', outcome: 'accepted', proof: { candidate_id: 'cand-1', status: 'accepted', extra: 'é𐐀' } }],
  ])('should preserve canonical UTF-8 bytes in both directions for %s %j', (key, proof, expectedKernel) => {
    const wire = memoryJcs(proof);
    const row = { kind: 'proof', key, value: wire, version: '1' };
    const kernel = translateMemoryUpdateWrite(row);
    const kernelBytes = memoryJcs(expectedKernel);
    expect(Buffer.from(kernel.value.data, 'utf8')).toEqual(Buffer.from(kernelBytes.data, 'utf8'));
    const read = translateMemoryAggregateRead(key, kernelBytes);
    expect(Buffer.from(read.data, 'utf8')).toEqual(Buffer.from(wire.data, 'utf8'));
    const rewritten = translateMemoryUpdateWrite({ ...row, value: read });
    expect(Buffer.from(rewritten.value.data, 'utf8')).toEqual(Buffer.from(kernelBytes.data, 'utf8'));
  });
  it('leaves foreign keys and already-translated values unchanged', () => {
    const foreign = { kind: 'x', key: '["other-v1","cand-1"]', value: memoryJcs(snakeCapture), version: '1' };
    expect(translateMemoryUpdateWrite(foreign)).toBe(foreign);
    const camel = { kind: 'capture', key: captureKey, value: memoryJcs(kernelDone), version: '2' };
    expect(translateMemoryUpdateWrite(camel)).toBe(camel);
    expect(translateMemoryAggregateRead('["other-v1","cand-1"]', memoryJcs(snakeCapture)))
      .toEqual(memoryJcs(snakeCapture));
  });
  it('carries the journal intent hash in stored bytes and strips it on read', () => {
    const carried = journalBytesWithIntentHash('{"event_digest":"sha256:ev","event_id":"e1"}', 'hash-1');
    expect(JSON.parse(carried)).toEqual({ event_digest: 'sha256:ev', event_id: 'e1', intent_hash: 'sha256:ev' });
    expect(JSON.parse(journalBytesWithIntentHash('{"event_id":"e1"}', 'hash-1')).intent_hash).toBe('hash-1');
    const existing = '{"event_id":"e1","intent_hash":"sha256:kept"}';
    expect(journalBytesWithIntentHash(existing, 'hash-1')).toBe(existing);
    expect(JSON.parse(stripJournalIntentHash(carried))).toEqual({ event_digest: 'sha256:ev', event_id: 'e1' });
  });
  it.each([
    [{ event_id: 'e1', event_digest: 'sha256:ev', extra: 'é𐐀' }, 'sha256:ev'],
    [{ event_id: 'e2', extra: [null, false, 0] }, 'fallback'],
  ])('should preserve canonical journal UTF-8 bytes through add/strip both ways (%j)', (event, intentHash) => {
    const wire = memoryJcs(event).data;
    const stored = memoryJcs({ ...event, intent_hash: intentHash }).data;
    const carried = journalBytesWithIntentHash(wire, 'fallback');
    expect(Buffer.from(carried, 'utf8')).toEqual(Buffer.from(stored, 'utf8'));
    expect(Buffer.from(stripJournalIntentHash(carried), 'utf8')).toEqual(Buffer.from(wire, 'utf8'));
    const stripped = stripJournalIntentHash(stored);
    expect(Buffer.from(journalBytesWithIntentHash(stripped, 'fallback'), 'utf8')).toEqual(Buffer.from(stored, 'utf8'));
    expect(Buffer.from(journalBytesWithIntentHash(stored, 'ignored'), 'utf8')).toEqual(Buffer.from(stored, 'utf8'));
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
  it('should accept the canonical lexical tombstone when a record leaves accepted-current', () => {
    const key = JSON.stringify(['memory-lexical-v1', 'scope-memory', 'record-memory']);
    const accepted = neutralUnitToPg(unit({ indexWrites: [
      { index: 'memory-accepted-lexical', key, value: memoryJcs({ record_digest: 'sha256:record' }) },
    ] }));
    const removal = unit({ indexWrites: [{ index: 'memory-accepted-lexical', key, value: memoryJcs(null) }] });
    const pg = neutralUnitToPg(removal, new Map([[key, accepted.indexWrites[0]!.digest]]));
    expect(pg.indexWrites).toEqual([{ key, digest: 'sha256:record',
      resultIds: [], resultHash: 'null' }]);
    expect(pg.indexWrites[0]!.digest).toBe(accepted.indexWrites[0]!.digest);
    expect(accepted.indexWrites[0]!.resultHash).toBe(memoryJcs({ record_digest: 'sha256:record' }).data);
    expect(() => neutralUnitToPg(removal)).toThrow('lexical removal requires the existing index identity');
  });
  it.each([
    ['memory-accepted-lexical', '[]'], ['memory-accepted-lexical', 'false'],
    ['memory-accepted-lexical', '"null"'], ['another-index', 'null'],
  ])('should refuse non-object index bytes outside the lexical tombstone (%s, %s)', (index, data) => {
    expect(() => neutralUnitToPg(unit({ indexWrites: [
      { index, key: 'key', value: { format: 'utf8', data } },
    ] }))).toThrow(expect.objectContaining({ code: 'invalid-command' }));
  });
  it('maps guards and shapes named query results', () => {
    const pg = neutralUnitToPg(unit({ guards: [
      { kind: 'aggregate-version', aggregateKey: 'k', version: '3' },
      { kind: 'chain-head', chain: 'memory-journal', hash: 'h' },
      { kind: 'chain-absent', chain: 'memory-journal' },
    ] }));
    expect(pg.guards).toEqual([
      { kind: 'aggregate-version', key: 'k', version: '3' },
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
  it('should read capture bytes from that row alone without consulting control', async () => {
    const { tx } = fakeTx();
    const keys: string[] = [];
    const read = tx.readAggregate;
    tx.readAggregate = async (key) => { keys.push(key); return read(key); };
    const result = await createMemoryNeutralTransaction(tx).readAggregate('capture', captureKey);
    expect(Buffer.from(result!.value.data)).toEqual(Buffer.from(memoryJcs(snakeDone).data));
    expect(keys).toEqual([captureKey]);
  });
  it('should refuse binary aggregate and record bytes at the UTF-8 memory boundary', async () => {
    const value = { format: 'base64' as const, data: 'e30=' };
    expect(() => translateMemoryAggregateRead(captureKey, value))
      .toThrow(expect.objectContaining({ code: 'invalid-command' }));
    const { tx } = fakeTx();
    tx.readRecords = async () => [{ key: 'r1', bytes: value, contentHash: 'h1' }];
    await expect(createMemoryNeutralTransaction(tx).readRecords('record', ['r1']))
      .rejects.toMatchObject({ code: 'invalid-command' });
  });
  it('reads capture receipts from their row and chains without intent hashes', async () => {
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
    const suppliedIntentHash = ' producer\u0000 e\u0301𐐀\n';
    await neutral.apply(unit({
      intentHash: suppliedIntentHash,
      updates: [{ kind: 'capture', key: captureKey, value: memoryJcs(snakeDone), version: '2' }],
      appends: [{ chain: 'memory-journal', kind: 'event', id: 'e1', hash: 'h1',
        value: memoryJcs({ event_id: 'e1', event_digest: 'sha256:ev' }),
        expectation: { kind: 'absent', allocation: '0' } }],
    }));
    const written = applied[0] as { updates: { value: { data: string } }[];
      appends: { record: { bytes: string } }[]; indexWrites: { key: string; digest: string; resultHash: string }[] };
    expect(JSON.parse(written.updates[0]!.value.data)).toEqual(kernelDone);
    expect(JSON.parse(written.appends[0]!.record.bytes).intent_hash).toBe('sha256:ev');
    expect(written.indexWrites.at(-1)!.key).toBe(memoryCommitIndexKey('commit-1'));
    const index = written.indexWrites.at(-1)!;
    expect(Buffer.from(index.digest)).toEqual(Buffer.from(suppliedIntentHash));
    tx.findIdempotency = async ({ key }) => key === index.key ? index : null;
    const replay = await neutral.findIdempotency({ commitIdentity: 'commit-1' });
    expect(replay!.intentHash).toBe(suppliedIntentHash);
    expect(units).toHaveLength(1);
  });
  it('should stop paging as soon as the requested records past the allocation are collected', async () => {
    const { tx } = fakeTx();
    let calls = 0;
    tx.readChain = async ({ cursor, limit }) => {
      calls++;
      expect(limit).toBe(1);
      const allocation = cursor === undefined ? '1' : '2';
      return { records: [{ id: `e${allocation}`, hash: 'h',
        bytes: JSON.stringify({ cursor: allocation, intent_hash: 'stored-only' }) }], nextCursor: allocation };
    };
    const page = await createMemoryNeutralTransaction(tx).readChain({ chain: 'memory-journal', afterAllocation: '1', limit: 1 });
    expect(page.records.map((row) => row.id)).toEqual(['e2']);
    expect(page.records[0]!.value.data).not.toContain('intent_hash');
    expect(calls).toBe(2);
  });
  it.each(['not-numeric', '01', '-1', '18446744073709551616', null])(
    'should refuse malformed stored chain cursor %j', async (cursor) => {
      const { tx } = fakeTx();
      tx.readChain = async () => ({ records: [{ id: 'e1', hash: 'h1', bytes: JSON.stringify({ cursor }) }] });
      await expect(createMemoryNeutralTransaction(tx).readChain({ chain: 'memory-journal', afterAllocation: '7', limit: 1 }))
        .rejects.toMatchObject({ code: 'invalid-command' });
    });
  it.each([{ afterAllocation: 'bad', limit: 1 }, { limit: 0 }, { limit: -1 }, { limit: 2001 }, { limit: 1.5 }])(
    'should refuse an invalid chain read bound %j before kernel reads', async (bounds) => {
      const { tx } = fakeTx();
      tx.readChain = async () => { throw new Error('kernel must not be read'); };
      await expect(createMemoryNeutralTransaction(tx).readChain({ chain: 'memory-journal', ...bounds }))
        .rejects.toMatchObject({ code: 'invalid-command' });
    });
});
