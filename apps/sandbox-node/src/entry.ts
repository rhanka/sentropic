import { isSea } from 'node:sea';
import { qualifyDisk, quotaWriter } from './qualification.js';

if (process.argv.includes('--self-test')) {
  if (!isSea()) throw new Error('single executable application required');
  console.log('execution-node.v1 SEA self-test passed');
} else if (process.argv.includes('--qualify-disk')) {
  qualifyDisk();
} else if (process.argv.includes('--quota-writer')) {
  quotaWriter();
} else {
  void import('./service.js').catch(error => { console.error(error); process.exitCode = 1; });
}
