import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import ivm from 'isolated-vm';
import { fixture, edits } from './fixtures.mjs';

const bootstrap = readFileSync('/tools/spike/bootstrap.js', 'utf8');
const results = { node: process.version, bootstrapBytes: Buffer.byteLength(bootstrap),
  bootstrapSha256: createHash('sha256').update(bootstrap).digest('hex'), checks: {} };
const isolate = new ivm.Isolate({ memoryLimit: 256 });
const context = await isolate.createContext();
await context.eval(bootstrap);
for (const size of ['S', 'M', 'L']) {
  const source = fixture(size);
  try {
    const output = await context.eval(`spike.compile(${JSON.stringify(source)})`, { copy: true, timeout: 5000 });
    assert.match(output.template, /vue/);
    results.checks[size] = { success: true, bytes: JSON.stringify(output).length };
    for (const [kind, edit] of Object.entries(edits)) {
      const next = await context.eval(`spike.compile(${JSON.stringify(edit(source))})`, { copy: true, timeout: 5000 });
      results.checks[`${size}/${kind}`] = Object.fromEntries(['script', 'template', 'styles'].map(key => [key,
        JSON.stringify(next[key]) !== JSON.stringify(output[key])]));
    }
  } catch (error) { results.checks[size] = { success: false, error: String(error) }; }
}
try {
  results.cssPass = await context.eval(`(() => {
    let visited = 0;
    const result = spike.compiler.compileStyle({source:'.a { color: red }', id:'x',
      postcssPlugins:[{postcssPlugin:'spike', Declaration(node) {visited++;node.value='blue'}}]});
    return {visited, code:result.code, errors:result.errors.map(String)};
  })()`, { copy: true });
} catch (error) { results.cssPass = { error: String(error) }; }
try {
  results.syntax = await context.eval(`spike.transform('import type { T } from "./types.js"; import v from "./v.json" assert {type:"json"}; const x:T = v;', {transforms:['typescript']})`, { copy: true });
} catch (error) { results.syntax = { error: String(error) }; }
results.nfc = await context.eval(`['e\\u0301','A\\u030a','\\u212b','\\u1100\\u1161'].map(s=>s.normalize('NFC'))`, { copy: true });
results.heap = isolate.getHeapStatisticsSync();
isolate.dispose();
writeFileSync('/tools/spike/compiler-probe.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
