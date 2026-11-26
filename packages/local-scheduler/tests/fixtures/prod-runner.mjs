import { realpathSync } from 'node:fs';
import { runScheduledTaskById } from '../../dist/runner-public.js';

const allowedScript = process.argv[2];
const taskId = process.argv[3];
if (!allowedScript || !taskId) {
  process.stderr.write('usage: prod-runner.mjs <allowedScript> <taskId>\n');
  process.exit(2);
}
const res = await runScheduledTaskById(taskId, {
  allowedBins: [realpathSync(process.execPath)],
  allowedScripts: [realpathSync(allowedScript)],
});
if (res.error) process.stderr.write(`[local-scheduler] ${res.error.code}: ${res.error.message}\n`);
process.exitCode = res.exitCode;
