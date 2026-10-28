import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createConversationRuntime } from '@sentropic/chat-runtime/state/conversationRuntime';
import { createDefaultTransport } from '@sentropic/chat-runtime/client/transport';
import { createStreamHub } from '@sentropic/chat-runtime/client/streamHub';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate) {
  const deadline = Date.now() + 1000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error('Installed runtime observation timed out'); await sleep(1); }
}
class Source extends EventTarget {
  close() {}
  emit(streamId, type, data, sequence) { this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify({ streamId, data, sequence }) })); }
}

for (const scenario of ['missing', 'denial', 'timeout', 'approval']) {
  const requests = []; const executions = []; let turn = 0;
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://probe').pathname;
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
    requests.push({ path, method: req.method, body });
    res.setHeader('content-type', 'application/json');
    if (path === '/models/catalog') return res.end(JSON.stringify({ providers: [], models: [{ provider_id: 'openai', model_id: 'model' }], defaults: { provider_id: 'openai', model_id: 'model' } }));
    if (path.endsWith('/history')) return res.end(JSON.stringify({ type: 'session_meta', sessionId: 'session', checkpoints: [] }) + '\n');
    if (path === '/chat/messages' || path.endsWith('/retry')) {
      turn++; return res.end(JSON.stringify({ sessionId: 'session', userMessageId: 'user', assistantMessageId: `assistant-${turn}`, streamId: `assistant-${turn}` }));
    }
    res.end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let source;
  const hub = createStreamHub({ getBaseUrl: () => base, getAuthState: () => true, eventTarget: new EventTarget(), reconnectDelayMs: 0,
    eventSourceFactory: () => { source = new Source(); return source; } });
  const authorizeLocalTool = scenario === 'missing' ? undefined : scenario === 'denial' ? () => false
    : scenario === 'timeout' ? () => new Promise(() => {}) : (request) => request.decision === 'allow' ? true : 'pending';
  const runtime = createConversationRuntime('session', {
    host: { ...createDefaultTransport(base), streamClient: hub }, authorizeLocalTool,
    ...(scenario === 'timeout' ? { permissionTimeoutMs: 10 } : {}),
    contextProvider: { context: { subscribe(run) { run([{ type: 'folder', id: 'folder', label: 'Folder', active: true }]); return () => {}; } } },
    sendPayload: () => ({ tools: ['web_search'], localToolDefinitions: [{ name: 'bash', description: 'Platform', parameters: {} }] }),
    documents: { uploadFile: async (draft) => ({ ...draft, state: 'ready', documentId: 'document' }), deleteUploadedFile: async () => {},
      resolveAttachmentSrc: () => '', downloadGeneratedFile: async () => {} },
    localTools: { isLocalToolName: (name) => name === 'bash', isLocalToolRuntimeAvailable: () => true,
      isLocalToolPermissionRequired: () => false, getPermissionRequest: () => ({ requestId: '', toolName: '', origin: '' }),
      decideLocalToolPermission: async () => {}, executeLocalTool: async (...args) => { executions.push(args); return { executed: true }; },
      postLocalToolResult: async () => {} },
  });
  try {
    await runtime.initialize(); await until(() => source);
    await runtime.commands.attachFiles([new File(['data'], 'notes.txt', { type: 'text/plain' })]);
    runtime.commands.setDraft('Installed payload'); await runtime.commands.send();
    const sent = requests.find((request) => request.path === '/chat/messages').body;
    assert.equal(sent.content, 'Installed payload'); assert.equal(sent.providerId, 'openai'); assert.equal(sent.model, 'model');
    assert.deepEqual(sent.contexts, [{ contextType: 'folder', contextId: 'folder' }]); assert.deepEqual(sent.tools, ['web_search']);
    assert.equal(sent.attachments[0].documentId, 'document'); assert.equal(sent.localToolDefinitions[0].name, 'bash');
    const streamId = runtime.snapshot().activeStreamId;
    const requestTool = (sequence) => source.emit(streamId, 'tool_call_start', { tool_call_id: 'call', name: 'bash', args: '{}' }, sequence);
    requestTool(1);
    if (scenario === 'approval') {
      await until(() => runtime.snapshot().permissions[0]?.status === 'pending');
      assert.equal(executions.length, 0); await runtime.commands.decidePermission(`${streamId}:call`, true);
    }
    const results = () => requests.filter((request) => request.path.endsWith('/tool-results'));
    await until(() => results().length === 1);
    assert.equal(executions.length, scenario === 'approval' ? 1 : 0);
    assert.equal(runtime.snapshot().permissions[0].status, scenario === 'approval' ? 'approved' : 'denied');
    assert.deepEqual(results()[0].body.result, scenario === 'approval' ? { executed: true } : { status: 'error', error: 'Local tool permission denied' });
    requestTool(5); await sleep(150); assert.equal(results().length, 1); assert.equal(executions.length, scenario === 'approval' ? 1 : 0);
    runtime.commands.setDraft('Retained'); const unbind = runtime.subscribe(() => {}); unbind();
    source.emit(streamId, 'content_delta', { delta: 'Installed progress' }, 6);
    const release = runtime.subscribe(() => {});
    assert.equal(runtime.snapshot().draft, 'Retained'); assert.equal(runtime.session.snapshot().attachGeneration, 1);
    assert.ok(JSON.stringify(runtime.snapshot().items).includes('Installed progress')); release();
    await runtime.commands.setFeedback('assistant-1', 'up'); await runtime.commands.edit('user', 'Edited');
    await runtime.commands.steer(); await runtime.commands.retry('user'); await runtime.commands.stop('assistant-2');
    assert.equal(runtime.snapshot().error, null);
    for (const suffix of ['/feedback', '/steer', '/retry', '/stop']) assert.ok(requests.some((request) => request.path.endsWith(suffix)));
    assert.ok(requests.some((request) => request.method === 'PATCH' && request.body.content === 'Edited'));
  } finally { runtime.dispose(); hub.reset(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
}
console.log('PASS installed runtime payload, commands, remount and permission matrix');
