import { isSea } from 'node:sea';

if (process.argv.includes('--self-test')) {
  if (!isSea()) throw new Error('single executable application required');
  console.log('execution-node.v1 SEA self-test passed');
} else {
  void import('./service.js').catch(error => { console.error(error); process.exitCode = 1; });
}
