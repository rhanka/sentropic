import type { ChatCoreHost } from '../client/chat-core-host.js';
import type { ChatSessionRuntime } from './chatSessionRuntime.js';
import { createNdjsonSplitter, parseSessionHistoryLine } from './chatSessionHydration.js';

/** Hydrate history into the session that survives view mounts and placement changes. */
export async function hydrateConversationHistory(
  session: ChatSessionRuntime,
  host: ChatCoreHost,
  isCurrent: () => boolean,
): Promise<void> {
  const sessionId = session.snapshot().sessionId;
  const response = await host.fetchSessionHistory(sessionId, 'full');
  if (!response.ok) throw new Error(`History request failed: ${response.status}`);
  if (!response.body || !isCurrent()) return;
  const splitter = createNdjsonSplitter();
  const reader = response.body.getReader();
  const applyLine = (raw: string) => {
    if (!isCurrent()) return;
    const line = parseSessionHistoryLine(raw);
    if (!line) return;
    if (line.type === 'session_meta') {
      if (line.sessionId !== sessionId) throw new Error('History session mismatch');
      session.hydrateMessages([], line);
    } else if (line.type === 'timeline_item') {
      const item = line.item;
      session.hydrateMessages([item.message]);
      if (item.kind !== 'message') session.mergeHistoryEvents(item.message.id, [...item.segment.events]);
    }
  };
  try {
    while (isCurrent()) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const line of splitter.push(value)) applyLine(line);
    }
    const tail = splitter.flush();
    if (tail) applyLine(tail);
  } finally {
    if (!isCurrent()) await reader.cancel();
    reader.releaseLock();
  }
}
