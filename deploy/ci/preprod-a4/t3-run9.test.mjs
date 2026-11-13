import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { finishOpen } from './t3-finish-open.mjs';
import { buildProbes, monoMs, validateProbes } from './t3-lib.mjs';
import { emailProbe, expectedSigningKid, probeEndpoints, probeReply } from './t3-probe-fixture.mjs';

test('RUN9 refuses a recipient without room for the attempt tag before fence', () => {
  const config = { endpoints: probeEndpoints(), expectedSigningKid,
    emailProbe: { email: `${'a'.repeat(37)}@example.test` } };
  assert.throws(() => validateProbes(buildProbes(config).probes), /email_probe_input/);
});

for (const fault of ['lost-second-response', 'crash-before-accepted-save']) {
  test(`RUN9 shared email quota converges after ${fault} within the original window`, async () => {
    // Faithful custody semantics: normalized address, shared across hosts, 3/600s.
    const counts = new Map(), emitted = [];
    let inject = true, persisted = { namespace: 'sentropic-preprod', middlewareSpec: {}, substate: 'POSTCOMMIT_RESTRICTED' };
    const server = createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      const url = `http://${req.headers.host}${req.url}`;
      if (/email(App|Idp)$/.test(url)) {
        const email = JSON.parse(body).email.trim().toLowerCase();
        const count = counts.get(email) ?? 0;
        if (count >= 3) { res.writeHead(429); res.end(); return; }
        counts.set(email, count + 1);
        emitted.push(email);
        if (inject && fault === 'lost-second-response' && url.endsWith('emailIdp')) {
          inject = false; res.destroy(); return; // emission committed, response lost
        }
      }
      const reply = probeReply(url, { method: req.method, headers: req.headers, body });
      res.writeHead(reply.status, Object.fromEntries(reply.headers));
      res.end(await reply.text());
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const endpoints = probeEndpoints(`http://127.0.0.1:${server.address().port}`);
    const deadlineMs = monoMs() + 300_000;
    const ctx = { ...buildProbes({ endpoints, emailProbe, expectedSigningKid }),
      deadlineMs, images: { candidate: 'c', ui: 'u' }, probe: fetch,
      save: state => {
        if (inject && fault === 'crash-before-accepted-save' && state.substate === 'ACCEPTED') {
          inject = false; throw new Error('crash_before_save');
        }
        persisted = structuredClone(state);
      },
      call: args => {
        if (args[1] === 'deployment') {
          const name = args[2];
          return JSON.stringify({ metadata: { generation: 1 }, status: { readyReplicas: 1, observedGeneration: 1 },
            spec: { replicas: 1, template: { spec: { containers: [{ name, image: name === 'ui' ? 'u' : 'c' }] } } } });
        }
        if (args[1] === 'middleware') return '{"spec":{}}';
        if (args[1] === 'ingress') return JSON.stringify({ metadata: { annotations: {
          'traefik.ingress.kubernetes.io/router.middlewares': 'sentropic-preprod-a4-verification@kubernetescrd' } } });
        return '{}';
      } };
    try {
      await assert.rejects(finishOpen({ ...ctx, state: structuredClone(persisted) }));
      assert.equal(emitted.length, 2, 'both original emissions committed');
      assert.equal(persisted.substate, 'POSTCOMMIT_RESTRICTED');
      await finishOpen({ ...ctx, state: structuredClone(persisted) });
      assert.equal(persisted.substate, 'TWO_HOSTS_OPEN');
      assert.equal(new Set(emitted).size, 4, 'each request uses a fresh recipient, even across hosts/recovery');
      assert.equal(counts.get(emailProbe.email), undefined, 'base mailbox quota remains intact');
      assert.ok(monoMs() < deadlineMs, 'no rate-limit sleep or budget reset');
      for (const email of emitted) assert.match(email, /^cutover\+t3-[a-f0-9]{24}@example\.test$/);
      for (const status of [200, 200, 200, 429]) {
        const reply = await fetch(endpoints.emailApp, { method: 'POST',
          headers: { 'content-type': 'application/json' }, body: JSON.stringify(emailProbe) });
        assert.equal(reply.status, status, 'protection still limits repeated use of one address');
        await reply.body.cancel();
      }
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  });
}
