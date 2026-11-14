import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { createIsolatedVmRuntime } from '../../src/sandbox/runtime.ts';

const require = createRequire(process.env.SPIKE_HOST_MANIFEST || '/tools/package.json');
const ivm = require('isolated-vm');
const bundle = readFileSync('/tools/spike/bootstrap.js', 'utf8');
const runtime = createIsolatedVmRuntime({ isolatedVmModule: ivm });
const records = [];
try {
for (const size of ['S', 'M', 'L']) {
  const { source } = JSON.parse(readFileSync(`/repo/packages/cluster-mesh/tests/compile-spike/fixtures/F-LIVE-${size}.json`, 'utf8'));
  const policy = { surface: [], timeoutMs: 5000, memoryMb: 256 };
  const skill = {
    metadata: { name: 'v8-spike', description: 'Pinned compiler probe', version: '1.0.0', category: 'test', sandbox: policy, toolNames: ['compile'] },
    tools: [], body: '', sandboxEntry: process.env.SPIKE_FORCE_FAILURE === '1'
      ? 'throw new Error("spike negative control");' : `${bundle}\nreturn spike.compile(input.source);`,
  };
  const start = performance.now();
  const result = await runtime.execute(skill, { source });
  const elapsed = performance.now() - start;
  const record = { size, N: 1, node: process.version, clock: 'performance.now monotonic milliseconds',
    p50: elapsed, p95: elapsed, wallMs: elapsed, ok: result.ok,
    ...(result.ok ? { outputBytes: JSON.stringify(result.output).length } : { errorCode: result.errorCode, errorMessage: result.errorMessage }) };
  records.push(record);
  console.log(JSON.stringify(record));
  if (!result.ok) process.exitCode = 1;
}
} finally {
  await runtime.dispose();
  writeFileSync(process.env.SPIKE_RECEIPT || '/tools/spike/adapter.json', JSON.stringify(records));
}
