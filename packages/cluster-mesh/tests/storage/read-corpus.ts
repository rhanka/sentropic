// Shared read corpus (L3a v4.1 frozen §8): immutable boundaries without
// clock-only expiry, stable exact heads, page bounds and explicit
// unavailability. Backend-agnostic: cursors are opaque values minted by the
// backend and never inspected or forged here; every refusal asserts a typed
// code or page outcome, never a reference message (§5.2).
// Cursor integrity binding (module/scope/incarnation/selection binding,
// tampered-position and cross-chain reuse, clock-advance stability) is K3
// token semantics and is not covered here: only malformed cursors are
// rejected at this layer, retained heads bound the traversal.

import assert from 'node:assert/strict';
import { expectCode, type Awaitable } from './atomic-corpus.js';

export type ReadCursor = unknown;

export interface ReadCorpusRecord {
  readonly id: string;
  readonly seq: number;
  readonly hash: string;
  readonly bytes: string;
}

export interface ReadCorpusStore {
  appendChain(chainId: string, record: { readonly id: string; readonly bytes: string; readonly hash: string }, expectation: { readonly kind: 'absent'; readonly allocation: string } | { readonly kind: 'head'; readonly hash: string }): Awaitable<{ readonly seq: number; readonly hash: string; readonly replayed: boolean }>;
  readPage(chainId: string, limit: number, cursor: ReadCursor, maxEncodedBytes: number): Awaitable<{ readonly outcome: 'page' | 'incomplete' | 'inaccessible'; readonly records: readonly ReadCorpusRecord[]; readonly nextCursor: ReadCursor }>;
  disposeChain(chainId: string): Awaitable<void>;
}

const hashes = (records: readonly ReadCorpusRecord[]): readonly string[] => records.map((entry) => entry.hash);

export const runReadCorpus = async (bound: ReadCorpusStore): Promise<void> => {
  for (let n = 1; n <= 5; n += 1) {
    await bound.appendChain(
      'readable',
      { id: `e${n}`, bytes: `{"n":${n}}`, hash: `hash-e-${n}` },
      n === 1 ? { kind: 'absent', allocation: '0' } : { kind: 'head', hash: `hash-e-${n - 1}` },
    );
  }
  await bound.appendChain('unrelated', { id: 'u1', bytes: '{}', hash: 'hash-u-1' }, { kind: 'absent', allocation: '0' });

  const first = await bound.readPage('readable', 2, null, 4096);
  assert.equal(first.outcome, 'page');
  assert.deepEqual(hashes(first.records), ['hash-e-1', 'hash-e-2']);

  const second = await bound.readPage('readable', 2, first.nextCursor, 4096);
  assert.equal(second.outcome, 'page');
  assert.deepEqual(hashes(second.records), ['hash-e-3', 'hash-e-4']);

  const stable = await bound.readPage('readable', 2, null, 4096);
  assert.deepEqual(
    hashes(stable.records),
    hashes(first.records),
    'K2a-RED reads: unrelated writes do not move an exact-head cursor',
  );

  const window = await bound.readPage('readable', 4, null, 4096);
  assert.deepEqual(hashes(window.records), ['hash-e-1', 'hash-e-2', 'hash-e-3', 'hash-e-4']);

  await bound.appendChain('readable', { id: 'e6', bytes: '{"n":6}', hash: 'hash-e-6' }, { kind: 'head', hash: 'hash-e-5' });
  const continued = await bound.readPage('readable', 10, second.nextCursor, 4096);
  assert.deepEqual(
    hashes(continued.records),
    ['hash-e-5'],
    'K2aC-RED reads: a retained head boundary never picks up later appends',
  );

  const tail = await bound.readPage('readable', 10, window.nextCursor, 4096);
  assert.deepEqual(
    hashes(tail.records),
    ['hash-e-5'],
    'K2aR3-RED reads: a retained window boundary still ends at its own head',
  );
  const exhausted = await bound.readPage('readable', 10, null, 1);
  assert.equal(exhausted.outcome, 'incomplete');

  await bound.appendChain('tiny', { id: 't1', bytes: 'x', hash: 'hash-t-1' }, { kind: 'absent', allocation: '0' });
  const encodedTiny = await bound.readPage('tiny', 10, null, 2);
  assert.equal(encodedTiny.outcome, 'incomplete');
  assert.equal(encodedTiny.records.length, 0);

  const envelope = await bound.readPage('tiny', 10, null, 49);
  assert.equal(
    envelope.outcome,
    'incomplete',
    'K2aR3-RED reads: the budget covers the full encoded page, not the record alone',
  );
  assert.equal(envelope.records.length, 0);

  await bound.appendChain('heavy', { id: 'big', bytes: `{"pad":"${'x'.repeat(200)}"}`, hash: 'hash-big-1' }, { kind: 'absent', allocation: '0' });
  const over = await bound.readPage('heavy', 10, null, 16);
  assert.equal(over.outcome, 'incomplete');
  assert.equal(over.records.length, 0);

  await expectCode(
    async () => bound.readPage('readable', 2, 'forged-cursor', 4096),
    'invalid-command',
    'K2aR3-RED reads: a forged cursor is explicitly rejected',
  );

  await bound.appendChain('doomed-read', { id: 'd1', bytes: '{}', hash: 'hash-d-1' }, { kind: 'absent', allocation: '0' });
  await bound.appendChain('doomed-read', { id: 'd2', bytes: '{}', hash: 'hash-d-2' }, { kind: 'head', hash: 'hash-d-1' });
  const acquired = await bound.readPage('doomed-read', 1, null, 4096);
  assert.equal(acquired.outcome, 'page');
  assert.equal(acquired.records.length, 1);
  assert.notEqual(
    acquired.nextCursor,
    null,
    'K2aR3-RED reads: the first page retains a boundary for recovery',
  );
  await bound.disposeChain('doomed-read');
  const unavailable = await bound.readPage('doomed-read', 1, acquired.nextCursor, 4096);
  assert.equal(unavailable.outcome, 'inaccessible');
  assert.equal(unavailable.records.length, 0);

  const fresh = await bound.readPage('doomed-read', 1, null, 4096);
  assert.equal(fresh.outcome, 'inaccessible');
  assert.equal(fresh.records.length, 0);

  const missing = await bound.readPage('no-such-chain', 10, null, 4096);
  assert.equal(missing.outcome, 'page');
  assert.equal(missing.records.length, 0);
  assert.equal(missing.nextCursor, null);
};

// R3 remainder (§8.4, L3a v4.1 frozen): the returned cursor is part of the
// encoded page, so admission is measured with the effective returned cursor.
// Backend-agnostic: only backend-minted cursors are passed back; budgets are
// derived from the observed encoding (measure E with a large budget, then
// require E-1 to refuse and E to admit), never from hardcoded byte counts.
export const runReadCursorBudgetCorpus = async (bound: ReadCorpusStore): Promise<void> => {
  const chainId = 'r3-cursor-budget';
  for (let n = 0; n <= 10; n += 1) {
    await bound.appendChain(
      chainId,
      { id: `r${n}`, bytes: 'x', hash: `h${n}` },
      n === 0 ? { kind: 'absent', allocation: '0' } : { kind: 'head', hash: `h${n - 1}` },
    );
  }

  const first = await bound.readPage(chainId, 9, null, 4096);
  assert.equal(first.outcome, 'page');
  assert.equal(first.records.length, 9);
  assert.notEqual(first.nextCursor, null);

  const probe = await bound.readPage(chainId, 1, first.nextCursor, 4096);
  assert.equal(probe.outcome, 'page');
  assert.equal(probe.records.length, 1);
  assert.equal(probe.records[0].id, 'r9');
  const exact = Buffer.byteLength(
    JSON.stringify({ outcome: probe.outcome, records: probe.records, nextCursor: probe.nextCursor }),
    'utf8',
  );
  assert.ok(exact > 0);

  const tight = await bound.readPage(chainId, 1, first.nextCursor, exact - 1);
  assert.equal(
    tight.outcome,
    'incomplete',
    'K2b-RED reads: one byte under the observed encoding refuses the page',
  );
  assert.equal(tight.records.length, 0);
  assert.equal(
    tight.nextCursor,
    null,
    'K2b-RED reads: an empty incomplete page carries no retained cursor',
  );

  const resumed = await bound.readPage(chainId, 1, first.nextCursor, exact);
  assert.equal(resumed.outcome, 'page');
  assert.equal(resumed.records.length, 1);
  assert.equal(resumed.records[0].id, 'r9');
  const encodedBytes = Buffer.byteLength(
    JSON.stringify({ outcome: resumed.outcome, records: resumed.records, nextCursor: resumed.nextCursor }),
    'utf8',
  );
  assert.ok(
    encodedBytes <= exact,
    `K2b-RED reads: the resumed page with its returned cursor fits the observed budget (got ${encodedBytes} bytes for ${exact})`,
  );

  const tail = await bound.readPage(chainId, 2, resumed.nextCursor, 4096);
  assert.equal(tail.outcome, 'page');
  assert.deepEqual(
    tail.records.map((entry) => entry.id),
    ['r10'],
  );
  assert.equal(tail.nextCursor, null);

  await runReadResumeCorpus(bound);
};

// MAJ-1 (§8.4): a resume cursor never skips records. Sweep every budget
// from the observed full-page encoding down to the floor, paginating to
// exhaustion from each truncated first page and asserting the exact full
// record set with no gap and no duplicate. The same sweep runs with
// limit 10 (byte-trim path) and limits 1-2 (limit-reached path,
// reference-store.ts:235-237). Backend-agnostic: budgets derive from the
// observed encoding; only backend-minted cursors flow back; a byte-truncated
// page carrying records may be `page` with a continuation or `incomplete`
// (§8.4 reserves `incomplete` for the indivisible case, so both shapes are
// accepted here). A resume step that delivers no new record with an
// identical continuation fails as no-progress rather than as a record-set
// mismatch.
export const runReadResumeCorpus = async (bound: ReadCorpusStore): Promise<void> => {
  const chainId = 'r3-resume';
  const ids = ['s0', 's1', 's2'];
  for (let n = 0; n < ids.length; n += 1) {
    await bound.appendChain(
      chainId,
      { id: ids[n], bytes: 'x', hash: `hs${n}` },
      n === 0 ? { kind: 'absent', allocation: '0' } : { kind: 'head', hash: `hs${n - 1}` },
    );
  }
  const full = await bound.readPage(chainId, 10, null, 4096);
  assert.equal(full.outcome, 'page');
  assert.equal(full.records.length, 3);
  const fullBytes = Buffer.byteLength(
    JSON.stringify({ outcome: full.outcome, records: full.records, nextCursor: full.nextCursor }),
    'utf8',
  );
  for (const limit of [10, 2, 1]) {
    for (let budget = fullBytes - 1; budget > 0; budget -= 1) {
      const first = await bound.readPage(chainId, limit, null, budget);
      assert.ok(
        first.outcome === 'page' || first.outcome === 'incomplete',
        `K2b-RED reads: budget ${budget} limit ${limit} yields a typed page`,
      );
      if (first.records.length === 0) {
        assert.equal(
          first.outcome,
          'incomplete',
          `K2b-RED reads: budget ${budget} limit ${limit} with no records is incomplete`,
        );
        assert.equal(
          first.nextCursor,
          null,
          'K2b-RED reads: an empty incomplete page carries no retained cursor',
        );
        continue;
      }
      if (first.records.length >= 3) continue;
      assert.ok(first.records.length === 1 || first.records.length === 2);
      assert.ok(first.outcome === 'page' || first.outcome === 'incomplete');
      assert.notEqual(first.nextCursor, null);
      const collected: string[] = first.records.map((entry) => entry.id);
      let cursor: ReadCursor = first.nextCursor;
      let guard = 0;
      let prevCursor = JSON.stringify(cursor);
      let prevCount = collected.length;
      while (cursor !== null && guard < 10) {
        guard += 1;
        const page = await bound.readPage(chainId, limit, cursor, budget);
        assert.ok(page.outcome === 'page' || page.outcome === 'incomplete');
        const cursorJson = JSON.stringify(page.nextCursor);
        if (page.records.length === 0 && cursorJson === prevCursor) {
          assert.fail('K2b-RED reads: resume makes no progress (empty page with identical cursor)');
        }
        for (const entry of page.records) collected.push(entry.id);
        if (collected.length === prevCount && cursorJson === prevCursor) {
          assert.fail('K2b-RED reads: resume makes no progress (no new records and identical cursor)');
        }
        prevCursor = cursorJson;
        prevCount = collected.length;
        cursor = page.nextCursor;
        if (page.outcome === 'page' && page.nextCursor === null) break;
        if (page.outcome === 'incomplete' && page.nextCursor === null && page.records.length === 0) break;
      }
      assert.deepEqual(
        collected,
        ids,
        'K2b-RED reads: resuming from an incomplete page delivers the exact full record set with no gap and no duplicate',
      );
    }
  }
};
