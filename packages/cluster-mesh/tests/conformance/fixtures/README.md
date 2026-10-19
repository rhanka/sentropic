# Immo baseline provenance and compatibility decisions

The two JSON files are exact Git blobs from radar-immobilier, commit
`8ef6b7190165035a19e994f5e765e774bb7101c7` (Radar #866), original paths
`packages/immo-mcp/src/fixtures/immo-tools.v1.json` and
`packages/immo-mcp/src/fixtures/immo-deployed-baseline.v1.json`.
The tools SHA-256 is
`31487e8fb9b85019fc707ed3a7296e33156c46fb5fd3071d456d6dae1b44d998`.
Never regenerate this baseline to accommodate wrapper output.

Pinned server-http.ts uses subject equality and client equality only when both
tokens expose azp/client_id. Idle expiry is 1,800,000 ms, absolute expiry
28,800,000 ms, both strictly greater-than boundaries. Only accepted owner
requests refresh lastSeenAt. The host owns these rules and timestamps.
Its current mutable toolCtx.auth and raw-token forwarding must be removed by the
Radar adapter, with an admission barrier that drains old calls, enumerates
existing public McpServer.server objects, replaces both request handlers,
and registers future servers before connect. An inaccessible map cannot wrap.
Failed installation keeps admission closed; it never restores old dispatch.

BRWRAP-D1: the pinned host sets no explicit raw-request, argument, result or
schema byte/depth limits. New limits therefore require host compatibility
qualification; they are not claimed as unchanged deployed behavior. Package
tests choose raw request 32 MiB, arguments 16 MiB / depth 64, results 32 MiB /
depth 64, schemas 2 MiB / depth 128. Hosts supply every positive limit explicitly.
The request bound must apply to the entire body before parsing. These budgets
preserve all pinned captures; larger live payloads remain an L5 qualification.

All twelve captured tools are native SDK CallToolResult handlers. HTTP captures
include synthetic search_signals data, five not_wired_yet domain stubs and raw
404 responses; simulation is recorded separately. Test handlers replay these
envelopes only to qualify package transport contracts.

The current mcp-auth 0.1.0 coarse-scope response is 401. Radar adopts 0.2.2 only
inside 2b-MCP, qualifying 403 insufficient_scope and canonical challenge URLs
separately. Preserve both public metadata routes. No auth dependency change,
live signal parity, token exchange, production cutover or #865 receiver
qualification is implied by library conformance. #865 remains excluded from
Radar candidate SHAs until its same-environment 2b-MCP cutover receipt.
