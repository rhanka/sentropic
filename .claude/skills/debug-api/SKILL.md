---
name: debug-api
description: Investigate an API issue using logs, DB queries, and generation traces
paths: "api/src/**"
allowed-tools: Read Bash Grep Glob
---

## API Debug Toolkit

### 1. Logs
`make logs-api 2>&1 | grep -i "error\|warn\|fail" | tail -20`

### 2. DB inspection
- Status: `make db-status`
- Custom: `make db-query QUERY="SELECT ... LIMIT 5"`
- Chat traces (7-day retention): `make db-query QUERY="SELECT id, session_id, event_type, created_at FROM chat_generation_traces ORDER BY created_at DESC LIMIT 10"`
- Stream events: `make db-query QUERY="SELECT sequence, event_type, created_at FROM chat_stream_events WHERE stream_id='<id>' ORDER BY sequence"`

### 3. Health check
`curl -s http://localhost:${API_PORT:-8787}/api/v1/health | jq .`

### Methodology
1. Read error message / stack trace carefully
2. Identify chain: route → service → DB query
3. Check logs at the exact timestamp
4. Query DB for data state at that point
5. If streaming → check `chat_stream_events` sequence gaps
6. If provider → check `chat_generation_traces` for raw payload
7. Fix → `make test-api-endpoints SCOPE=<test-file> ENV=test-<branch>`
