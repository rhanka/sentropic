// Independent writer/recovery process: no Vitest state or in-process cache.
import { createPostgresKernel } from '../../src/storage/postgres/index.js';
import type { PgMigrationReceipt } from '../../src/storage/postgres/migrations.js';
import { createMemoryCommitResultRecovery } from '../../src/engram-memory/commit-result-recovery.js';
import { testPgDriver } from './pg-driver.js';
import { grantFor } from './authority-corpus.js';
import { emptyEffects } from '../../src/storage/staged-preparation.js';

const [name, phase] = process.argv.slice(2);
if (!name || !/^storage_[a-f0-9]+$/.test(name)) throw new Error('invalid fixture schema');
const connection = testPgDriver();
let armed = false;
try {
  const root = await createPostgresKernel({
    moduleId: 'comments', cursorSecret: 'qualification-host-secret',
    driver: { transaction: async (options, operation) => {
      const result = await connection.driver.transaction(options, operation);
      // The DB committed; the caller has never observed the receipt.
      if (armed && result && typeof result === 'object' && 'receipt' in result)
        process.kill(process.pid, 'SIGKILL');
      return result;
    } },
    layout: { dataSchema: name, projectionSchemas: { comments: name }, outboxSchema: name },
    history: {
      read: async (session) => (await session.execute({ text: `SELECT receipt FROM "${name}".host_history ORDER BY ordinal`, values: [] }))
        .rows.map((row) => row.receipt as PgMigrationReceipt),
      complete: async () => { throw new Error('recovery must not migrate'); },
    },
  });
  const grant = grantFor();
  const fence = { fenceId: 'recovery', epoch: phase === 'commit' ? '1' : '2' };
  const bound = phase === 'commit' ? await root.bindNew(grant) : await root.bind(grant);
  await root.provisionFence(grant, fence);
  if (phase === 'commit') {
    armed = true;
    await bound.commitAtomic({
      ...emptyEffects(), records: [{ key: 'original-record', contentHash: 'original-hash', bytes: { format: 'utf8', data: 'original' } }],
      moduleResult: { format: 'utf8', data: '{"receipt":"original","committed_at":"2026-10-23T12:34:56.789Z","storage_epoch":"1","value":"🌍"}' },
    }, { idempotencyKey: 'original-intent', fence });
    throw new Error('writer unexpectedly received ACK');
  }
  const recover = createMemoryCommitResultRecovery(bound, async () => fence);
  process.stdout.write(JSON.stringify({ result: await recover('original-intent'), epoch: fence.epoch }));
} finally { await connection.close(); }
