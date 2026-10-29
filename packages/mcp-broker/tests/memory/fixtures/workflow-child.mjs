// Workflow-only crash probe. Installed E2/PG proof is separately manifest-gated.
import { SqliteMemoryWorkflowStoreV1 } from '../../../dist/memory-reference/index.js';
process.once('message', async ({ input, phase }) => {
  const store = await SqliteMemoryWorkflowStoreV1.open(process.argv[2]);
  try {
    store.putPolicy('admission', 'v1', { retention: 'original' });
    const row = store.reserve(input, true);
    if (phase !== 'reserved') store.claim(row.key, 'child', 1000, 30000, true);
    process.send(row);
  } catch (error) { process.send({ code: error.message }); store.close(); process.disconnect(); }
});
