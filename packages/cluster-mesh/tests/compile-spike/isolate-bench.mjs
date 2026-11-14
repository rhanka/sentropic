import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { fixture, edits } from './fixtures.mjs';

const require = createRequire(process.env.SPIKE_HOST_MANIFEST || '/workspace/package.json');
const ivm = require('isolated-vm');
const bootstrap = readFileSync(new URL('./bootstrap.js', import.meta.url), 'utf8');
const N = 200;
const stats = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return { N: sorted.length, p50: sorted[Math.ceil(sorted.length * .5) - 1],
    p95: sorted[Math.ceil(sorted.length * .95) - 1],
    p99: sorted[Math.ceil(sorted.length * .99) - 1], max: sorted.at(-1) };
};
const result = { node: process.version, v8: process.versions.v8, clock: 'performance.now monotonic milliseconds',
  cpuMax: readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim(),
  memoryMax: readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim(),
  rows: [], startedAt: new Date().toISOString() };
const make = async isolate => {
  const start = performance.now();
  const context = await isolate.createContext();
  await context.eval(bootstrap, { timeout: 5000 });
  await context.eval('globalThis.session = spike.createSession()');
  return { context, startup: performance.now() - start };
};
for (const size of ['S', 'M', 'L']) for (const kind of ['style', 'template', 'whole']) {
  const source = fixture(size), changed = edits[kind](source);
  for (const state of ['retained', 'fresh', 'cold']) {
    let isolate = new ivm.Isolate({ memoryLimit: 256 });
    let prepared = await make(isolate);
    const times = [], startups = [];
    for (let index = -20; index < N; index++) {
      const begin = performance.now();
      if (state !== 'retained') {
        prepared.context.release();
        if (state === 'cold') { isolate.dispose(); isolate = new ivm.Isolate({ memoryLimit: 256 }); }
        prepared = await make(isolate);
      }
      const text = index % 2 === 0 ? changed : source;
      const start = performance.now();
      await prepared.context.eval(`session.compile(${JSON.stringify(text)})`, { timeout: 5000, copy: true });
      const elapsed = performance.now() - start;
      if (index >= 0) { times.push(elapsed); if (state !== 'retained') startups.push(prepared.startup); }
      await new Promise(resolve => setTimeout(resolve, Math.max(0, 250 - (performance.now() - begin))));
    }
    if (state === 'retained') startups.push(prepared.startup);
    const row = { size, kind, state, compileMs: stats(times), bootstrapMs: stats(startups),
      heap: isolate.getHeapStatisticsSync(), rssBytes: process.memoryUsage().rss,
      samples: times };
    result.rows.push(row);
    writeFileSync(new URL('./isolate-results.json', import.meta.url), JSON.stringify(result));
    console.log(JSON.stringify({ ...row, samples: undefined }));
    isolate.dispose();
  }
}
