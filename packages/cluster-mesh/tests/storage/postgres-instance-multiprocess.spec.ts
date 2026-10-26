/** Cross-process PG ownership: children open their own TCP connection and
 * replicate `acquirePgInstanceOwnership` in raw SQL; the lease row arbitrates. */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { createPgFixture } from './pg-fixture.js';
import { pgEnabled } from './pg-driver.js';
const CHILD_TIMEOUT_MS = 15_000, EXIT_REFUSED = 3;

interface ChildArgs {
  pgEntry: string;
  connectionString: string;
  schema: string;
  module: string;
  leaseSecs: number;
}
interface ChildResult {
  ok: boolean;
  code?: string;
  epoch?: string;
  holderUntil?: string;
}
const CHILD_SOURCE = `
  import { createRequire } from 'node:module';
  import { randomUUID } from 'node:crypto';
  const args = JSON.parse(process.argv[1]);
  const { Pool } = createRequire(args.pgEntry)(args.pgEntry);
  const pool = new Pool({ connectionString: args.connectionString, max: 1, connectionTimeoutMillis: 5000 });
  const state = (e) => (e && typeof e === 'object' ? (e.code ?? e.sqlState) : undefined);
  const raced = (e) => state(e) === '55P03' || state(e) === '40001' || state(e) === '40P01';
  const busy = (extra = {}) => ({ ok: false, code: 'instance-busy', ...extra });
  const report = (result, exit) => {
    process.stdout.write(JSON.stringify(result) + '\\n');
    pool.end().then(() => process.exit(exit), () => process.exit(exit));
  };
  (async () => {
    const client = await pool.connect();
    const rb = () => client.query('ROLLBACK').catch(() => undefined);
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE');
        let row = null;
        try {
          const selected = await client.query(
            'SELECT instance, epoch, holder_until, clock_timestamp() AS now FROM "' + args.schema + '".instance_ownership WHERE module=$1 FOR UPDATE',
            [args.module]);
          row = selected.rows[0] ?? null;
        } catch (error) {
          await rb();
          if (state(error) === '42P01') { report({ ok: false, code: 'open-refused' }, ${EXIT_REFUSED}); return; }
          if (raced(error)) { report(busy(), ${EXIT_REFUSED}); return; }
          throw error;
        }
        if (row !== null && new Date(row.holder_until).getTime() > new Date(row.now).getTime()) {
          await rb();
          report(busy({ epoch: String(row.epoch), holderUntil: new Date(row.holder_until).toISOString() }), ${EXIT_REFUSED});
          return;
        }
        const epoch = row === null ? '1' : (BigInt(row.epoch) + 1n).toString();
        const instance = row === null ? 'instance-' + randomUUID() : String(row.instance);
        try {
          const claimed = await client.query(
            row === null
              ? 'INSERT INTO "' + args.schema + '".instance_ownership(module, instance, epoch, holder_until) VALUES($1, $2, $3, clock_timestamp() + make_interval(secs => $4)) ON CONFLICT(module) DO NOTHING'
              : 'UPDATE "' + args.schema + '".instance_ownership SET instance=$2, epoch=$3, holder_until = clock_timestamp() + make_interval(secs => $4) WHERE module=$1',
            [args.module, instance, epoch, args.leaseSecs]);
          if (row === null && claimed.rowCount === 0) { await rb(); continue; }
          if (row !== null && claimed.rowCount !== 1) { await rb(); report(busy(), ${EXIT_REFUSED}); return; }
          await client.query('COMMIT');
          report({ ok: true, epoch }, 0);
          return;
        } catch (error) {
          await rb();
          if (raced(error)) { report(busy(), ${EXIT_REFUSED}); return; }
          throw error;
        }
      }
      report(busy(), ${EXIT_REFUSED});
    } catch (error) {
      report({ ok: false, code: 'error' }, 1);
    } finally {
      client.release();
    }
  })();
`;
const runOpener = (args: ChildArgs): Promise<{ result: ChildResult; status: number | null }> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath,
      ['--input-type=module', '-e', CHILD_SOURCE, JSON.stringify(args)],
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
  schema,
  module: 'comments',
  leaseSecs,
});
describe.skipIf(!pgEnabled)('postgres instance ownership across OS processes', () => {
  it('second OS process is refused while the first lease is live', async () => {
    const fixture = await createPgFixture();
    try {
      const args = openerArgs(fixture.name, 300);
      const first = await runOpener(args);
      expect(first.status).toBe(0);
      expect(first.result).toMatchObject({ ok: true, epoch: '1' });
      const second = await runOpener(args);

      expect(second.status).toBe(EXIT_REFUSED);
      expect(second.result.code).toBe('instance-busy');
      expect(second.result.holderUntil).toBeDefined();
      expect(second.result.epoch).toBe('1');
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
