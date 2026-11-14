import ivm from 'isolated-vm';
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { fixture } from './fixtures.mjs';

const bootstrap = readFileSync('/tools/spike/bootstrap.js', 'utf8');
const stages = {
  parse: 'spike.compiler.parse(source)',
  script: 'spike.compiler.compileScript(spike.compiler.parse(source).descriptor,{id:"spike"})',
  template: 'spike.compiler.compileTemplate({source:template,id:"spike",filename:"View.vue",vapor:true})',
  style: 'spike.compiler.compileStyle({source:style,id:"spike",filename:"View.vue",scoped:true})',
  typescript: 'spike.transform(script,{transforms:["typescript"]})',
};
const results = {};
for (const [stage, call] of Object.entries(stages)) {
  const samples = [];
  for (let index = 0; index < 20; index++) {
    const isolate = new ivm.Isolate({ memoryLimit: 256 });
    const context = await isolate.createContext();
    await context.eval(bootstrap);
    await context.eval(`globalThis.source=${JSON.stringify(fixture('L'))};
      globalThis.template=spike.compiler.parse(source).descriptor.template.content;
      globalThis.style=spike.compiler.parse(source).descriptor.styles[0].content;
      globalThis.script=spike.compiler.parse(source).descriptor.scriptSetup.content;`);
    const pending = context.eval(`for(let i=0;i<100000;i++){${call}}`, { timeout: 5000 });
    // Repeated real calls keep the named stage busy until disposal. This is
    // feasibility evidence, not a whole-request deadline or signal-adapter test.
    const observed = pending.then(() => 'completed', error => String(error));
    await new Promise(resolve => setTimeout(resolve, 10));
    const start = performance.now();
    isolate.dispose();
    const outcome = await observed;
    samples.push(performance.now() - start);
    assert.match(outcome, /disposed/i, `${stage}: ${outcome}`);
  }
  samples.sort((a, b) => a - b);
  results[stage] = { N: samples.length, p50: samples[9], p95: samples[18], max: samples[19],
    clock: 'performance.now; dispose called through promise rejection observed', samples };
}
writeFileSync('/tools/spike/cancel.json', JSON.stringify(results));
console.log(JSON.stringify(results));
