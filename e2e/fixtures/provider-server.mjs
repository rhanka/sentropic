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
  return { content: text.includes('Bob') ? 'Bonjour Bob, voici la réponse.' : 'CI provider response.' };
}

if (process.env.CI_PROVIDER_FIXTURE === '1') {
  if (readFileSync('/run/ci-provider/marker', 'utf8').trim() !== 'sentropic-ci-provider-v1') throw new Error('Missing fixture marker');
  installProviderBoundary({ endpoint: 'http://provider-fixture:7777/' });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createProviderServer().server.listen(Number(process.env.PORT ?? 7777), '0.0.0.0');
}
