import { createChatServer, createInMemoryChatServerDeps } from '../../../chat-server/src/index.js';
import { createDefaultTransport } from '../../src/client/transport.js';
import { createStreamHub } from '../../src/client/streamHub.js';
import { createConversationRuntime, type ConversationRuntimeOptions } from '../../src/state/conversationRuntime.js';
import type { DocumentHost } from '@sentropic/chat-runtime/documents';
import { registerLocalTool, unregisterLocalTool, LocalToolPermissionRequiredError } from '../../src/stores/localTools.js';
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
export async function createConversationFixture(overrides: Partial<ConversationRuntimeOptions> = {}, platform: { nativePermissions?: boolean } = {}) {
  registerLocalTool({ name: 'render_mermaid', description: 'Diagram', parameters: {} });
  const requests: Array<{ method: string; path: string; body: unknown }> = [];
  const executions: Array<{ id: string; name: string; args: unknown }> = [];
  const decisions: Array<{ id: string; value: string }> = [];
  const nativeDecisions = new Map<string, boolean>();
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
