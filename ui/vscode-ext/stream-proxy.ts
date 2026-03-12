export type VsCodeSseProxyStartInput = {
  baseUrl: string;
  workspaceId?: string | null;
  streamIds?: string[];
  authToken?: string | null;
};

export type VsCodeSseProxyMessage =
  | {
      type: 'sse_event';
      eventType: string;
      payload: unknown;
    }
  | {
      type: 'sse_error';
      error: string;
    }
  | {
      type: 'sse_closed';
    };

type SseFrame = {
  eventType: string;
  payload: unknown;
};

const normalizeEventData = (raw: string): unknown => {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    return { raw: trimmed };
  }
};

const createSseFrameParser = (emit: (frame: SseFrame) => void) => {
  let buffer = '';
  let eventType = 'message';
  let dataLines: string[] = [];

  const flushEvent = () => {
    if (dataLines.length === 0) {
      eventType = 'message';
      return;
    }
    const payload = normalizeEventData(dataLines.join('\n'));
    emit({
      eventType: eventType || 'message',
      payload,
    });
    eventType = 'message';
    dataLines = [];
  };

  const processLine = (rawLine: string) => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (!line) {
      flushEvent();
      return;
    }
    if (line.startsWith(':')) return;
    if (line.startsWith('event:')) {
      eventType = line.slice('event:'.length).trim() || 'message';
      return;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    }
  };

  return {
    pushChunk(chunk: string) {
      if (!chunk) return;
      buffer += chunk;
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        processLine(line);
        newlineIndex = buffer.indexOf('\n');
      }
    },
    flush() {
      if (buffer.trim().length > 0) {
        processLine(buffer);
      }
      buffer = '';
      flushEvent();
    },
  };
};

export const buildSseProxyUrl = (input: {
  baseUrl: string;
  workspaceId?: string | null;
  streamIds?: string[];
}): string => {
  const baseUrl = input.baseUrl.replace(/\/$/, '');
  const url = new URL(`${baseUrl}/streams/sse`);
  if (input.workspaceId && input.workspaceId.trim().length > 0) {
    url.searchParams.set('workspace_id', input.workspaceId.trim());
  }
  for (const streamId of input.streamIds ?? []) {
    const normalized = String(streamId ?? '').trim();
    if (!normalized) continue;
    url.searchParams.append('streamIds', normalized);
  }
  return url.toString();
};

export const runVsCodeSseProxy = async (
  input: VsCodeSseProxyStartInput,
  deps: {
    signal: AbortSignal;
    emit: (message: VsCodeSseProxyMessage) => void;
    fetchImpl?: typeof fetch;
  },
): Promise<void> => {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const targetUrl = buildSseProxyUrl({
    baseUrl: input.baseUrl,
    workspaceId: input.workspaceId ?? null,
    streamIds: input.streamIds ?? [],
  });

  const headers = new Headers();
  if (typeof input.authToken === 'string' && input.authToken.trim().length > 0) {
    headers.set('authorization', `Bearer ${input.authToken.trim()}`);
  }
  headers.set('accept', 'text/event-stream');

  const response = await fetchImpl(targetUrl, {
    method: 'GET',
    headers,
    signal: deps.signal,
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`SSE proxy upstream failed (${response.status} ${response.statusText})`);
  }
  if (!response.body) {
    throw new Error('SSE proxy upstream returned an empty body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseFrameParser((frame) => {
    deps.emit({
      type: 'sse_event',
      eventType: frame.eventType,
      payload: frame.payload,
    });
  });

  while (!deps.signal.aborted) {
    const { value, done } = await reader.read();
    if (done) break;
    parser.pushChunk(decoder.decode(value, { stream: true }));
  }
  parser.pushChunk(decoder.decode());
  parser.flush();
};
