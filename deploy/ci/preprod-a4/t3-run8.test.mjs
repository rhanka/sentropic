import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildProbes, validateProbes } from './t3-lib.mjs';
import { probeEndpoints } from './t3-probe-fixture.mjs';

test('RUN8 email probes satisfy the delivered JSON email input contract on both hosts', async () => {
  const config = { endpoints: probeEndpoints(), emailProbe: { email: 'cutover@example.test',
    headers: { 'x-csrf-token': 'synthetic' } } };
  const { probes } = buildProbes(config);
  for (const p of probes.filter(p => p.id.startsWith('S-9'))) {
    const req = new Request(p.url, p.options);
    assert.equal(req.method, 'POST');
    assert.equal(req.headers.get('content-type'), 'application/json');
    assert.equal(req.headers.get('x-csrf-token'), 'synthetic');
    assert.deepEqual(await req.json(), { email: config.emailProbe.email });
  }
});

test('RUN8 missing dedicated email input refuses before fence', () => {
  assert.throws(() => validateProbes(buildProbes({ endpoints: probeEndpoints() }).probes), /email_probe_input/);
});
