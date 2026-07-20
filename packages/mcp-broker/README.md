# @sentropic/mcp-broker

BR-72 DEPTH Lot 2 proof: a **minimal, connector-AGNOSTIC MCP provider broker** — private,
not published. It generalizes the "mount + invoke" seam proven per-connector in
`@sentropic/mcp-connector-github`'s live broker (BR-72 DEPTH Lot 1,
`../mcp-connector-github/src/live-broker.ts`) into a small library any
`@sentropic/mcp-platform` `AppConnectorProviderAdapter` can be mounted into and invoked
through, with **no connector-specific code in this package**. Production residence of a
broker like this one (in-process library vs. hosted service, real secret-store wiring,
tenant/enrollment resolution policy) is an **architect D4 decision, deferred** — this
package is a proof, not the shipped runtime.

## What's here

- `src/registry.ts` — `ConnectorRegistry`: `register(adapter)` / `get(connectorId)` /
  `list()`, keyed by `adapter.connectorId`. Throws `DuplicateConnectorError` on a
  duplicate `register()` for the same `connectorId`.
- `src/context.ts` — `createInMemoryContext(opts)`: a contract-complete, connector-agnostic
  in-memory `StpConnectorContext` factory generalized from the github live broker's
  `makeLiveConnectorContext`. **`getSecret` delegates to an injectable `opts.secretResolver`**
  — this is the seam a future EnrollmentStore / TenantResolver PORT plugs into; the factory
  deliberately does not pre-empt that PORT's shape, it only defines the injection point.
  `audit.emit` writes a REDACTED line to `console.error` by default (overridable via
  `opts.auditSink`); `logger` defaults to `console`.
- `src/broker.ts` — `McpProviderBroker`: `listConnectors()`, `listCapabilities(connectorId, ctx?)`
  (calls the adapter's own `resolveTenant()` + `listCapabilities()`), and
  `invoke(connectorId, capabilityRef, input, opts?)` — resource-vs-tool dispatch decided from
  the capability's OWN declared `kind` in the connector's manifest (never a per-connector
  allowlist). A resource capability's URI is built from its manifest `uriTemplate` by
  substituting `{param}` placeholders out of the caller-supplied `input` object — no
  connector-specific URI-building logic lives here (contrast with the github live broker's
  per-capability `buildResourceUri` switch, which this generalizes away). Throws
  `UnknownConnectorError` for an unmounted `connectorId`; guards the `DurableCallRef` string
  return of `invokeTool` the same way the github live broker does.
- `src/index.ts` — public entry: `ConnectorRegistry`, `McpProviderBroker`,
  `createInMemoryContext`, plus the typed error classes and option types.

## Proof scope

- `tests/broker.test.ts` — **HERMETIC**, no real network. Registers a mock
  `AppConnectorProviderAdapter`, invokes a resource capability and a tool capability through
  the broker, and asserts: correct dispatch + envelope shape, an unknown-connector typed
  error, a duplicate-register typed error, an unknown-capability error envelope, the
  `DurableCallRef` guard, and that `createInMemoryContext` produces every REQUIRED
  `StpConnectorContext` field (`../mcp-platform/src/runtime.ts`).
- `scripts/smoke-broker-github.mjs` — the LIVE proof: mounts the REAL github live adapter
  from `../mcp-connector-github/src/live-adapter.ts` (BR-72 DEPTH Lot 1) into a
  `ConnectorRegistry`, then calls
  `broker.invoke('github', 'get_repository', { owner: 'octocat', repo: 'Hello-World' })`
  — a REAL network call to `https://api.github.com` — and prints the real `full_name` /
  `stargazers_count`. This is the only file in this package that imports anything
  github-specific; it exists to prove the generic broker actually drives a real connector,
  not to make this package connector-aware.

## Make targets

- `make typecheck-mcp-broker`
- `make test-mcp-broker` (hermetic; `ENV=<slug>` accepted per repo convention, unused by
  this Node-only target but kept for command-style consistency)
- `make smoke-mcp-broker-github` — REAL network, not hermetic, never wired into CI (mirrors
  `make smoke-mcp-connector-github-live`'s rationale: shares GitHub's unauthenticated rate
  limit, manual-only by design)

## Non-goals (this proof)

- No real secret store / EnrollmentStore / TenantResolver — `createInMemoryContext`'s
  `secretResolver` is the seam that PORT will plug into later, not an implementation of it.
- No durable-call tracking — a tool capability returning a `DurableCallRef` (string) is
  guarded and rejected, not queued/polled.
- No production wiring, no publishing, no connector-specific logic outside the smoke script.
