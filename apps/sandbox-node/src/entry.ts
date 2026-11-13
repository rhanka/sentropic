import { isSea } from 'node:sea';
import { qualifyDisk, quotaWriter } from './qualification.js';
import { qualifyIsolation } from './isolation-qualification.js';
import { acquireNodeLock } from './node-lock.js';

if (process.argv.includes('--self-test')) {
  if (!isSea()) throw new Error('single executable application required');
  console.log('execution-node.v1 SEA self-test passed');
} else if (process.argv.includes('--qualify-isolation')) {
  void qualifyIsolation().catch(() => { console.error('FAIL isolation qualification'); process.exitCode = 1; });
} else if (process.argv.includes('--qualify-disk')) {
  qualifyDisk();
} else if (process.argv.includes('--quota-writer')) {
  quotaWriter();
} else {
  void acquireNodeLock().then(async release => {
    try { const { server } = await import('./service.js'); server.once('close', release); }
    catch (error) { release(); throw error; }
  }).catch(error => { console.error(error); process.exitCode = 1; });
}
