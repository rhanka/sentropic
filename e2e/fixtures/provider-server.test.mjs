import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createProviderServer, fixtureKey, installProviderBoundary } from './provider-server.mjs';

async function fixture(t, respond) {
  const result = createProviderServer(respond ? { respond } : {});
  result.server.listen(0, '127.0.0.1');
  await once(result.server, 'listening');
  t.after(() => { result.server.closeAllConnections(); result.server.close(); });
  const url = `http://127.0.0.1:${result.server.address().port}`;
  return { ...result, url, post: (body, signal) => fetch(`${url}/v1/chat/completions`, {
    method: 'POST', headers: { authorization: `Bearer ${fixtureKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'mistral-small-2603', messages: [{ role: 'user', content: 'Hello' }], ...body }), signal,
  }) };
}

test('should preserve streaming chunks, usage and model routing over HTTP', async t => {
  const { post, receipt } = await fixture(t);
  const response = await post({ stream: true, model: 'gpt-5.4-nano' });
  const wire = await response.text();
  assert.match(response.headers.get('content-type'), /event-stream/);
  assert.match(wire, /chat.completion.chunk/);
  assert.match(wire, /gpt-5.4-nano/);
  assert.match(wire, /completion_tokens/);
  assert.match(wire, /\[DONE\]/);
  assert.equal(receipt.calls, 1);
});

test('should carry tool requests and results through successive HTTP requests', async t => {
  const tool = { id: 'tool-1', type: 'function', function: { name: 'read_initiative', arguments: '{"initiativeId":"abc"}' } };
  const { post, receipt } = await fixture(t, body => body.messages.at(-1).role === 'tool'
    ? { content: 'Persisted initiative received' } : { tool_calls: [tool] });
  const first = await (await post({})).json();
  assert.deepEqual(first.choices[0].message.tool_calls, [tool]);
  const second = await (await post({ messages: [{ role: 'tool', tool_call_id: 'tool-1', content: '{"name":"abc"}' }] })).json();
  assert.match(second.choices[0].message.content, /Persisted/);
  assert.deepEqual(receipt.requests[1].roles, ['tool']);
});

test('should expose malformed SSE without turning it into a successful completion', async t => {
  const { post } = await fixture(t, () => ({ malformed: true }));
  const wire = await (await post({ stream: true })).text();
  assert.match(wire, /invalid/);
  assert.doesNotMatch(wire, /\[DONE\]/);
});

for (const status of [429, 500]) test(`should expose ${status} and allow a measured retry`, async t => {
  let attempts = 0;
  const { post, receipt } = await fixture(t, () => ++attempts === 1 ? { status } : { content: 'reconnected' });
  const failure = await post({});
  assert.equal(failure.status, status);
  assert.equal(failure.headers.get('retry-after'), '0');
  assert.match((await (await post({})).json()).choices[0].message.content, /reconnected/);
  assert.equal(receipt.calls, 2);
});

test('should propagate cancellation and allow a fresh connection', async t => {
  const { post, receipt } = await fixture(t, () => ({ content: 'x'.repeat(10000), delay: 5 }));
  const controller = new AbortController();
  const response = await post({ stream: true }, controller.signal);
  await response.body.getReader().read();
  controller.abort();
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(receipt.cancelled, 1);
  assert.equal((await post({})).status, 200);
});

test('should reject invalid outbound request shapes and unknown model routes', async t => {
  const { post, receipt } = await fixture(t);
  assert.equal((await post({ messages: [] })).status, 400);
  assert.equal((await post({ model: 'unexpected-model' })).status, 400);
  assert.equal(receipt.failedRequests, 2);
  assert.equal(receipt.calls, 0);
});

test('should preserve request bytes and abort signal while forbidding real egress', async () => {
  const requests = [];
  const restore = installProviderBoundary({ endpoint: 'http://127.0.0.1:7777/', fetchImpl: async request => {
    requests.push(request); return new Response('{}');
  } });
  try {
    const controller = new AbortController();
    await fetch('https://api.mistral.ai/v1/chat/completions', { method: 'POST',
      headers: { authorization: 'Bearer real-key-must-not-escape' }, body: '{"model":"mistral-small-2603"}', signal: controller.signal });
    assert.equal(requests[0].url, 'http://127.0.0.1:7777/v1/chat/completions');
    assert.equal(await requests[0].text(), '{"model":"mistral-small-2603"}');
    assert.equal(requests[0].headers.get('authorization'), `Bearer ${fixtureKey}`);
    controller.abort();
    assert.equal(requests[0].signal.aborted, true);
    await assert.rejects(fetch('https://unexpected.example/v1/chat'), /Unexpected CI egress/);
    assert.equal(requests.length, 1);
    assert.throws(() => installProviderBoundary({ endpoint: 'https://api.mistral.ai/' }), /Invalid fixture endpoint/);
  } finally { restore(); }
});
