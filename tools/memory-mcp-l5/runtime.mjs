import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkNodeFloor } from './receipt.mjs';

export function checkQualificationRuntime(runtime, frozenImage) {
  const failures = [];
  if (runtime.imageDigest !== frozenImage || !/@sha256:[0-9a-f]{64}$/.test(frozenImage)) failures.push('runtime: image differs from the frozen digest');
  if (!/^24\.\d+\.\d+$/.test(runtime.nodeVersion) || !checkNodeFloor(runtime.nodeVersion, runtime.execArgv, runtime.nodeOptions)) failures.push('runtime: unflagged qualified Node 24 required');
  if (!Array.isArray(runtime.execArgv) || runtime.execArgv.length || runtime.nodeOptions !== '') failures.push('runtime: qualification must run without Node flags');
  return failures;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const freeze = JSON.parse(readFileSync('spec/evidence/memory-mcp-l5/l0-freeze.json'));
  const runtime = { imageDigest: process.env.MEMORY_L5_IMAGE, nodeVersion: process.versions.node,
    execArgv: process.execArgv, nodeOptions: process.env.NODE_OPTIONS ?? '' };
  const failures = checkQualificationRuntime(runtime, freeze.imageDigest);
  if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
  else console.log(JSON.stringify(runtime));
}
