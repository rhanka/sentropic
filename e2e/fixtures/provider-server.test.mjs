import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createProviderServer, fixtureKey, installProviderBoundary, journeyResponse } from './provider-server.mjs';

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
  const packets = wire.split('\n\n').filter(Boolean).map(packet => packet.slice('data: '.length));
  assert.equal(packets.at(-1), '[DONE]');
  assert.ok(packets.slice(0, -1).map(packet => JSON.parse(packet)).some(chunk => chunk.choices[0].delta.content));
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
  const originalFetch = globalThis.fetch;
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
  assert.equal(globalThis.fetch, originalFetch);
});

test('should strip provider credential headers while preserving local application credentials', async () => {
  const requests = [];
  const names = ['x-goog-api-key', 'api-key', 'cookie', 'proxy-authorization'];
  const restore = installProviderBoundary({ endpoint: 'http://127.0.0.1:7777/', fetchImpl: async request => {
    requests.push(request); return new Response('{}');
  } });
  try {
    await fetch('https://api.mistral.ai/v1/chat/completions', { method: 'POST', body: '{}',
      headers: Object.fromEntries(names.map(name => [name, 'inert-test-credential'])) });
    assert.deepEqual(names.filter(name => requests[0].headers.has(name)), []);
    assert.equal(requests[0].headers.get('authorization'), `Bearer ${fixtureKey}`);
    await fetch('http://api:8787/api/v1/session', { headers: { cookie: 'inert-local-session' } });
    assert.equal(requests[1].headers.get('cookie'), 'inert-local-session');
  } finally { restore(); }
});

test('should preserve requested initiative count and structured fields over HTTP', async t => {
  const { post } = await fixture(t);
  const response = await (await post({ messages: [{ role: 'user', content:
    'Génère exactement 2 cas. Réponds avec {"dossier":"", "initiatives":[]}' }] })).json();
  const content = JSON.parse(response.choices[0].message.content);
  assert.equal(content.initiatives.length, 2);
  assert.ok(content.dossier);
  assert.ok(content.initiatives.every(item => content.domains.some(domain => domain.id === item.domainId)));
});

test('should return nonempty executive summary sections in the application schema', () => {
  const content = JSON.parse(journeyResponse({ messages: [{ role: 'user', content:
    'Return {"introduction":"", "analyse":"", "recommandation":"", "synthese_executive":""}' }] }).content);
  for (const field of ['introduction', 'analyse', 'recommandation', 'synthese_executive']) assert.ok(content[field].length > 0);
});

test('should request real application tools with exact context IDs and consume their results', () => {
  const tools = ['documents', 'web_search', 'organization_update'].map(name => ({ type: 'function', function: {
    name, parameters: { required: name === 'organization_update' ? ['organizationId', 'updates'] : [] },
  } }));
  const messages = [{ role: 'system', content: "Tu travailles sur l'organisation org_1234567890." },
    { role: 'user', content: "Consulte le document et appelle organization_update pour changer technologies." }];
  const sequence = [];
  for (let i = 0; i < 3; i++) {
    const response = journeyResponse({ messages, tools });
    const tool = response.tool_calls[0];
    sequence.push(tool.function.name);
    if (i === 2) assert.equal(JSON.parse(tool.function.arguments).organizationId, 'org_1234567890');
    messages.push({ role: 'tool', name: tool.function.name, content: '{"status":"completed"}' });
  }
  assert.deepEqual(sequence, ['documents', 'web_search', 'organization_update']);
  assert.ok(journeyResponse({ messages, tools }).content);
});

test('should serve web research locally and reject empty extraction requests', async t => {
  const { url, receipt } = await fixture(t);
  const post = (path, body) => fetch(`${url}/${path}`, { method: 'POST',
    headers: { authorization: `Bearer ${fixtureKey}`, 'x-ci-upstream': 'api.tavily.com' }, body: JSON.stringify(body) });
  assert.equal((await (await post('search', { query: 'cloud-native' })).json()).results.length, 1);
  assert.equal((await (await post('extract', { urls: ['https://example.com/reference'] })).json()).results[0].url, 'https://example.com/reference');
  assert.equal((await post('extract', { urls: [] })).status, 400);
  assert.equal(receipt.calls, 2);
});

test('should require image content on the selected vision model request', async t => {
  const { post } = await fixture(t);
  const question = 'What is the dominant color of the attached image?';
  const content = [{ type: 'text', text: question }, { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } }];
  const response = await (await post({ model: 'mistral-medium-3.5', messages: [{ role: 'user', content }] })).json();
  assert.equal(response.choices[0].message.content, 'red');
  assert.equal((await post({ model: 'mistral-medium-3.5', messages: [{ role: 'user', content: question }] })).status, 400);
});

test('should cite actual document tool results using standard call IDs', () => {
  const messages = [{ role: 'system', content: 'Session de chat (session_12345)' },
    { role: 'user', content: 'Liste les documents de la session et cite leur nom.' }];
  const tools = [{ function: { name: 'documents', parameters: { required: ['action', 'contextType', 'contextId'] } } }];
  const first = journeyResponse({ messages, tools });
  assert.equal(JSON.parse(first.tool_calls[0].function.arguments).contextId, 'session_12345');
  messages.push({ role: 'assistant', tool_calls: first.tool_calls });
  messages.push({ role: 'tool', tool_call_id: first.tool_calls[0].id, content: '{"items":[{"filename":"README.md"}]}' });
  assert.equal(journeyResponse({ messages, tools }).content, 'README.md');
});

test('should request update_initiative with the skill-bundle patch shape', () => {
  const tools = [{ type: 'function', function: { name: 'update_initiative',
    parameters: { required: ['initiativeId', 'patch'] } } }];
  const response = journeyResponse({ tools, messages: [{ role: 'user',
    content: 'Ajoute Test E2E à la description initiativeId=init_1234567890' }] });
  const args = JSON.parse(response.tool_calls[0].function.arguments);
  assert.equal(args.initiativeId, 'init_1234567890');
  assert.equal(args.patch.description, 'Test E2E: Updated description');
});

test('should request a real PPTX generation tool and preserve explicit reply tokens', () => {
  const response = journeyResponse({ messages: [{ role: 'system', content: "Tu travailles sur l'organisation org_1234567890." },
    { role: 'user', content: 'Use the document_generate tool with format "pptx" to create a presentation titled "Organization".' }],
  tools: [{ function: { name: 'document_generate', parameters: { required: ['action'] } } }] });
  assert.deepEqual(JSON.parse(response.tool_calls[0].function.arguments), {
    action: 'generate', format: 'pptx', title: 'Organization', entityType: 'organization', entityId: 'org_1234567890',
  });
  assert.equal(journeyResponse({ messages: [{ role: 'user', content: 'Réponds uniquement "OK_SKILLS_OK" sans rien d’autre.' }] }).content, 'OK_SKILLS_OK');
});

test('should resolve schema journeys when tool results trail the prompt as a user message', () => {
  // Web-search follow-up shape: the structured prompt is an earlier user message and the
  // last user message carries the search results.
  const messages = [
    { role: 'system', content: 'Follow-up system prompt' },
    { role: 'user', content: 'Score this initiative with {"name":"AI initiative","valueScores":[],"complexityScores":[]}' },
    { role: 'assistant', content: 'Let me research.' },
    { role: 'user', content: 'Voici les résultats de recherche web:\n[{"title":"t","url":"https://example.com/r","excerpt":"e"}]' },
  ];
  const content = JSON.parse(journeyResponse({ messages }).content);
  assert.equal(content.name, 'AI initiative');
  assert.ok(content.valueScores[0].rating > 0);
  assert.ok(content.complexityScores[0].rating > 0);
});

test('should not treat schema keys inside tool-result payloads as a schema journey', () => {
  const messages = [
    { role: 'system', content: 'Chat system' },
    { role: 'user', content: 'Read initiative init_1234567890' },
    { role: 'assistant', tool_calls: [{ id: 'ci_tool_0', type: 'function', function: { name: 'read_initiative', arguments: '{"initiativeId":"init_1234567890"}' } }] },
    { role: 'tool', tool_call_id: 'ci_tool_0', content: '{"id":"init_1234567890","name":"X","valueScores":[{"axisId":"business_value","rating":55}],"complexityScores":[{"axisId":"implementation_effort","rating":21}]}' },
  ];
  const response = journeyResponse({ messages, tools: [{ function: { name: 'read_initiative', parameters: { required: ['initiativeId'] } } }] });
  assert.ok(response.content);
  assert.equal(response.tool_calls, undefined);
});

test('should prefer the use-case detail journey when the prompt embeds the matrix JSON', () => {
  // Detail prompt shape: matrix config ("valueAxes" + "levelDescriptions") plus the
  // response schema ("valueScores" + "complexityScores") in the same prompt.
  const detailPrompt = 'Génère un cas d\'usage détaillé. Matrice: {"valueAxes":[{"axisId":"business_value","levelDescriptions":[{"level":1,"description":"d"}]}],"complexityAxes":[]}. Réponds avec {"name":"X","valueScores":[],"complexityScores":[]}';
  const detail = JSON.parse(journeyResponse({ messages: [{ role: 'user', content: detailPrompt }] }).content);
  assert.ok(Array.isArray(detail.valueScores));
  assert.ok(Array.isArray(detail.complexityScores));
  assert.equal(detail.valueAxes, undefined);
  // Matrix-adaptation prompt shape: only axes with level descriptions.
  const axesPrompt = 'Adapte les descriptions de niveaux. Réponds avec {"valueAxes":[{"axisId":"a","levelDescriptions":[]}],"complexityAxes":[]}';
  const axes = JSON.parse(journeyResponse({ messages: [{ role: 'user', content: axesPrompt }] }).content);
  assert.ok(Array.isArray(axes.valueAxes));
  assert.equal(axes.valueScores, undefined);
});
