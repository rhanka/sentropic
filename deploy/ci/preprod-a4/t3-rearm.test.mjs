import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rearm } from './t3-rearm.mjs';
import { saveState } from './t3-lib.mjs';
import { inputs } from './t3-preflight.test.mjs';

test('rearm archives custody before deletion and refreshes the private state directory', () => {
  const next = inputs(), stateDir = mkdtempSync(join(tmpdir(),'t3-rearm-'));
  saveState(stateDir,{ step: 'DONE', commitVerified: false, operationId: 'old' });
  const config = { ...next.config, request: { operationId: 'old' }, executionSha256: '0'.repeat(64),
    legacyImages: { api: 'legacy-api', 'auth-idp': 'legacy-idp', ui: 'legacy-ui' } };
  const calls = [];
  const archive = `${stateDir}-attempt-old`;
  const call = (args,input) => {
    calls.push(args.join(' '));
    if (args[0] === 'exec' && String(input).includes('journal_present')) return 'f|0';
    if (args[0] === 'exec' && args.includes('node')) {
      assert.ok(existsSync(join(archive,'custody.tar.gz')), 'archive exists before erasure');
      assert.match(readFileSync(join(archive,'custody.sha256'),'utf8'),/^[a-f0-9]{64}$/);
      return '';
    }
    if (args[0] === 'exec' && args.includes('sh')) return Buffer.from('synthetic-archive').toString('base64');
    if (args[0] === 'get' && args[1] === 'deployment') {
      const name = args[2];
      return JSON.stringify({ spec: { replicas: 1, template: { spec: {
        containers: [{ name, image: config.legacyImages[name] }] } } }, status: { readyReplicas: 1 } });
    }
    if (args[0] === 'get' && args[1] === 'jobs') return '{"items":[]}';
    return '';
  };
  const result = rearm({ config,stateDir,call },next.config,next.read);
  assert.equal(result.archive,archive);
  assert.ok(existsSync(join(archive,'operator-state','t3-window-state.json')));
  assert.ok(existsSync(stateDir));
  assert.ok(calls.some(c => c.startsWith('delete pod sentropic-a4-rearm')));
});
