import { realpathSync } from 'node:fs';
import { runScheduledTaskByIdInternal } from '../../dist/runner.js';

const allowedScript = process.argv[2];
const taskId = process.argv[3];
if (!allowedScript || !taskId) {
  process.stderr.write('usage: ci-runner.mjs <allowedScript> <taskId>\n');
  process.exit(2);
}
const res = await runScheduledTaskByIdInternal(
  taskId,
  {
    allowedBins: [realpathSync(process.execPath)],
    allowedScripts: [realpathSync(allowedScript)],
  },
  { hostPidGuard: () => {} },
);
if (res.error) process.stderr.write(`[local-scheduler] ${res.error.code}: ${res.error.message}\n`);
process.exitCode = res.exitCode;
