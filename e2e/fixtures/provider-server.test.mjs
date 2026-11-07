import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
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

test('should stream the real OpenAI Responses reasoning-evaluator protocol', async t => {
  const { url, receipt } = await fixture(t);
  const body = { model: 'gpt-5.4-nano', stream: true, max_output_tokens: 64,
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text',
      text: 'Tu es un classificateur. Répondre avec EXACTEMENT UN SEUL TOKEN: none|low|medium|high|xhigh' }] }] };
  const post = payload => fetch(`${url}/v1/responses`, { method: 'POST',
    headers: { authorization: `Bearer ${fixtureKey}` }, body: JSON.stringify(payload) });
  const response = await post(body);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /event-stream/);
  const events = (await response.text()).split('\n\n').filter(Boolean)
    .map(packet => JSON.parse(packet.split('\n').find(line => line.startsWith('data: ')).slice(6)));
  assert.equal(events.find(event => event.type === 'response.created').response.model, body.model);
  assert.equal(events.filter(event => event.type === 'response.output_text.delta').map(event => event.delta).join(''), 'medium');
  assert.equal(events.at(-1).type, 'response.completed');
  assert.equal(events.at(-1).response.output[0].content[0].text, 'medium');
  assert.equal(events.at(-1).response.usage.total_tokens, 30);
  assert.deepEqual(receipt.requests[0], { protocol: 'responses', model: body.model, stream: true, roles: ['user'] });
  for (const invalid of [{ ...body, input: [] }, { ...body, model: 'unexpected' },
    { ...body, stream: false }, { ...body, tools: [{ type: 'function', name: 'unsupported' }] },
    { ...body, input: [{ role: 'user', content: 'Unrelated journey' }] }]) {
    assert.equal((await post(invalid)).status, 400);
  }
  assert.equal(receipt.calls, 1);
  assert.equal(receipt.failedRequests, 5);
});

test('should preserve complete Unicode code points in each streamed event', async t => {
  const content = `${'a'.repeat(79)}🧪suffix`;
  const { post } = await fixture(t, () => ({ content }));
  const wire = await (await post({ stream: true })).text();
  const chunks = wire.split('\n\n').filter(packet => packet.startsWith('data: {'))
    .map(packet => JSON.parse(packet.slice(6)).choices[0].delta.content).filter(Boolean);
  assert.equal(chunks.join(''), content);
  assert.ok(chunks.every(chunk => chunk.isWellFormed()));
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

test('should account for cancellation while reading a provider request body without hiding invalid requests', async t => {
  const { server, url, post, receipt } = await fixture(t);
  const incoming = once(server, 'request');
  const client = request(`${url}/v1/chat/completions`, { method: 'POST', headers: {
    authorization: `Bearer ${fixtureKey}`, 'content-length': 1000,
  } });
  client.on('error', () => {});
  client.flushHeaders();
  const [req] = await incoming;
  const data = once(req, 'data');
  client.write('{"model":');
  await data;
  const closed = new Promise(resolve => req.once('close', resolve));
  client.destroy();
  await closed;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(req.aborted, true);
  assert.equal(receipt.failedRequests, 0);
  assert.equal(receipt.cancelled, 1);
  assert.equal(receipt.calls, 0);
  assert.equal((await post({})).status, 200);
  assert.equal((await post({ messages: [] })).status, 400);
  assert.equal(receipt.failedRequests, 1);
  assert.equal(receipt.failures[0].reason, 'Expected model and messages');
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

test('should reject unsupported provider queries without forwarding credentials or silently changing the URL', async () => {
  let forwarded = 0;
  const unexpected = [];
  const restore = installProviderBoundary({ endpoint: 'http://127.0.0.1:7777/',
    onUnexpected: entry => unexpected.push(entry), fetchImpl: async () => { forwarded++; return new Response('{}'); } });
  try {
    await assert.rejects(fetch('https://api.mistral.ai/v1/chat/completions?api_key=inert-test-credential'), /query/);
    assert.equal(forwarded, 0);
    assert.deepEqual(unexpected, [{ host: 'api.mistral.ai', reason: 'provider-query' }]);
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

test('should answer with terminal text when the finalization pass disables execution tools', () => {
  // runPass2Fallback sends no tools and asks for the final answer with the
  // original request embedded: a live model answers with text, never throws.
  const original = 'Consulte le document et appelle organization_update pour changer technologies.';
  const messages = [
    { role: 'system', content: 'System prompt. Si un contexte organizationId est présent, ne modifie que cette organisation.' },
    { role: 'user', content: original },
    { role: 'assistant', content: null, tool_calls: [{ id: 'ci_tool_0', type: 'function', function: { name: 'documents', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'ci_tool_0', name: 'documents', content: '{"items":[]}' },
    { role: 'user', content: `Demande utilisateur: ${original}\n\nRésultats disponibles (outils déjà exécutés):\n- documents\n\nRédige maintenant la réponse finale.` },
  ];
  const response = journeyResponse({ messages, tools: [] });
  assert.ok(response.content);
  assert.equal(response.tool_calls, undefined);
});

test('should prefer the user-stated entity id over system prompt decoys', () => {
  const target = 'ff87af0a-8237-4c4b-a01d-100f4aa7aad4';
  const decoy = '5cee01d5-2318-4cbe-af6d-ea95bce1dc25';
  const tools = [{ type: 'function', function: { name: 'organization_update',
    parameters: { required: ['organizationId', 'updates'] } } }];
  const messages = [
    { role: 'system', content: `Tu travailles sur l'organisation ${decoy}. Si un contexte organizationId est présent, ne modifie que cette organisation. {"id": "${decoy}"}` },
    { role: 'user', content: `Use organization_update to update the technologies field of organization ${target} (Org Update Target) to exactly: Kubernetes, Terraform, GitOps. Apply the change with the tool before replying.` },
  ];
  const response = journeyResponse({ messages, tools });
  assert.equal(response.tool_calls[0].function.name, 'organization_update');
  assert.equal(JSON.parse(response.tool_calls[0].function.arguments).organizationId, target);
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
  // System-text ids are not forwarded: only a user-stated entity id travels,
  // otherwise the org-page chat resolves the entity from primary context.
  assert.deepEqual(JSON.parse(response.tool_calls[0].function.arguments), {
    action: 'generate', format: 'pptx', title: 'Organization', entityType: 'organization',
  });
  const explicit = journeyResponse({ messages: [{ role: 'user',
    content: 'Use the document_generate tool with format "pptx" to create a presentation titled "Organization" for organization org_1234567890.' }],
  tools: [{ function: { name: 'document_generate', parameters: { required: ['action'] } } }] });
  assert.equal(JSON.parse(explicit.tool_calls[0].function.arguments).entityId, 'org_1234567890');
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

test('should use instruction and user schemas without treating assistant replies as new schema requests', () => {
  const response = journeyResponse({ messages: [
    { role: 'system', content: 'Chat system' },
    { role: 'assistant', content: '{"valueScores":[],"complexityScores":[]}' },
    { role: 'user', content: 'Reply with a sentence.' },
  ] });
  assert.doesNotMatch(response.content, /valueScores|complexityScores/);
  const detail = JSON.parse(journeyResponse({ messages: [
    { role: 'developer', content: 'Return {"name":"X","valueScores":[],"complexityScores":[]}' },
    { role: 'assistant', content: '{"dossier":"Previous reply","initiatives":[]}' },
    { role: 'user', content: 'Web research results' },
  ] }).content);
  assert.ok(detail.valueScores.length > 0);
});

test('should emit patch args when the offered organization_update schema requires patch', () => {
  // Skills-registry journeys (e.g. mistral chat runs) offer organization_update
  // with required [organizationId, patch]; the chat-services variant requires
  // [organizationId, updates]. The fixture must satisfy the presented schema.
  const skillsTool = { function: { name: 'organization_update',
    parameters: { required: ['organizationId', 'patch'] } } };
  const prompt = 'Use organization_update to update the technologies field of organization 2a9162d2-62ef-4439-8990-195746c984eb (Acme) to exactly: Kubernetes, Terraform, GitOps. Apply the tool with the tool before replying; do not ask for confirmation and do not preview the change.';
  const response = journeyResponse({ messages: [{ role: 'user', content: prompt }], tools: [skillsTool] });
  assert.ok(response.tool_calls);
  const args = JSON.parse(response.tool_calls[0].function.arguments);
  assert.ok(args.patch);
  assert.equal(args.patch.technologies.includes('Kubernetes'), true);
});

test('should fail closed on validation when the request carries no tool schemas', () => {
  // Tool-less requests that match journey prompts must raise the journey
  // validation error, not a TypeError reading schemas off an absent tools
  // array (CI: TypeError reading 'find' failed the multitool chat run).
  assert.throws(() => journeyResponse({ messages: [{ role: 'user',
    content: 'Use organization_update to update the technologies field to exactly: X.' }] }),
  /requires unavailable tool: organization_update/);
});

test('should skip the unavailable documents tool and consult via web_search', () => {
  // Journeys that do not offer the documents tool must not be asked for it:
  // fall back to an offered web_search instead of throwing.
  const tools = [
    { function: { name: 'organization_update', parameters: { required: ['organizationId', 'updates'] } } },
    { function: { name: 'web_search', parameters: { required: ['query'] } } },
  ];
  const response = journeyResponse({ messages: [{ role: 'user',
    content: 'Consulte le document attaché à cette organisation et fais UNE seule recherche web sur les technologies.' }],
  tools });
  assert.ok(response.tool_calls);
  assert.equal(response.tool_calls[0].function.name, 'web_search');
});

test('should omit entityId from document_generate so primary context resolves the org', () => {
  // A wrong explicit entityId defeats automatic primary-context resolution and
  // leaves the pptx_generate job uncompleted. System text often carries
  // unrelated ids that the extractor must not forward.
  const response = journeyResponse({ messages: [
    { role: 'system', content: 'Workspace context {"id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"}.' },
    { role: 'user', content: 'Use the document_generate tool with format "pptx" to create a one-slide presentation titled "Acme".' },
  ], tools: [{ function: { name: 'document_generate', parameters: { required: ['action'] } } }] });
  assert.ok(response.tool_calls);
  const args = JSON.parse(response.tool_calls[0].function.arguments);
  assert.equal('entityId' in args, false);
});

test('should stream long generations slowly to keep in-flight steering observable', () => {
  const response = journeyResponse({ messages: [{ role: 'user',
    content: 'Rédige 180 lignes sur la maintenance prédictive ferroviaire.' }] });
  const lines = String(response.content).split('\n').filter(line => /^Ligne \d+ :/.test(line));
  assert.equal(lines.length, 180);
  assert.ok(response.delay > 0);
  assert.ok(response.initialDelayMs > 0);
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
