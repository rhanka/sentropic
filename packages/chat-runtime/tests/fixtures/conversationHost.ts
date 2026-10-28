import { createChatServer, createInMemoryChatServerDeps } from '../../../chat-server/src/index.js';
import { createDefaultTransport } from '../../src/client/transport.js';
import { createStreamHub } from '../../src/client/streamHub.js';
import { createConversationRuntime, type ConversationRuntimeOptions } from '../../src/state/conversationRuntime.js';
import type { DocumentHost } from '@sentropic/chat-ui/documents';

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
  const requests: Array<{ method: string; path: string; body: unknown }> = [];
  const executions: Array<{ id: string; name: string; args: unknown }> = [];
  const decisions: Array<{ id: string; value: string }> = [];
  const docs = new Map<string, File>();
  const deps = createInMemoryChatServerDeps({ assistantReply: 'Reply **markdown**' });
  const server = createChatServer(deps, { routes: 'app-contract' });
  server.get('/models/catalog', (c) => c.json({
    providers: [{ provider_id: 'openai', label: 'OpenAI', status: 'ready' }],
    models: [{ provider_id: 'openai', model_id: 'model-a', label: 'Model A', default_contexts: [] },
      { provider_id: 'openai', model_id: 'model-b', label: 'Model B', default_contexts: [] }],
    defaults: { provider_id: 'openai', model_id: 'model-a' },
  }));
  server.get('/queue/jobs/:id', (c) => c.json({ status: 'completed' }));
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
  const runtime = createConversationRuntime(sessionId, {
    host: { ...transport, streamClient }, documents,
    localTools: {
      isLocalToolName: (name) => name === 'render_mermaid', isLocalToolRuntimeAvailable: () => true,
      isLocalToolPermissionRequired: () => false,
      getPermissionRequest: () => ({ requestId: 'native', toolName: 'render_mermaid', origin: 'fixture' }),
      async executeLocalTool(id, name, args) { executions.push({ id, name, args }); return { rendered: true }; },
      async decideLocalToolPermission(id, value) { decisions.push({ id, value }); },
      postLocalToolResult: transport.postLocalToolResult,
    },
    ...overrides,
  });
  await runtime.initialize();
  return {
    runtime, transport, deps, server, requests, executions, decisions, docs, sessionId,
    emit(streamId: string, type: string, data: Record<string, unknown>, sequence: number) {
      source!.publish(type, { streamId, data, sequence });
    },
    async replay() {
      const events = await deps.stream.readSessionEvents({ sessionId, fromSeq: 0, userId: 'user_test' });
      for (const event of events) source!.publish(event.eventType, { streamId: event.streamId, data: event.data, sequence: event.sequence });
    },
    dispose() { runtime.dispose(); streamClient.reset(); globalThis.fetch = originalFetch; },
  };
}
