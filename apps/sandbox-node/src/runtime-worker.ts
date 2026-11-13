import { parentPort, workerData } from 'node:worker_threads';
import { RunscRuntimeAdapter } from './runtime-adapter.js';
import { useK8sPortsSwitch } from './network-policy.js';
import { forwardBudget } from './forward-budget.js';
import { forwardHelpers } from './port-forward.js';

if (!parentPort) throw new Error('runtime worker requires parent port');
if (workerData.production) useK8sPortsSwitch();
const runtime = new RunscRuntimeAdapter(workerData.binary, undefined,
  (stage, detail) => parentPort!.postMessage({ event: 'diagnostic', stage, detail }));
for (const options of workerData.recovery ?? []) runtime.recoverSandbox(options);
const methods = new Set(['runSandbox', 'assertRunning', 'portTarget', 'writeFile', 'stopSandbox', 'exportOutput', 'destroySandbox']);
parentPort.on('message', async ({ id, method, args }) => {
  try {
    if (method === 'forwardUsage') { parentPort!.postMessage({ id, result: { limit: forwardBudget.limit, inUse: forwardBudget.inUse, ...forwardHelpers } }); return; }
    if (!methods.has(method)) throw new Error('unknown runtime operation');
    if (method === 'runSandbox') args[0].onExit = (code: number | null) => parentPort!.postMessage({ event: 'exit', uid: args[0].sandboxUid, code });
    if (method === 'writeFile') args[2] = Buffer.from(args[2]);
    const result = await (runtime as any)[method](...args);
    parentPort!.postMessage({ id, result });
  } catch (error) {
    const e = error as Error & { code?: string; runtimeId?: string; retryAfterMs?: number; cleanupFailed?: boolean };
    parentPort!.postMessage({ id, error: { message: e.message, code: e.code, runtimeId: e.runtimeId,
      retryAfterMs: e.retryAfterMs, cleanupFailed: e.cleanupFailed } });
  }
});
