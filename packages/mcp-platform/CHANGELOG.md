# Changelog

## 0.4.2

- Guarantee a terminal JSON-RPC response for every request id on the HTTP surface: a throw
  from the connector port, the invocation port or the auth context on `POST /` now returns
  `{jsonrpc:'2.0', id, error:{code:-32603}}` instead of escaping to a bare 500; the REST
  `/invoke` and `/resources/read` handlers return a stable `internal_error` JSON body instead
  of hanging; on the `/mcp` streamable mount a throw from `server.connect`/`handleRequest`
  closes the transport (SSE stream ends) and answers a JSON-RPC error envelope carrying the
  request id.

## 0.4.1

- Preserve opt-in domain outcomes in MCP JSON content, including invocation identity,
  commit state, replay status and typed error details. Decode the same envelope on
  both transports without duplicating content. Other providers retain their codec.
- Preserve additive typed error details in the compatible root-result projection.
