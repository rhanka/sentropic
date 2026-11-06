import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { execute } from './execution.mjs';
import { digest } from './guards.mjs';
import { approvedRequest, image } from './fixtures.mjs';

test('should follow numbered checkpoint steps with one waited custodian deletion before pinned API start', () => {
  const doc = readFileSync(new URL('../../../docs/runbooks/preprod-a4-cutover.md', import.meta.url), 'utf8');
  const step11 = doc.match(/^11\. (.+)$/m)?.[1], step12 = doc.match(/^12\. (.+)$/m)?.[1];
  assert(step11); assert(step12);
  assert.doesNotMatch(step11, /\bdelete\b|`delete-custodian`/i);
  const actions = [...`${step11}\n${step12}`.matchAll(/`(delete-custodian|start-api)`/g)].map(match => match[1]);
  assert.deepEqual(actions, ['delete-custodian', 'start-api']);
  const grant = { ...approvedRequest, format: 'preprod-a4-execution/1', actions: {
    'delete-custodian': [['delete', 'pod', 'sentropic-a4-custodian', '--wait=true', '--timeout=180s']],
    'start-api': [['set', 'image', 'deployment/api', `api=${image}`],
      ['scale', 'deployment/api', '--replicas=1'], ['rollout', 'status', 'deployment/api', '--timeout=180s']],
  } };
  const bytes = JSON.stringify(grant), calls = [];
  const env = { A4_KUBECONFIG_FILE: '/private/kube', A4_REQUEST_FILE: '/private/request',
    A4_EXECUTION_FILE: '/private/annex', A4_EXECUTION_SHA256: digest(bytes), A4_DRY_RUN: '0' };
  const read = path => path === env.A4_REQUEST_FILE ? JSON.stringify(approvedRequest)
    : path === env.A4_EXECUTION_FILE ? bytes : 'private';
  let deleted = false, pinnedImage, ready = false;
  for (const action of actions) execute({ ...env, A4_ACTION: action }, (_config, args) => {
    calls.push(args);
    if (args[0] === 'delete') {
      if (deleted) throw new Error('NotFound');
      assert.deepEqual(args, grant.actions['delete-custodian'][0]); deleted = true;
    } else {
      assert(deleted, 'custodian deletion must finish before API start');
      if (args[0] === 'set') pinnedImage = args[3];
      else if (args[0] === 'scale') assert.equal(pinnedImage, `api=${image}`);
      else if (args[0] === 'rollout') ready = true;
      else assert.fail('unexpected operation');
    }
    return 'suppressed';
  }, read);
  assert(ready); assert.equal(calls.filter(args => args[0] === 'delete').length, 1);
  assert.deepEqual(calls, [...grant.actions['delete-custodian'], ...grant.actions['start-api']]);
});
