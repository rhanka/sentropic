import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qualify } from './t3-qualify.mjs';
const config = { tier: 'restore',namespace: 'sentropic-restore-a4',qualificationStateDir: '/private/state',
  endpoints: { appMe: 'https://app.restore-a4.test/api/v1/auth/me',idpMe: 'https://auth.restore-a4.test/api/v1/auth/me' } };
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
