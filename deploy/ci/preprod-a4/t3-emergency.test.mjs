import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const script = new URL('./t3-emergency.sh', import.meta.url).pathname;
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 't3-emergency-'));
  const config = join(dir, 'config.json');
  writeFileSync(config, JSON.stringify({ kubeconfigFile: '/private/kube', namespace: 'sentropic-preprod' }));
  return { dir, config };
}

test('RUN6 emergency dry-run preserves live automation, state and recovery lock', () => {
  const { dir, config } = fixture();
  const child = spawn('sleep', ['30']);
  const state = join(dir, 't3-window-state.json');
  const bytes = JSON.stringify({ step: 'W3', driverPid: child.pid });
  writeFileSync(state, bytes);
  try {
    const out = spawnSync('sh', [script, '--state-dir', dir, '--config', config, '--dry-run'],
      { encoding: 'utf8', timeout: 15000 });
    assert.equal(out.status, 0, out.stderr);
    assert.doesNotThrow(() => process.kill(child.pid, 0), 'preview must leave driver alive');
    assert.equal(readFileSync(state, 'utf8'), bytes);
    assert.equal(existsSync(join(dir, 't3-recovering.lock')), false);
    assert.match(out.stdout, /dry-run/);
  } finally { child.kill('SIGKILL'); }
});

for (const code of [0, 6]) {
  test(`RUN6 emergency refuses locked classification with producer status ${code}`, () => {
    const { dir, config } = fixture();
    const marker = join(dir, 'dispatch');
    writeFileSync(join(dir, 'node'), `#!/bin/sh
case "$1" in
  *t3-emergency-classify.mjs) echo '{"committed":false,"locks":1}'; exit ${code} ;;
  *t3-rollback.mjs|*t3-finish-open.mjs) touch '${marker}'; exit 0 ;;
esac
exec '${process.execPath}' "$@"
`, { mode: 0o700 });
    const out = spawnSync('sh', [script, '--state-dir', dir, '--config', config],
      { env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, encoding: 'utf8', timeout: 15000 });
    assert.equal(existsSync(marker), false, out.stdout);
    assert.equal(out.status, 6, out.stderr);
  });
}
