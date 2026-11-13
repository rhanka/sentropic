import { isSea } from 'node:sea';
import { spawn } from 'node:child_process';
import { qualificationCrashWorker } from './qualification-crash.js';
import { qualifyDisk, quotaWriter } from './qualification.js';
import { qualifyIsolation } from './isolation-qualification.js';
import { qualifyDataPlane } from './data-plane-qualification.js';
import { acquireNodeLock } from './node-lock.js';
import { superviseQualification } from './qualification-supervisor.js';

if (process.argv.includes('--self-test')) {
  if (!isSea()) throw new Error('single executable application required');
  console.log('execution-node.v1 SEA self-test passed');
} else if (process.argv.includes('--qualify-crash-worker')) {
  void qualificationCrashWorker(process.argv[process.argv.indexOf('--qualify-crash-worker') + 1]!).catch(() => process.exit(1));
} else if (process.argv.includes('--qualify-data-plane-worker')) {
  void qualifyDataPlane().catch(() => { process.exit(1); });
} else if (process.argv.includes('--qualify-data-plane')) {
  void superviseQualification().catch(() => { console.error('FAIL step=supervisor data-plane qualification'); process.exitCode = 1; });
} else if (process.argv.includes('--qualify-isolation-worker')) {
  void qualifyIsolation().catch(() => { process.exitCode = 1; });
} else if (process.argv.includes('--qualify-isolation')) {
  void superviseQualification(undefined, () => spawn(process.execPath, ['--qualify-isolation-worker'], { stdio: 'inherit', detached: true }))
    .catch(() => { console.error('FAIL isolation qualification'); process.exitCode = 1; });
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
