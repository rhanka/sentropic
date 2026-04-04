---
name: debug-streaming
description: Debug SSE streaming, provider responses, and delta aggregation issues
paths: "api/src/services/llm-runtime/**,api/src/services/stream-service.ts,ui/src/lib/stores/streamHub.ts,ui/src/lib/components/StreamMessage.svelte"
allowed-tools: Read Bash Grep Glob
---

## Streaming Debug

### 1. Identify stream
`make db-query QUERY="SELECT id, status, provider_id FROM chat_sessions ORDER BY created_at DESC LIMIT 5"`

### 2. Check events (sequence gaps = problem)
`make db-query QUERY="SELECT sequence, event_type, length(data::text) as data_len FROM chat_stream_events WHERE stream_id='<ID>' ORDER BY sequence"`

### 3. Check generation trace
`make db-query QUERY="SELECT model, provider_id, input_tokens, output_tokens, error FROM chat_generation_traces WHERE session_id='<ID>' ORDER BY created_at DESC LIMIT 3"`

### 4. Provider-specific
- **OpenAI**: `reasoning_effort` param, Responses API vs Chat Completions dual mode
- **Gemini**: Schema sanitization (removes unsupported JSON schema keywords)
- **Claude**: `thinking.budget_tokens` format, tool_use block format
- **Mistral**: No reasoning equivalent, different tool format
- **Cohere**: Separate message/tool format

### 5. UI-side (StreamHub)
- Delta aggregation: `content_delta` events merged in streamHub.ts cache
- Extension proxy: Chrome SSE through `background.ts` → `connectExtensionProxySse()`
- LRU limit: 50 streams × 50 events — older events evicted

### 6. Fix verification
`make test-api-ai SCOPE=chat-sync ENV=test-$BRANCH`
