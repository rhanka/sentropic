// Offline selftest entrypoint for the email-code HMAC custody lane (method
// qk-secret-custody-r2 §7.3 K2/K3). No cluster, no gh, no network: stub
// binaries on PATH replace git/gh/kubectl. Run via:
//   make test-email-code-hmac-selftest ENV=test-email-code-hmac
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { TOOL_DIR } from './selftest-kit.mjs';
import { custodyTests } from './custody.selftest.mjs';
import { workflowTests } from './workflow.selftest.mjs';

let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log(`PASS: ${name}`); };

check('all lane modules pass node --check', () => {
  for (const file of readdirSync(TOOL_DIR).filter(f => f.endsWith('.mjs'))) {
    const r = spawnSync(process.execPath, ['--check', join(TOOL_DIR, file)], { encoding: 'utf8' });
    assert.equal(r.status, 0, `syntax: ${file}: ${r.stderr}`);
  }
});

custodyTests(check);
workflowTests(check);

console.log(`OK: ${passed} selftests passed`);
