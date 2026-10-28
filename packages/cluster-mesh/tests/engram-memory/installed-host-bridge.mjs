// E10 host-authored bridge: retained consumer glue, not installed bytes.
// It adapts the installed cluster-mesh kernel transaction to the neutral
// handle shape that the installed Engram constructor consumes. The receipt
// records this file as hostGlue with status host-authored-not-installed.
export const createInstalledHostBridge = ({ meshMemory, hostDriver, schemaName, scope, binding, kernelRef }) => {
  const { memoryJcs } = meshMemory;
  const memoryFailure = (error) => {
    const source = error ?? {};
    const codes = { denied: 'unauthorized', 'invalid-command': 'invalid-schema', unavailable: 'store-unavailable',
      'capacity-exceeded': 'limit-exceeded', 'idempotency-conflict': 'digest-conflict',
      'instance-busy': 'fence-conflict', 'stale-epoch': 'fence-lost', 'terminal-loss': 'fence-lost' };
    throw Object.assign(new Error(source.message ?? String(error)), { code: codes[source.code ?? ''] ?? source.code });
  };
  const guarded = async (run) => { try { return await run(); } catch (error) { return memoryFailure(error); } };
  const commitIndexKey = (identity) => JSON.stringify(['memory-host-commit-v1', identity]);
  const isCaptureKey = (key) => key.startsWith('["memory-capture-idempotency-v1",');
  const isOutcomeKey = (key) => key.startsWith('["memory-admission-outcome-v1",');
  const translateUpdateWrite = (row) => {
    if (!isCaptureKey(row.key) && !isOutcomeKey(row.key)) return row;
    const entry = JSON.parse(row.value.data);
    if (isCaptureKey(row.key)) {
      if (typeof entry.candidateId === 'string') return row;
      return { ...row, value: memoryJcs({ candidateId: entry.candidate_id,
        revision: entry.record_digest ? 2 : 1, recordDigest: entry.record_digest ?? null,
        createdCursor: entry.cursor,
        proof: { candidate_id: entry.candidate_id, content: entry.content, cursor: entry.cursor } }) };
    }
    if (typeof entry.candidateId === 'string') return row;
    return { ...row, value: memoryJcs({ candidateId: entry.candidate_id, outcome: entry.status, proof: entry }) };
  };
  const translateAggregateRead = (key, value) => {
    if (!isCaptureKey(key) && !isOutcomeKey(key)) return value;
    const parsed = JSON.parse(value.data);
    if (isCaptureKey(key)) {
      if (typeof parsed.candidate_id === 'string') return value;
      return memoryJcs({ ...parsed.proof,
        ...(parsed.recordDigest ? { record_digest: parsed.recordDigest } : {}) });
    }
    if (typeof parsed.candidate_id === 'string') return value;
    return memoryJcs(parsed.proof);
  };
  const withCaptureReceipt = async (key, value, readControl) => {
    const translated = translateAggregateRead(key, value);
    if (!isCaptureKey(key)) return translated;
    const entry = JSON.parse(translated.data);
    if (typeof entry.receipt_digest === 'string') return translated;
    const candidateId = JSON.parse(key)[1];
    const control = await readControl(JSON.stringify(['memory-pending-control-v1', candidateId]));
    if (!control) return translated;
    const receiptDigest = JSON.parse(control.data ?? control.value?.data ?? '{}').capture_receipt_digest;
    return typeof receiptDigest === 'string' ? memoryJcs({ ...entry, receipt_digest: receiptDigest }) : translated;
  };
  const neutralUnitToPg = (unit) => {
    if (unit.relationships.length || unit.barriers.length || unit.purgeIntents.length)
      throw Object.assign(new Error('unsupported memory effects'), { code: 'invalid-schema' });
    return {
      guards: unit.guards.map((guard) => guard.kind === 'aggregate-version'
        ? { kind: 'aggregate-version', key: guard.aggregateKey, version: guard.version }
        : guard.kind === 'chain-head' ? { kind: 'head', chainId: guard.chain, hash: guard.hash }
          : { kind: 'absent', chainId: guard.chain }),
      records: unit.records.map((row) => ({ key: row.key, bytes: row.value, contentHash: row.contentHash })),
      appends: unit.appends.map((row) => {
        const event = JSON.parse(row.value.data);
        const bytes = typeof event.intent_hash === 'string' ? row.value.data
          : memoryJcs({ ...event, intent_hash: event.event_digest ?? row.hash }).data;
        return { chainId: row.chain, record: { id: row.id, hash: row.hash, bytes }, expectation: row.expectation };
      }),
      updates: unit.updates.map((row) => { const translated = translateUpdateWrite(row);
        return { key: translated.key, version: translated.version, value: translated.value }; }),
      indexWrites: unit.indexWrites.map((row) => ({ key: row.key,
        digest: JSON.parse(row.value.data).record_digest ?? row.value.data, resultIds: [], resultHash: null })),
      relationships: [], barriers: [], purgeIntents: [], moduleResult: unit.moduleResult,
    };
  };
  const neutralTransaction = (tx, units, identity) => ({
    readAggregate: async (kind, key) => {
      const found = await tx.readAggregate(key);
      if (found === null) return null;
      const value = await withCaptureReceipt(key, found.value, async (controlKey) => {
        const row = await tx.readAggregate(controlKey);
        return row?.value ?? null;
      });
      return { kind, key, version: String(found.version), value };
    },
    readRecords: async (kind, keys) => (await tx.readRecords(keys, { maxRecords: 2000, maxEncodedBytes: 1048576 }))
      .map((row) => ({ kind, key: row.key, value: row.bytes, contentHash: row.contentHash })),
    readChain: async ({ chain, afterAllocation = '0', limit }) => {
      const all = [];
      let cursor;
      for (;;) {
        const page = await tx.readChain({ chainId: chain, limit: 500, cursor, maxEncodedBytes: 1048576 });
        all.push(...page.records);
        if (!page.nextCursor || page.records.length === 0) break;
        cursor = page.nextCursor;
      }
      const after = BigInt(afterAllocation);
      const records = all
        .map((row) => {
          const event = JSON.parse(row.bytes);
          delete event.intent_hash;
          return { id: row.id, hash: row.hash, value: memoryJcs(event) };
        })
        .filter((row) => {
          try {
            const value = JSON.parse(row.value.data).cursor;
            return value === undefined || BigInt(value) > after;
          } catch { return true; }
        });
      return { chain, records: records.slice(0, limit) };
    },
    findIdempotency: async ({ commitIdentity }) => {
      const row = await tx.findIdempotency({ key: commitIndexKey(commitIdentity) });
      return row ? { key: commitIdentity, intentHash: row.digest, moduleResult: JSON.parse(row.resultHash) } : null;
    },
    apply: async (unit) => {
      const translated = neutralUnitToPg(unit);
      const appends = unit.appends.map((row) => row.id);
      const commitIndex = identity ? [{ key: commitIndexKey(identity),
        digest: memoryJcs({ appends, updates: [...appends, ...unit.updates.map((row) => row.key)] }).data,
        resultIds: [], resultHash: JSON.stringify(unit.moduleResult ?? memoryJcs(null)) }] : [];
      await tx.apply({ ...translated, indexWrites: [...translated.indexWrites, ...commitIndex] });
      units.push(structuredClone(unit));
    },
  });
  const neutralQueryResult = (name, records) => {
    if (name === 'scope-chain-index') {
      const row = records[0];
      return memoryJcs(row ? { chain: row.chainId, head: row.headHash, allocation: row.allocation }
        : { chain: 'memory-journal', head: `sha256:${'0'.repeat(64)}`, allocation: '0' });
    }
    if (name === 'memory-journal-page') return memoryJcs(records.map((event) => {
      const { intent_hash: _intentHash, ...rest } = event;
      return { id: event.event_id, hash: event.event_hash, value: memoryJcs(rest) };
    }));
    if (name === 'memory-record-by-id') return memoryJcs(records.length ? { found: true, value: memoryJcs(records[0]) } : { found: false });
    return memoryJcs(records);
  };
  let fence;
  let acquired = false;
  return { memoryFailure, guarded, neutralTransaction, neutralQueryResult, withCaptureReceipt,
    hostDriver, schemaName, scope, binding, kernelRef };
};
