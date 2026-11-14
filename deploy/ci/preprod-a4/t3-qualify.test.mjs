import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qualify } from './t3-qualify.mjs';
import { witnessBinding } from './t3-applicability.mjs';
import { applicabilityFixture } from './t3-applicability.test.mjs';
const config = { tier: 'restore',namespace: 'sentropic-restore-a4',qualificationStateDir: '/private/state',
  endpoints: { appMe: 'https://app.restore-a4.test/api/v1/me',idpMe: 'https://auth.restore-a4.test/api/v1/auth/me' } };
config.postAuthWitnesses = ['app','idp'].map(name => ({ name,url: config.endpoints[`${name}Me`],
  cookieFile: `/private/${name}-cookie`,expectedUserId: 'qualified-user' }));
function dependencies(patch = {}) {
  const receipts = [];
  return { receipts,read: () => 'synthetic-cookie',now: () => 160000,
    state: () => ({ step: 'DONE',substate: 'TWO_HOSTS_OPEN',t0MonoMs: 0 }),
    probe: async (_url,options) => {
      assert.equal(options.headers.cookie,'synthetic-cookie');
      return Response.json({ user: { id: 'qualified-user' } });
    },write: (path,value) => receipts.push({ path,value }),...patch };
}
test('qualification records both authenticated identities and elapsed time, never a cookie', async () => {
  const d = dependencies(), receipt = await qualify('usable-auth',config,d);
  assert.equal(receipt.elapsedMs,160000); assert.equal(d.receipts.length,1);
  assert.doesNotMatch(JSON.stringify(receipt),/synthetic-cookie/);
});
for (const mode of ['unauthenticated','wrong-user','late','incomplete']) test(`qualification refuses ${mode} despite healthy endpoints`, async () => {
  const d = dependencies(mode === 'late' ? { now: () => 176000 }
    : mode === 'incomplete' ? { state: () => ({ step: 'W8',t0MonoMs: 0 }) }
    : { probe: async () => Response.json({ user: { id: 'wrong' } },{ status: mode === 'unauthenticated' ? 401 : 200 }) });
  await assert.rejects(qualify('usable-auth',config,d)); assert.equal(d.receipts.length,0);
});
test('qualification refuses a precommit recovery reaching authenticated service after 120 seconds', async () => {
  const d = dependencies({ now: () => 290000,
    state: () => ({ step: 'DONE',t0MonoMs: 0,recoveryReason: 'injected',commitVerified: false }) });
  await assert.rejects(qualify('usable-auth',{ ...config,qualificationFaultMonoMs: 170000 },d),/recovery_overrun/);
});
test('qualification refuses the former product /me URL, which answers 404 on the candidate', async () => {
  const former = structuredClone(config), d = dependencies();
  former.endpoints.appMe = former.postAuthWitnesses[0].url = 'https://app.restore-a4.test/api/v1/auth/me';
  await assert.rejects(qualify('usable-auth',former,d),/qualification_witness_binding/); assert.equal(d.receipts.length,0);
});
// Rehearsal r9: a legacy login can move the durable projection, so the witness login precedes the baseline.
test('baseline capture requires the live witness session first and binds the baseline to it', async () => {
  const witness = { url: 'https://app.restore-a4.test/api/v1/me',cookie: 'synthetic-witness' };
  const base = { tier: 'restore',namespace: 'sentropic-restore-a4',applicabilityBaselineFile: '/private/baseline',witness };
  const order = [], receipts = [];
  const deps = (status = 200) => ({ write: (path,value) => receipts.push({ path,value }),
    probe: async (url,options) => {
      order.push('witness'); assert.equal(url,witness.url);
      assert.equal(options.headers.cookie,witness.cookie); assert.equal(options.redirect,'error');
      return new Response('{}',{ status });
    },
    call: (_args,input) => { order.push('sql'); assert.match(input,/cutover-applicability-v1/); return JSON.stringify(applicabilityFixture()); } });
  await qualify('baseline',base,deps());
  assert.deepEqual(order,['witness','sql']);
  assert.equal(receipts[0].path,'/private/baseline');
  assert.equal(receipts[0].value.witnessSha256,witnessBinding(witness));
  assert.doesNotMatch(JSON.stringify(receipts),/synthetic-witness/);
  for (const [config,status,error] of [[base,401,/baseline_witness_not_authenticated/],
    [{ ...base,witness: undefined },200,/baseline_witness_missing/],
    [{ ...base,witness: { ...witness,url: 'https://sentropic.sent-tech.ca/api/v1/me' } },200,/baseline_witness_missing/]]) {
    order.length = 0; receipts.length = 0;
    await assert.rejects(qualify('baseline',config,deps(status)),error);
    assert.ok(!order.includes('sql')); assert.equal(receipts.length,0);
  }
});
