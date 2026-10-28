// The fault-injection host is in memory; producer, adapter and hydration are installed bytes.
import assert from 'node:assert/strict';
import { createMemoryNeutralHandle, memoryJcs } from '@sentropic/cluster-mesh/engram-memory';
import { openModuleStorageCanonicalMemoryStoreV1 } from '@sentropic/engram/memory-substrate';

export async function installedHydrationRefusals({ grant, scopeBinding, now, deadline, digest }) {
  const results = [];
  const valueOf = (result) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
  for (const completed of [false, true]) {
    for (const fault of ['divergent-receipt', 'missing-receipt']) {
      const aggregates = new Map();
      const journal = [];
      const readAggregate = async (key) => aggregates.get(key) ?? null;
      const kernel = {
        ownership: { handle: { instanceId: 'installed-hydration', storageEpoch: '1' },
          verify: async () => undefined, release: async () => undefined },
        provisionFence: async () => undefined,
        bind: async () => ({ readAggregate, readCommitResult: async () => null,
          transact: async (_options, operation) => ({ value: await operation({
            readAggregate, readRecords: async () => [], readChain: async () => ({ records: journal }),
            findIdempotency: async () => null,
            apply: async (unit) => {
              for (const row of unit.updates) aggregates.set(row.key, structuredClone(row));
              for (const row of unit.appends) journal.push(structuredClone(row.record));
            },
          }), receipt: {} }),
          query: async (name, input) => {
            const events = journal.map((row) => JSON.parse(row.bytes));
            if (name === 'memory-journal-page') return {
              records: events.filter((event) => BigInt(event.cursor) > BigInt(input.after ?? '0')),
            };
            const last = events.at(-1);
            return { records: name === 'scope-chain-index' && last ? [{ chainId: 'memory-journal',
              headHash: journal.at(-1).hash, allocation: last.cursor }] : [] };
          },
        }),
      };
      const driver = { transaction: async (_options, operation) => operation({ execute: async ({ text }) => ({
        rows: text.startsWith('SELECT')
          ? [{ scope: JSON.stringify(scopeBinding.scope), store_id: scopeBinding.store_id }] : [],
      }) }) };
      const assembly = createMemoryNeutralHandle({ kernel, binding: { memoryGrant: grant }, driver,
        schemaName: 'installed_hydration' });
      const { handle } = assembly;
      const open = () => openModuleStorageCanonicalMemoryStoreV1({ handle, grant,
        scope_binding: scopeBinding, clock: { now: () => now }, deadline_at: deadline });
      try {
        const first = valueOf(await open());
        const receipt = valueOf(await first.commitPending({
          control: { candidate_id: 'candidate-1', envelope_digest: digest, state: 'pending', created_cursor: '0',
            policy_id: 'policy-installed', policy_version: '1', capture_content_digest: digest,
            capture_receipt_digest: digest },
          sealed: { candidate_id: 'candidate-1', envelope_ref: 'envelope-1', envelope_digest: digest,
            key_ref: 'key-1', ciphertext: 'ciphertext-1' },
          capture_event: { schema_version: 2, event_id: 'capture-1', cursor: '0', recorded_at: now,
            operation: 'capture', candidate_id: 'candidate-1', to_state: 'pending',
            authorization_receipt_digest: digest, previous_event_digest: digest, event_digest: digest },
        }));
        if (completed) valueOf(await first.recordCaptureIdempotency({
          candidate_id: 'candidate-1', record_digest: digest,
        }));
        valueOf(await first.close());
        const matching = valueOf(await open());
        valueOf(await matching.readiness());
        valueOf(await matching.close());
        const controlKey = JSON.stringify(['memory-pending-control-v1', 'candidate-1']);
        const controlBefore = aggregates.get(controlKey).value.data;
        assert.equal(JSON.parse(controlBefore).capture_receipt_digest, receipt.receipt_digest);
        const key = JSON.stringify(['memory-capture-idempotency-v1', 'candidate-1']);
        const found = await handle.readAggregate('memory-capture-idempotency', key, grant);
        const entry = JSON.parse(found.value.data);
        const divergent = `sha256:${'b'.repeat(64)}`;
        assert.notEqual(divergent, receipt.receipt_digest);
        delete entry.receipt_digest;
        if (fault === 'divergent-receipt') entry.receipt_digest = divergent;
        // Inject through the installed write translator, before its installed read translator.
        await handle.transact({ grant, limits: { maxAppends: 0, maxRecords: 1, maxEncodedBytes: 4096 } },
          (tx) => tx.apply({ guards: [], records: [], appends: [], relationships: [], barriers: [],
            purgeIntents: [], indexWrites: [], updates: [{ key, kind: found.kind,
              version: String(BigInt(found.version) + 1n), value: memoryJcs(entry) }] }));
        assert.equal(aggregates.get(controlKey).value.data, controlBefore);
        const direct = await handle.readAggregate('memory-capture-idempotency', key, grant);
        assert.deepEqual(Buffer.from(direct.value.data), Buffer.from(memoryJcs(entry).data));
        const transactional = await handle.transact({ grant,
          limits: { maxAppends: 0, maxRecords: 1, maxEncodedBytes: 4096 } },
        (tx) => tx.readAggregate('memory-capture-idempotency', key));
        assert.deepEqual(Buffer.from(transactional.value.value.data), Buffer.from(direct.value.data));
        const reopened = await open();
        assert.equal(reopened.ok, false, 'installed hydration must refuse the faulty K7');
        assert.equal(reopened.error.code, 'JOURNAL_CORRUPT');
        assert.equal(reopened.error.retryable, false);
        assert.match(reopened.error.message, /capture idempotency/);
        results.push({ completed, fault, positiveReopen: 'passed', entryReceipt: entry.receipt_digest ?? null,
          controlReceipt: receipt.receipt_digest, refusal: reopened.error });
      } finally {
        if (assembly.getFence()) await handle.releaseFence(assembly.getFence());
      }
    }
  }
  return { host: 'in-memory-fault-injection', cases: results };
}
