// Independent OS-process witness; only the public adapter and injected PG pool.
import { Pool } from 'pg';
import { createPostgresActivationStore } from '../../dist/adapters/postgres-activation.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const store = createPostgresActivationStore({ pool, namespace: process.env.ACTIVATION_NAMESPACE });
process.on('message', async ({ id, operation, payload }) => {
  try {
    if (operation === 'issue') {
      await store.tickets.put(payload.ticket);
      await store.flows.put(payload.flow);
      process.send({ id, result: true });
    } else {
      const result = await store.consume(payload, async () => {
        if (operation === 'crash-before-commit') process.exit(92);
        return true;
      });
      if (operation === 'crash-after-commit') process.exit(93);
      process.send({ id, result: result ?? null });
    }
  } catch {
    process.send({ id, error: 'activation worker failed' });
  }
});
process.on('disconnect', () => { void pool.end().then(() => process.exit(0)); });
process.send({ ready: true, pid: process.pid });
