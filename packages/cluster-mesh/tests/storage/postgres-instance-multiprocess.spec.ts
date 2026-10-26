/** Cross-process PG ownership: each child opens its own TCP connection and a
 * real opt-in kernel (same production code as in-process). The PG lease row
 * is the only arbiter; a claimed lease survives the child exit. */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { createPgFixture } from './pg-fixture.js';
import { pgEnabled } from './pg-driver.js';
const CHILD_TIMEOUT_MS = 15_000, EXIT_REFUSED = 3;
interface ChildArgs {
  pgEntry: string;
  connectionString: string;
  kernelUrl: string;
  schema: string;
  leaseSecs: number;
}
interface ChildResult {
  ok: boolean;
  code?: string;
  epoch?: string;
  message?: string;
}
const CHILD_SOURCE = `
  import { registerHooks } from 'node:module';
  registerHooks({ resolve(specifier, context, next) {
    if (specifier.endsWith('.js')) { try { return next(specifier.slice(0, -3) + '.ts', context); } catch {} }
    return next(specifier, context);
  } });
  const args = JSON.parse(process.argv[1]);
  const { createRequire } = await import('node:module');
  const { Pool } = createRequire(args.pgEntry)(args.pgEntry);
  const { createPostgresKernel } = await import(args.kernelUrl);
  const pool = new Pool({ connectionString: args.connectionString, max: 8, connectionTimeoutMillis: 5000 });
  const driver = { transaction: async (options, operation) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE ' + (options.readOnly ? 'READ ONLY' : 'READ WRITE'));
      const results = [await operation({ execute: (s) => client.query(s.text, s.values) })];
      await client.query('COMMIT');
      return results[0];
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { client.release(); }
  } };
  const report = (result, exit) => {
    process.stdout.write(JSON.stringify(result) + '\\n');
    pool.end().then(() => process.exit(exit), () => process.exit(exit));
  };
  try {
    const kernel = await createPostgresKernel({
      moduleId: 'comments',
      driver,
      layout: { dataSchema: args.schema, projectionSchemas: { comments: args.schema }, outboxSchema: args.schema },
      history: {
        read: async (session) => (await session.execute({ text: 'SELECT receipt FROM "' + args.schema + '".host_history ORDER BY ordinal', values: [] })).rows.map((row) => row.receipt),
        complete: async (session, receipt) => { await session.execute({ text: 'INSERT INTO "' + args.schema + '".host_history VALUES((SELECT COALESCE(MAX(ordinal),0)+1 FROM "' + args.schema + '".host_history),$1::jsonb)', values: [JSON.stringify(receipt)] }); },
      },
      cursorSecret: 'qualification-host-secret',
      canonicalOwnership: { leaseMs: Math.round(args.leaseSecs * 1000) },
    });
    if (!kernel.ownership) throw new Error('opt-in kernel opened without ownership');
    report({ ok: true, epoch: kernel.ownership.handle.storageEpoch }, 0);
  } catch (error) { report({ ok: false, code: error?.code, message: String(error?.message ?? error).slice(0, 300) }, ${EXIT_REFUSED}); }
`;
const runOpener = (args: ChildArgs): Promise<{ result: ChildResult; status: number | null }> =>
  new Promise((resolve, reject) => {
    // Full type transformation (not strip-only): production sources use
    // parameter properties, which strip-only mode rejects.
    const child = spawn(process.execPath,
      ['--experimental-transform-types', '--input-type=module', '-e', CHILD_SOURCE, JSON.stringify(args)],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', stderr = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already exited */ }
      reject(new Error(`opener child timed out; stdout: ${output}; stderr: ${stderr}`));
    }, CHILD_TIMEOUT_MS);
    child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (status) => {
      clearTimeout(timer);
      const line = output.split('\n').find((candidate) => candidate.trim().length > 0);
      if (line === undefined) reject(new Error(`opener child produced no output (status ${status}); stderr: ${stderr}`));
      else resolve({ result: JSON.parse(line) as ChildResult, status });
    });
  });
const openerArgs = (schema: string, leaseSecs: number): ChildArgs => ({
  pgEntry: createRequire(import.meta.url).resolve('pg'),
  connectionString: process.env.CM_PG_URL as string,
  kernelUrl: new URL('../../src/storage/postgres/index.ts', import.meta.url).href,
  schema,
  leaseSecs,
});
describe.skipIf(!pgEnabled)('postgres instance ownership across OS processes', () => {
  it('second OS process is refused while the first lease is live', async () => {
    const fixture = await createPgFixture();
    try {
      const args = openerArgs(fixture.name, 300);
      const first = await runOpener(args);
      expect(`${first.status} ${first.result.message ?? ''}`).toBe('0 ');
      expect(first.result).toMatchObject({ ok: true, epoch: '1' });
      const second = await runOpener(args);
      expect(second.status).toBe(EXIT_REFUSED);
      expect(second.result.code).toBe('instance-busy');
    } finally {
      await fixture.close();
    }
  }, 60_000);
  it('takeover after lease expiry allocates the next epoch (crashed holder releases nothing)', async () => {
    const fixture = await createPgFixture();
    try {
      const args = openerArgs(fixture.name, 1.2);
      const first = await runOpener(args);
      expect(first.result).toMatchObject({ ok: true, epoch: '1' });
      const blocked = await runOpener(args);
      expect(blocked.status).toBe(EXIT_REFUSED);
      expect(blocked.result.code).toBe('instance-busy');
      await new Promise((resolve) => setTimeout(resolve, 2500));
      const successor = await runOpener(args);
      expect(successor.status).toBe(0);
      expect(successor.result).toMatchObject({ ok: true, epoch: '2' });
    } finally {
      await fixture.close();
    }
  }, 60_000);
});
