import { spawn } from 'node:child_process';
import type { MemoryCampaignHost } from './memory-pg-host.js';

export const memoryPeer = (schema: string, mode: string) => new Promise<{ code: number | null; signal: string | null; output: string }>((resolve, reject) => {
  const child = spawn(process.execPath, ['--experimental-transform-types', new URL('./memory-process.mjs', import.meta.url).pathname, schema, mode],
    { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; let errors = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { errors += chunk; });
  child.on('error', reject);
  child.on('close', (code, signal) => code === 0 || code === 3 || signal === 'SIGKILL'
    ? resolve({ code, signal, output }) : reject(new Error(errors)));
});
export const awaitDeadLease = async (host: MemoryCampaignHost): Promise<void> => {
  const deadline = Date.now() + 2000;
  for (;;) {
    const row = await host.pg.tx.run(true, (session) => session.execute({ text:
      `SELECT holder_until <= clock_timestamp() AS expired FROM "${host.pg.name}".instance_ownership WHERE module='engram-memory'`, values: [] }));
    if (row.rows[0]?.expired === true) return;
    if (Date.now() >= deadline) throw new Error('killed peer lease did not expire');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};
