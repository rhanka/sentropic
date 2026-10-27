/** Cross-process PG ownership: each child opens its own TCP connection and a
 * real opt-in kernel (same production code as in-process, see
 * `pg-open-child.mjs`). The PG lease row is the only arbiter; a claimed
 * lease survives the child exit. Takeover is deterministic: the parent
 * expires the lease with setup SQL (no timing, no sleeps). */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodePgText } from '../../src/storage/postgres/codec.js';
import { createPgFixture } from './pg-fixture.js';
import { pgEnabled } from './pg-driver.js';
const CHILD_TIMEOUT_MS = 15_000, EXIT_REFUSED = 3;
const CHILD_PATH = fileURLToPath(new URL('./pg-open-child.mjs', import.meta.url));
interface ChildArgs {
  pgEntry: string;
  connectionString: string;
  kernelUrl: string;
  schema: string;
  leaseMs: number;
}
interface ChildResult {
  ok: boolean;
  code?: string;
  epoch?: string;
  message?: string;
}
const runOpener = (args: ChildArgs): Promise<{ result: ChildResult; status: number | null }> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--experimental-transform-types', CHILD_PATH, JSON.stringify(args)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
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
type PgTestFixture = Awaited<ReturnType<typeof createPgFixture>>;
const openerArgs = (schema: string, leaseMs = 300_000): ChildArgs => ({
  pgEntry: createRequire(import.meta.url).resolve('pg'),
  connectionString: process.env.CM_PG_URL as string,
  kernelUrl: new URL('../../src/storage/postgres/index.ts', import.meta.url).href,
  schema,
  leaseMs,
});
// Deterministic expiry injection (test setup, like `seedExpired`): the lease
// row is replaced with a dead one, so the next opener takes over at once.
const expireLease = async (fixture: PgTestFixture, module: string): Promise<void> => {
  const current = await fixture.tx.run(true, (session) =>
    session.execute({
      text: `SELECT instance, epoch FROM "${fixture.name}".instance_ownership WHERE module=$1`,
      values: [module],
    }),
  );
  const row = current.rows[0];
  if (row === undefined) throw new Error(`no lease row to expire for module ${module}`);
  await fixture.tx.run(false, async (session) => {
    await session.execute({
      text: `DELETE FROM "${fixture.name}".instance_ownership WHERE module=$1`,
      values: [module],
    });
    await session.execute({
      text: `INSERT INTO "${fixture.name}".instance_ownership(module, instance, epoch, holder_until)
        VALUES($1, $2, $3, clock_timestamp() - make_interval(secs => 60))`,
      values: [module, decodePgText(row.instance), decodePgText(row.epoch)],
    });
  });
};
describe.skipIf(!pgEnabled)('postgres instance ownership across OS processes', () => {
  it('second OS process is refused while the first lease is live', async () => {
    const fixture = await createPgFixture();
    try {
      const args = openerArgs(fixture.name);
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
  it('takeover after injected expiry allocates the next epoch (crashed holder releases nothing)', async () => {
    const fixture = await createPgFixture();
    try {
      const args = openerArgs(fixture.name);
      const first = await runOpener(args);
      expect(first.result).toMatchObject({ ok: true, epoch: '1' });
      const blocked = await runOpener(args);
      expect(blocked.status).toBe(EXIT_REFUSED);
      expect(blocked.result.code).toBe('instance-busy');
      // Crash: the claimants already exited without release; expire the
      // lease deterministically instead of waiting out a short TTL.
      await expireLease(fixture, 'comments');
      const successor = await runOpener(args);
      expect(successor.status).toBe(0);
      expect(successor.result).toMatchObject({ ok: true, epoch: '2' });
    } finally {
      await fixture.close();
    }
  }, 60_000);
});
