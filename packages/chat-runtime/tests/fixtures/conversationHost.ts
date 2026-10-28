import { createChatServer, createInMemoryChatServerDeps } from '../../../chat-server/src/index.js';
import { createDefaultTransport } from '../../src/client/transport.js';
import { createStreamHub } from '../../src/client/streamHub.js';
import { createConversationRuntime, type ConversationRuntimeOptions } from '../../src/state/conversationRuntime.js';
import type { DocumentHost } from '@sentropic/chat-ui/documents';
import { registerLocalTool, unregisterLocalTool } from '../../src/stores/localTools.js';
import { buildChatHistoryTimeline, type ChatHistoryMessage } from '../../../chat-core/src/history.js';
import type { CheckpointHost } from '../../src/checkpoints/index.js';

class FixtureEventSource extends EventTarget {
  closed = false;
  onerror: ((event: Event) => void) | null = null;
  close() { this.closed = true; }
  publish(type: string, data: Record<string, unknown>) {
    if (!this.closed) this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) }));
  }
}

/** Real server, transport, stream hub, controller and session; only platform I/O is in memory. */
export async function createConversationFixture(overrides: Partial<ConversationRuntimeOptions> = {}) {
  registerLocalTool({ name: 'render_mermaid', description: 'Diagram', parameters: {} });
  const requests: Array<{ method: string; path: string; body: unknown }> = [];
  const executions: Array<{ id: string; name: string; args: unknown }> = [];
  const decisions: Array<{ id: string; value: string }> = [];
  const docs = new Map<string, File>();
  const uploads: string[] = [];
  let failUpload = false;
  const deps = createInMemoryChatServerDeps({ assistantReply: 'Reply **markdown**' });
  const readHistory = deps.sessions!.getSessionHistory.bind(deps.sessions);
  const createCheckpoint = deps.messages.createCheckpoint!.bind(deps.messages);
  deps.messages.createCheckpoint = async (input) => {
    const checkpoint = await createCheckpoint(input);
    const history = await readHistory({ sessionId: input.sessionId, userId: input.userId, detailMode: 'full' });
    const anchor = (history.items as ChatHistoryMessage[]).find((message) => message.id === input.anchorMessageId);
    return Object.assign(checkpoint as object, { anchorMessageId: input.anchorMessageId, anchorSequence: Number(anchor?.sequence ?? 0) });
  };
  deps.sessions!.getSessionHistory = async (input) => {
    const history = await readHistory(input);
    const events = await deps.stream.readSessionEvents({ sessionId: input.sessionId, fromSeq: 0, userId: input.userId });
    const byStream = new Map<string, typeof events>();
    for (const event of events) byStream.set(event.streamId, [...(byStream.get(event.streamId) ?? []), event]);
    return { ...history, items: buildChatHistoryTimeline(history.items as ChatHistoryMessage[], byStream) };
  };
  const server = createChatServer(deps, { routes: 'app-contract' });
  server.get('/models/catalog', (c) => c.json({
    providers: [{ provider_id: 'openai', label: 'OpenAI', status: 'ready' }],
    models: [{ provider_id: 'openai', model_id: 'model-a', label: 'Model A', default_contexts: [] },
      { provider_id: 'openai', model_id: 'model-b', label: 'Model B', default_contexts: [] }],
    defaults: { provider_id: 'openai', model_id: 'model-a' },
  }));
  server.get('/queue/jobs/:id', (c) => c.json({ status: 'completed' }));
  server.get('/documents/:id/content', (c) => c.text('Generated document'));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push({ method: request.method, path: new URL(request.url).pathname,
      body: ['POST', 'PATCH'].includes(request.method) ? await request.clone().json().catch(() => null) : null });
    return server.request(request);
  };
  const transport = createDefaultTransport('http://chat.test');
  const created = await server.request('/chat/sessions', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionTitle: 'Parity' }),
  });
  const { sessionId } = await created.json() as { sessionId: string };
  let source: FixtureEventSource;
  const streamClient = createStreamHub({
    getBaseUrl: () => 'http://chat.test', getAuthState: () => true, eventTarget: new EventTarget(), reconnectDelayMs: 0,
    eventSourceFactory: () => { source = new FixtureEventSource(); return source as unknown as EventSource; },
  });
  const documents: DocumentHost = {
    async uploadFile(draft, file) {
      uploads.push(file.name);
      if (failUpload) { failUpload = false; throw new Error('Upload failed'); }
      const documentId = `doc:${draft.id}`;
      docs.set(documentId, file);
      return { ...draft, documentId, state: 'ready' };
    },
    async deleteUploadedFile(id) { docs.delete(id); },
    resolveAttachmentSrc: (attachment) => attachment.previewUrl ?? `http://chat.test/documents/${attachment.documentId}/content`,
    async downloadGeneratedFile(card) {
      const response = await fetch(card.downloadUrl ?? `http://chat.test/documents/${card.jobId}/content`);
      if (!response.ok) throw new Error('Download failed');
    },
  };
  const host = { ...transport, streamClient };
  const checkpointRequest = async (path: string, body?: unknown) => {
    const response = await fetch(`http://chat.test/chat/sessions/${sessionId}/checkpoints${path}`, body === undefined ? undefined : {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Checkpoint request failed: ${response.status}`);
    return response.json();
  };
  const checkpointHost: CheckpointHost = {
    fetchCheckpoints: async () => (await checkpointRequest('')).checkpoints,
    createCheckpoint: async (_sessionId, anchorMessageId) => { await checkpointRequest('', { anchorMessageId }); },
    restoreCheckpoint: async (_sessionId, checkpointId) => { await checkpointRequest(`/${checkpointId}/restore`, {}); },
    isMutatingTool: (name) => name.endsWith('_update'),
  };
  const runtimeOptions: ConversationRuntimeOptions = {
    host, documents, checkpointHost,
    localTools: {
      isLocalToolName: (name) => name === 'render_mermaid', isLocalToolRuntimeAvailable: () => true,
      isLocalToolPermissionRequired: () => false,
      getPermissionRequest: () => ({ requestId: 'native', toolName: 'render_mermaid', origin: 'fixture' }),
      async executeLocalTool(id, name, args) { executions.push({ id, name, args }); return { rendered: true }; },
      async decideLocalToolPermission(id, value) { decisions.push({ id, value }); },
      postLocalToolResult: transport.postLocalToolResult,
    },
    ...overrides,
  };
  let runtime = createConversationRuntime(sessionId, runtimeOptions);
  await runtime.initialize();
  return {
    get runtime() { return runtime; }, transport, deps, server, requests, executions, decisions, docs, uploads, sessionId,
    failNextUpload() { failUpload = true; },
    async restart() { runtime.dispose(); runtime = createConversationRuntime(sessionId, runtimeOptions); await runtime.initialize(); },
    emit(streamId: string, type: string, data: Record<string, unknown>, sequence: number) {
      source!.publish(type, { streamId, data, sequence });
    },
    async replay() {
      const events = await deps.stream.readSessionEvents({ sessionId, fromSeq: 0, userId: 'user_test' });
      for (const event of events) source!.publish(event.eventType, { streamId: event.streamId, data: event.data, sequence: event.sequence });
    },
    dispose() { runtime.dispose(); streamClient.reset(); unregisterLocalTool('render_mermaid'); globalThis.fetch = originalFetch; },
  };
}
