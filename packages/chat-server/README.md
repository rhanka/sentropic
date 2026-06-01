# @sentropic/chat-server

Configurable Hono chat wire server for Sentropic-compatible apps.

This package owns HTTP/SSE route shapes and adapter contracts. Persistence,
queueing, generation, and authorization stay behind injected ports so the
package can run with either Postgres-backed app adapters or deterministic
in-memory adapters.
