# @sentropic/mcp-broker

MCP-L5 Lot 1: a **plan-bound MCP provider broker** with the frozen memory
contract entry. `McpProviderBroker` dispatches against the immutable
compiled registry plan; adapters are bound once at construction from that
plan and consumers cannot register handlers separately or replace it.
Every invocation requires a verified host `StpConnectorContext` — the
broker never manufactures identity, and a missing or untrusted context
throws the M2 pre-dispatch protocol error (-32603) before any provider
contact. The pure memory contract entry ships under `./memory`; the
durable reference store is available under `./memory-reference` in Lot 2.

`SqliteMemoryWorkflowStoreV1.open(absolutePath)` explicitly activates built-in
SQLite on unflagged Node 22.13+, 23.4+ or the qualified Node 24 line. Root and
contract imports do not activate it. The file must be owned by the process;
the reference uses WAL, FULL durability, a 1000 ms busy timeout and immediate
transactions. Qualification assumes a local filesystem supporting SQLite WAL.

The host supplies current authorization, immutable policy versions, resolved
effective inputs and trusted audit before reservation. A claim carries a finite
lease and monotonic workflow fence; the host must check the lease/cancellation
boundary and independently enforce the canonical engine's fence at its commit.
Destructive claims additionally require persisted, operation-bound confirmation
and current assurance. No reservation or canonical proof is compacted away.

`reconcile` accepts only the host's authenticated canonical proof lookup, never
caller arguments. It records the original replay result; it cannot commit a
canonical effect. Expired executions remain unresolved until proof is found;
an unknown outcome cannot authorize another execution. `complete` requires
current disclosure authorization. This reference does not implement PostgreSQL
ownership, the Engram engine, production enrollment or an OIDC service.

`make memory-l5-reference ENV=test-mem-l5-lot2` runs source-reference tests.
`make memory-l5-test LOT=2 ARTIFACT_MANIFEST=... ENV=test-mem-l5-lot2`
first requires a verified P3/E2/host manifest and sidecar.
The committed `lot2-manifest.unverified.json` is a refusal fixture. Real installed
E2/host crash/replay acceptance and the final E4 rerun remain separate gates.

Memory selection combines the compiled tool's human-confirmation/elicitation
gates, the host's `ctx.memory.confirmationRequired` and mandatory destructive
confirmation. A required elicitation reference is checked before provider contact.
The selection and `AppInvocationEnvelope.memoryConfirmationRequired` retain that
effective policy alongside the unchanged A03 projection. Selection refusals use
the frozen public error codes; missing trusted audit remains protocol `-32603`.

## What's here

- `src/registry.ts` — **internal** plan-derived connector index (not a
  public entry): mounts adapters for the providers present in the compiled
  plan. Duplicate mounts throw the typed `duplicate_connector` error;
  adapters for unknown providers are refused at construction.
- `src/context.ts` — `SecretResolver` contract type only. The in-memory
  context factory is deleted with no compatibility fallback.
- `src/broker.ts` — `McpProviderBroker`: `listConnectors()`,
  `listCapabilities(connectorId, ctx)` and
  `invoke(connectorId, capabilityRef, input, opts)` with required trusted
  `opts.ctx`. Resource-vs-tool dispatch is decided from the capability's
  OWN declared `kind`. Memory tools additionally resolve their exact plan
  entry, provider/connector source binding and scope/claim coverage, and
  bind the neutral context projection before the adapter is contacted.
  Throws `UnknownConnectorError` for an unmounted `connectorId`; guards
  the `DurableCallRef` string return.
- `src/memory/` — pure frozen memory contract entry (`./memory`):
  closed source-binding records and verified compiled dispatch
  (`CompiledMemoryDispatch`, `MemoryDispatchRefusal`).
- `src/index.ts` — frozen public entry: `McpProviderBroker`,
  `McpBrokerError`, `UnknownConnectorError`, `InvokeOptions`,
  `SecretResolver`. No testing export, no compatibility fallback.

## Proof scope

- `tests/broker.test.ts` — **HERMETIC**, no real network. Plan-bound
  dispatch with explicit verified contexts: duplicate-mount refusal,
  trusted-context requirement (-32603), resource URI building, unknown
  connector/capability behavior and the `DurableCallRef` guard.
- `tests/memory/` — **HERMETIC** memory seam proofs: verified invocation
  context, source binding, forged-call refusal, literal-true verdicts and
  M2 audit refusal, with zero unauthorized handler or effect calls.
- `scripts/smoke-broker-github.mjs` — the LIVE proof (manual-only, never
  in CI): mounts the REAL github live adapter and performs a REAL network
  call to `https://api.github.com`.

## Make targets

- `make typecheck-mcp-broker`
- `make test-mcp-broker` (hermetic; `SCOPE=` selects files)
- `make build-mcp-broker`
- `make pack-mcp-broker`
- `make smoke-mcp-broker-github` — REAL network, not hermetic, never wired into CI

## Non-goals (this lot)

- No durable reference store — `./memory-reference` arrives in Lot 2.
- No real secret store / EnrollmentStore / TenantResolver.
- No durable-call tracking — a tool capability returning a `DurableCallRef`
  (string) is guarded and rejected, not queued/polled.
