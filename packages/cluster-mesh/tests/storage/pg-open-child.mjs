/**
 * Child opener for the multiprocess ownership spec (plain Node, no vitest).
 *
 * Opens a real opt-in `createPostgresKernel` over its own TCP pool, through
 * the same `.js`→`.ts` resolve hook as the SQLite child spec. Run with
 * `--experimental-transform-types`: production sources use parameter
 * properties, which strip-only mode rejects.
 *
 * Usage: node --experimental-transform-types pg-open-child.mjs '<json args>'
 * Args: { pgEntry, connectionString, kernelUrl, schema, leaseMs }.
 * Prints one JSON line `{ ok, epoch? }` or `{ ok: false, code?, message? }`
 * and exits 0 on claim, 3 on refusal (paired with EXIT_REFUSED in the spec).
 */
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.endsWith('.js')) {
      try {
        return next(specifier.slice(0, -3) + '.ts', context);
      } catch {
        /* fall through to the default resolver */
      }
    }
    return next(specifier, context);
  },
});

const args = JSON.parse(process.argv[2]);
const { createRequire } = await import('node:module');
const { Pool } = createRequire(args.pgEntry)(args.pgEntry);
const { createPostgresKernel } = await import(args.kernelUrl);
const pool = new Pool({ connectionString: args.connectionString, max: 8, connectionTimeoutMillis: 5000 });
const driver = {
  transaction: async (options, operation) => {
    const client = await pool.connect();
    try {
      await client.query(
        `BEGIN ISOLATION LEVEL SERIALIZABLE ${options.readOnly ? 'READ ONLY' : 'READ WRITE'}`,
      );
      const outcome = await operation({ execute: (statement) => client.query(statement.text, statement.values) });
      await client.query('COMMIT');
      return outcome;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  },
};
const report = (result, exit) => {
  process.stdout.write(`${JSON.stringify(result)}\n`);
  pool.end().then(
    () => process.exit(exit),
    () => process.exit(exit),
  );
};

try {
  const kernel = await createPostgresKernel({
    moduleId: 'comments',
    driver,
    layout: { dataSchema: args.schema, projectionSchemas: { comments: args.schema }, outboxSchema: args.schema },
    history: {
      read: async (session) =>
        (
          await session.execute({
            text: `SELECT receipt FROM "${args.schema}".host_history ORDER BY ordinal`,
            values: [],
          })
        ).rows.map((row) => row.receipt),
      complete: async (session, receipt) => {
        await session.execute({
          text: `INSERT INTO "${args.schema}".host_history VALUES((SELECT COALESCE(MAX(ordinal),0)+1 FROM "${args.schema}".host_history),$1::jsonb)`,
          values: [JSON.stringify(receipt)],
        });
      },
    },
    cursorSecret: 'qualification-host-secret',
    canonicalOwnership: { leaseMs: args.leaseMs },
  });
  if (!kernel.ownership) throw new Error('opt-in kernel opened without ownership');
  report({ ok: true, epoch: kernel.ownership.handle.storageEpoch }, 0);
} catch (error) {
  report({ ok: false, code: error?.code, message: String(error?.message ?? error).slice(0, 300) }, 3);
}
