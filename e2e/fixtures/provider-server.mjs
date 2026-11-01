import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const fixtureKey = 'ci-provider-fixture-no-live-credential';
export const boundaryKey = Symbol.for('sentropic.ci.provider-boundary');
const upstreams = new Set(['api.mistral.ai', 'api.openai.com', 'chatgpt.com',
  'api.anthropic.com', 'generativelanguage.googleapis.com', 'api.tavily.com']);
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]', 'api', 'api-sut',
  'ui', 'postgres', 'minio', 'scw-tem-mock', 'provider-fixture', 'openvscode']);

// Loaded only from the read-only test overlay, never packaged in the application.
export function installProviderBoundary({ endpoint, fetchImpl = globalThis.fetch } = {}) {
  const target = new URL(endpoint);
  if (target.protocol !== 'http:' || !['provider-fixture', '127.0.0.1'].includes(target.hostname)
    || target.username || target.password || target.pathname !== '/') throw new Error('Invalid fixture endpoint');
  const guardedFetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (localHosts.has(url.hostname)) return fetchImpl(request);
    if (!upstreams.has(url.hostname)) throw new Error(`Unexpected CI egress: ${url.hostname}`);
    const headers = new Headers(request.headers);
    headers.delete('authorization');
    headers.delete('x-api-key');
    headers.set('authorization', `Bearer ${fixtureKey}`);
    headers.set('x-ci-upstream', url.hostname);
    return fetchImpl(new Request(new URL(url.pathname, target), new Request(request, { headers, redirect: 'error' })));
  };
  globalThis.fetch = guardedFetch;
  globalThis[boundaryKey] = true;
  return () => { globalThis.fetch = fetchImpl; delete globalThis[boundaryKey]; };
}

export function createProviderServer({ respond = journeyResponse } = {}) {
  const receipt = { calls: 0, failedRequests: 0, cancelled: 0, models: {}, requests: [] };
  const server = createServer(async (req, res) => {
    if (req.url === '/health') return res.end('ok');
    if (req.url === '/receipt') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify(receipt));
    }
    try {
      if (req.method !== 'POST' || req.headers.authorization !== `Bearer ${fixtureKey}`) throw new Error('Invalid fixture request');
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 8_000_000) throw new Error('Fixture request too large');
      }
      const body = JSON.parse(raw);
      if (!body.model || !Array.isArray(body.messages) || body.messages.length === 0) throw new Error('Expected model and messages');
      if (!/^(mistral-|gpt-)/.test(body.model)) throw new Error('Unexpected model route');
      const outcome = await respond(body);
      receipt.calls++;
      receipt.models[body.model] = (receipt.models[body.model] ?? 0) + 1;
      receipt.requests.push({ model: body.model, stream: body.stream === true,
        roles: body.messages.map(m => m.role), tools: (body.tools ?? []).map(t => t.function?.name) });
      if (outcome.status) {
        res.writeHead(outcome.status, { 'content-type': 'application/json', 'retry-after': '0' });
        return res.end(JSON.stringify({ error: { message: 'Fixture provider failure', code: 'fixture_error' } }));
      }
      const message = { role: 'assistant', content: outcome.content ?? null,
        ...(outcome.tool_calls ? { tool_calls: outcome.tool_calls } : {}) };
      const finish = outcome.tool_calls ? 'tool_calls' : 'stop';
      const envelope = { id: 'ci-completion', created: 1, model: body.model,
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } };
      if (!body.stream) {
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify({ ...envelope, object: 'chat.completion', choices: [{ index: 0, message, finish_reason: finish }] }));
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      let ended = false;
      res.on('close', () => { if (!ended) receipt.cancelled++; });
      const event = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ ...envelope,
        object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason }] })}\r\n\r\n`);
      if (outcome.malformed) return res.end('data: {invalid}\n\n');
      if (message.tool_calls) event({ tool_calls: message.tool_calls.map((tool, index) => ({ index, ...tool })) });
      else {
        const parts = String(message.content ?? '').match(/.{1,80}/gs) ?? [''];
        for (const content of parts) {
          if (res.destroyed) return;
          event({ content });
          if (outcome.delay) await new Promise(resolve => setTimeout(resolve, outcome.delay));
        }
      }
      event({}, finish);
      ended = true;
      res.end('data: [DONE]\r\n\r\n');
    } catch (error) {
      receipt.failedRequests++;
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: error.message } }));
    }
  });
  return { server, receipt };
}

export function journeyResponse(body) {
  const messages = body.messages;
  const text = messages.map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n');
  const user = messages.findLast(m => m.role === 'user')?.content ?? '';
  const json = value => ({ content: JSON.stringify(value) });
  const references = [{ title: 'Provider protocol reference', url: 'https://example.com/reference', excerpt: 'Local qualification evidence.' }];
  if (/"dossier"/.test(text) && /"initiatives"/.test(text)) {
    const count = Number(text.match(/(?:exactement|à générer:|a generer:)\s*(\d+)/i)?.[1] ?? 3);
    if (count < 1 || count > 50) throw new Error('Unexpected initiative count');
    return json({ dossier: 'AI opportunities', domains: [{ id: 'operations', label: 'Operations' }],
      initiatives: Array.from({ length: count }, (_, i) => ({ titre: `AI initiative ${i + 1}`,
        description: 'Improve operational quality using verified data [1].', ref: references[0].url, domainId: 'operations' })) });
  }
  if (/"synthese_executive"/.test(text)) return json({ executive_summary: {
    introduction: 'Portfolio overview', analyse: 'Value and complexity analysis',
    recommandation: 'Validate the selected initiatives', synthese_executive: 'Operational improvements', references } });
  if (/"valueAxes"/.test(text) && /"levelDescriptions"/.test(text)) {
    const axes = ids => ids.map(axisId => ({ axisId,
      levelDescriptions: Array.from({ length: 5 }, (_, i) => ({ level: i + 1, description: `Observable qualification level ${i + 1}` })) }));
    return json({ valueAxes: axes(['business_value', 'time_criticality', 'risk_reduction_opportunity']),
      complexityAxes: axes(['implementation_effort', 'data_compliance', 'data_availability', 'change_management']) });
  }
  if (/"valueScores"/.test(text) && /"complexityScores"/.test(text)) {
    const result = { name: 'AI initiative', description: 'Improve operational quality using verified data [1].',
      problem: 'Operational data needs consistent validation.', solution: 'Apply a repeatable validation process.',
      leadtime: 'Pilot validation', prerequisites: 'Validated data access', contact: 'Product owner', references,
      valueScores: [{ axisId: 'business_value', rating: 55, description: 'Measured business benefit' }],
      complexityScores: [{ axisId: 'implementation_effort', rating: 21, description: 'Bounded integration' }] };
    for (const key of ['technologies', 'benefits', 'metrics', 'risks', 'constraints', 'nextSteps', 'dataSources', 'dataObjects']) result[key] = ['Verified operational evidence'];
    return json(result);
  }
  if (/"industry"/.test(text) && /"products"/.test(text) && !body.tools?.some(t => t.function?.name === 'organization_update')) {
    return json({ industry: 'Manufacturing', size: 'Enterprise', products: 'Industrial products', processes: 'Quality control',
      kpis: 'Quality and adoption', challenges: 'Data integration', objectives: 'Improve operations', technologies: 'Cloud platforms', references });
  }
  const tools = (body.tools ?? []).map(t => t.function?.name);
  const lastUser = messages.findLastIndex(m => m.role === 'user');
  const results = messages.slice(lastUser + 1).filter(m => m.role === 'tool');
  const used = new Set(results.map(m => m.name));
  const id = kind => String(user).match(new RegExp(`${kind}Id[=\\s:\\"']+([\\w-]+)`, 'i'))?.[1]
    ?? text.match(new RegExp(`(?:${kind}Id|${kind}_id)[=\\s:\\"']+([\\w-]+)`, 'i'))?.[1]
    ?? text.match(new RegExp(`${kind} (?:with id )?([a-z0-9_-]{10,})`, 'i'))?.[1]
    ?? text.match(/"(?:contextId|id)"\s*:\s*"([\w-]+)"/)?.[1];
  const call = (name, args) => {
    if (!tools.includes(name)) throw new Error(`Journey requires unavailable tool: ${name}`);
    return { tool_calls: [{ id: `ci_tool_${results.length}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] };
  };
  if (results.length === 0) {
    if (/matrix_get/.test(user)) return call('matrix_get', { folderId: id('folder') });
    if (/web_extract/.test(user)) return call('web_extract', { urls: [...new Set(String(user).match(/https?:\/\/[^\s"\],]+/g) ?? [])] });
    if (/update_initiative|update the description|Ajoute.*Test E2E/i.test(user)) return call('update_initiative', {
      initiativeId: id('initiative'), updates: [{ path: 'description', value: /Test E2E/.test(user) ? 'Test E2E: Updated description' : 'Updated description for testing' }] });
    if (/read.*initiative/i.test(user)) return call('read_initiative', { initiativeId: id('initiative') });
  }
  if (/Consulte le document/.test(user)) {
    if (!used.has('documents')) return call('documents', { action: 'list', contextType: 'organization', contextId: id('organization') });
    if (!used.has('web_search')) return call('web_search', { query: 'cloud-native Kubernetes platforms' });
  }
  if (/organization_update|technologies.*exactly/i.test(user) && !used.has('organization_update')) return call('organization_update', {
    organizationId: id('organization'), updates: [{ field: 'technologies', value: 'Kubernetes, containers, CI/CD and infrastructure-as-code' }] });
  return { content: text.includes('Bob') ? 'Bonjour Bob, voici la réponse.' : 'CI provider response: opération terminée.' };
}

if (process.env.CI_PROVIDER_FIXTURE === '1') {
  if (readFileSync('/run/ci-provider/marker', 'utf8').trim() !== 'sentropic-ci-provider-v1') throw new Error('Missing fixture marker');
  installProviderBoundary({ endpoint: 'http://provider-fixture:7777/' });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createProviderServer().server.listen(Number(process.env.PORT ?? 7777), '0.0.0.0');
}
