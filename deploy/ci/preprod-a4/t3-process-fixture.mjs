// Test-only hostile command: both generations survive SIGTERM.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
process.on('SIGTERM', () => {});
const dir = process.env.T3_PROCESS_TEST_DIR;
spawn(process.execPath, ['--input-type=module', '-e', `
  import { writeFileSync } from 'node:fs';
  process.on('SIGTERM', () => {});
  writeFileSync(${JSON.stringify(`${dir}/grandchild`)}, String(process.pid));
  setInterval(() => {}, 1000);
`], { stdio: 'ignore' });
writeFileSync(`${dir}/worker`, String(process.pid));
setInterval(() => {}, 1000);
