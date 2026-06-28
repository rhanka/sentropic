# @sentropic/mcp-platform (PRIVATE — mock-only scaffold)

> **Status: PRIVATE, unpublished, reversible scaffold.** This package is
> `"private": true`, is NOT wired into any publish filter / CI publish job /
> Makefile target / trusted-publisher config, and MUST NOT be published. It is a
> mock-only build of **slices 1 + 2 + 3 + 7** of
> `spec/SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM.md` (track `01KW2MHER6QE9WRW3SAJCNH3T8`).

> **Not in the root lockfile — do NOT root-install/activate (P1, architect/owner-gated).**
> The root workspace glob (`workspaces: ["packages/*"]`) would auto-enlist this
> package on the next root `npm install`, but the committed root `package-lock.json`
> intentionally has **no `mcp-platform` entry** and MUST NOT gain one in this branch.
> Adding it to the root lock is effectively **package activation (P1)** and is gated
> on architect/owner approval (see `rules/architecture.md` "Package extraction must
> be activated by real app consumption"). Until then, verify this package with its
> own ephemeral toolchain (below), never via a root install. Do not modify root
> `package.json` or `package-lock.json`.

## What this is

A faithful, app-neutral TypeScript scaffold of the generic Sentropic/STP MCP
provider platform contract, plus an in-memory test harness that proves the
security-critical isolation properties — with **no real network, no production
credentials, no real Claude.ai dependency, no DB, and no `mcp-wave` coupling**.

Wave / immo are consumers/examples only; nothing domain-specific is baked in.

### Slice 1 — manifest & adapter schemas (`src/manifest.ts`, `src/runtime.ts`)

Concrete TypeScript for the spec §4 closed schemas:

- `AppMcpProviderManifest`, `CapabilityResource` / `CapabilityTool` /
  `CapabilityPrompt`, `AppCapability`;
- `RedactionClass`, `Mutability`, `IdempotencyRequirement`, `CapabilityGates`,
  `AuthFreshnessPolicy`, `ConnectorSecretRequirement`,
  `ConnectorTenantResolutionInput`, `ConnectorTenantContext`;
- `StpConnectorContext` (audited just-in-time `getSecret` accessor — no plaintext
  map), `AppConnectorProviderAdapter`;
- request/result envelopes, `DurableCallRef` (`== DurableCall.id`),
  session/consent/enrollment/secret records, `ConnectorVisibilityState`,
  `McpDurableCallRefs`.

Read-only capabilities (resources, prompts) declare the closed read-only
exception explicitly (`mutatesExternalSystem: false`,
`idempotency: { required: false }`).

### Slice 2 — mock harness + middleware + tests

- `src/mock/oidc.ts` — in-memory mock OIDC issuer: EdDSA-signed tokens with
  `sub` / `aud` / `scope` / `auth_time` / `tid`, a public JWKS, and a revocation
  list. Uses only Node's built-in `crypto` (no external dep, no network).
- `src/mock/mcp-transport.ts` — in-memory mock MCP client/server transport with
  per-session client binding.
- `src/mock/fake-connector.ts` — app-neutral fake connector adapter fixture.
- `src/authz.ts` — per-request authz middleware stub: audience-bound token
  verification, principal+tenant derived **from the token only** (never from
  tool/model-supplied ids), per-capability scope + freshness checks,
  deny-as-missing discovery, and mutation gating (gate + idempotency + audit).
- `src/elicitation.ts` — fail-closed elicitation state machine (resume / cancel /
  timeout / denied, anti-phishing sub-match, NHI fail-closed).
- `src/audit.ts` / `src/context.ts` — in-memory audit sink + redaction and the
  audited secret accessor backing `StpConnectorContext.getSecret`.

### Slice 3 — restart-safe mock persistence + §11 persistence probes

Closes the review-identified coverage gap (the §6.3 records + §6.4 secret status
were type-only and the §11 persistence probes were not exercised).

- `src/persistence.ts` — generic restart-safe `RecordStore<T>` primitive. Two
  backings: `MemoryRecordStore` (non-durable default; restart simulated via
  `MemoryRecordStore.fromSnapshot(store.snapshot())`) and `FileRecordStore` (a
  durable JSON file under the **OS tmp dir, never in the repo**; a brand-new
  instance at the same path = a genuine process restart, with `reload()` /
  `snapshot()`). NO real DB/driver/network.
- `src/stores.ts` — typed `SessionStore` / `ConsentStore` / `EnrollmentStore` /
  `SecretStatusStore` / `ElicitationStore` ports over `RecordStore<T>`, backing
  the §6.3 (`McpSession`, `ConsentGrant`, `ConnectorEnrollment`), §6.4
  (`SecretStatus`, composite key `(principalSub, tenantRef, workspaceRef?,
  connectorInstanceId, name)`) and §5.1 (`ElicitationRecord`) records. All
  resolution is fail-closed (non-`active`/expired/missing → deny).
- `elicitation.ts` / `context.ts` / `authz.ts` now resolve their §5.1 / §6.4 /
  §6.3 state THROUGH these stores (default backing = non-durable in-memory, so
  the F1-F9 security fixes and the existing suite are unchanged; inject a
  `FileRecordStore` for restart-safety). Secret VALUES are NEVER written to the
  durable medium — only status crosses the boundary (§5.2(b) / §11 no-leak).
- `tests/persistence-store.test.ts` + `tests/persistence.test.ts` — the §11
  probe matrix: restart lookup survives reload; session/consent expiry denied
  after reload; revoked-session denial; consent revocation persists; secret-status
  non-active persists fail-closed (and no value on the durable medium); enrollment
  revocation persists → `no_enrollment` after restart (F1 across restart);
  elicitation resume-after-restart + the resumed gate stays bound to
  capability/session/principal post-reload (no replay).

### Slice 7 — mock durable-call / workflow adapter for long-running tools

Models a long-running MCP tool call via the canonical `DurableCall` lifecycle
(§8 -> `SPEC_EVOL_AGENT_RUNTIME_HERMES_LOOP.md` §3.2), restart-safe over the
slice-3 persistence layer. The canonical `DurableCall` shape is **not forked**:
MCP correlation is threaded alongside it (`McpDurableCall = { call, refs,
waitingFor? }`).

- `src/runtime.ts` — adds the canonical `DurableCall` / `DurableCallKind` /
  `DurableCallState` types (verbatim from Hermes §3.2) and the MCP projection
  `McpDurableCall` (canonical record + `McpDurableCallRefs` + the `waiting`
  qualifier `DurableCallWaitingFor`).
- `src/durable.ts` — `PersistentDurableCallStore` (a `DurableCallStore` over the
  slice-3 `RecordStore<T>`, so durable calls survive a restart) + `DurableCallAdapter`:
  `launch` / `start` / `wait(reason)` / `resume` / `succeed` / `fail` / `cancel` /
  `status`. Lifecycle `queued -> running -> waiting -> succeeded|failed|cancelled`,
  with `waiting` qualified by `elicitation|consent|freshness|external-workflow`.
  - **Idempotent launch**: a repeated launch with the same `idempotencyKey`
    returns the SAME durable call — never a duplicate.
  - **Fail-closed resume**: a `waiting` call only resumes once its wait condition
    is cleared (elicitation gate released via the slice-2 `ElicitationManager`, or
    an injected `isWaitCleared` resolver for consent/freshness/external-workflow;
    absent resolver = never clears). `succeed` is reachable only from `running`, so
    a waiting-on-consent call can never succeed until consent is present.
  - **Audited**: every transition emits a redacted audit event carrying
    ids/state/refs only — never a token, secret value or PII.
- `src/mock/fake-connector.ts` — adds a long-running, workflow-backed tool
  `export_widgets` (declared in `manifest.durability.longRunningTools` /
  `workflowBackedTools`). Its `invokeTool` returns a `DurableCallRef` instead of
  an inline result (via the injected `launchDurable`); fails closed when no
  durable backend is wired.
- `tests/durable.test.ts` — the §8 / §11 "Long call lifecycle" probes:
  queue->run->wait(elicitation)->resume->succeed; cancel-from-waiting; failure
  path; idempotent re-launch returns same id; mid-flight call survives a restart
  (reload) and resumes; waiting-on-consent cannot succeed until consent present;
  no token/secret in durable-call audit; long-tool returns a `DurableCallRef`.

## Running the gates (mock, in-memory)

There is no Makefile target for this private package by design. Run the package's
own tooling inside the repo's Docker node image, mirroring the other packages:

```sh
# typecheck
docker run --rm -v "$PWD:/workspace" -w /workspace/packages/mcp-platform \
  node:24-bookworm-slim sh -lc 'tool_dir="$(mktemp -d)"; \
  npm install --prefix "$tool_dir" --no-save typescript@5.4.5 @types/node >/dev/null; \
  "$tool_dir/node_modules/.bin/tsc" --noEmit -p tsconfig.json'

# tests
docker run --rm -v "$PWD:/workspace" -w /workspace/packages/mcp-platform \
  node:24-bookworm-slim sh -lc 'tool_dir="$(mktemp -d)"; \
  npm install --prefix "$tool_dir" --no-save vitest@4.0.18 typescript@5.4.5 @types/node >/dev/null; \
  NODE_PATH="$tool_dir/node_modules" "$tool_dir/node_modules/.bin/vitest" run tests --environment node'
```

Real validation against Claude.ai or another external MCP client is UAT, not a CI
dependency (spec §11).
