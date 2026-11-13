import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseRunscList } from './runsc-inventory.js';

type InventoryCommand = (command: string, args: string[]) => string;
const host: InventoryCommand = (command, args) => execFileSync(command, args, { encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL' });

/** Full adoption is S1-A1b; S1 must never reset reservations over surviving resources. */
export function assertCleanStartup(root = '/var/lib/builder', run: InventoryCommand = host,
  mountInfoPath = '/proc/self/mountinfo'): void {
  const blocked = () => { throw new Error('startup blocked: surviving sandbox resources require operator reconciliation'); };
  if (run('systemctl', ['list-units', '--all', '--plain', '--no-legend', 'builder-sbx-*.scope']).trim()) blocked();
  const runtimes = parseRunscList(run('runsc', ['--root=/run/execution-node/runsc', 'list', '--format=json']));
  if (runtimes.length) blocked();
  for (const tenant of ['sentropic', 'immo']) {
    const sandboxes = join(root, 'tenants', tenant, 'sandboxes');
    try { if (readdirSync(sandboxes).length) blocked(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    for (const line of readFileSync(mountInfoPath, 'utf8').split('\n')) {
      const target = line.split(' ')[4]?.replace(/\\([0-7]{3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8)));
      if (target === sandboxes || target?.startsWith(`${sandboxes}/`)) blocked();
    }
  }
}
