# @sentropic/mcp-platform

> **Status: ACTIVATING (BR-42l) — public `0.1.0`, narrow read-only freeze.**
> Generic Sentropic/STP MCP **provider** platform contract. Published with a deliberately
> narrow frozen surface (the read-only pure-adapter contract a federated connector drives);
> the mutation/elicitation/durable surface ships published-but-unstable under `./experimental`.
> Authoritative: `spec/SPEC_EVOL_MCP_PLATFORM_ACTIVATION.md` (owner-decided); socle:
> `spec/SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM.md`.

## Public API — three tiers

The `exports` map (not discipline) enforces the tiers; only the root `.` carries a compat guarantee.

- **`.` (root) — FROZEN, semver-governed** (§3.1): the read-only pure-adapter contract —
  manifest & capability classification, read/result envelopes, lifecycle records,
  `StpConnectorContext`, `AppConnectorProviderAdapter`, `SecretStatus` (incl. the
  `'operator'` scope) and the dependency-free `listVisibleCapabilities`. A read-only
  connector imports ONLY this. `1.0.0` deferred (0.x additive-first).
- **`./experimental` — `@experimental`, NOT frozen, semver-exempt**: the mutation gate,
  the elicitation state machine + provisional policy (F8), the DurableCall mirror, and the
  store PORT interfaces. Usable but unstable — do not depend on it in production; pieces get
  promoted to the frozen root additively once a real consumer proves them.
- **`./testing` — `@internal`, NOT frozen**: mocks/fixtures/reference (mock OIDC, in-memory
  MCP transport, fake connector, in-memory audit/secret/tenant/consent/durable stores) that
  a real host replaces.

_The internal composition below (build slices 1/2/3/7) describes what lives in each tier._

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

### §12 slice coverage map

This package realizes a subset of the spec §12 "reversible build slices" as a
**mock-only** scaffold. The code comments use an internal build-slice ordering
(**1** schemas, **2** mock harness + middleware, **3** persistence, **7**
durable-call) that consolidates several §12 concepts into single commits; this
ordering is NOT the spec §12 item numbering. The table below is keyed to the
**authoritative spec §12 list** so a reader can cross-reference precisely.

| spec §12 item | status | realized in (build-slice) |
| --- | --- | --- |
| 1. App-neutral manifest & adapter schemas | **REALIZED** | `src/manifest.ts`, `src/runtime.ts` (slice 1) |
| 2. Mock OIDC + mock MCP harness | **REALIZED** | `src/mock/oidc.ts` (`MockOidcIssuer`), `src/mock/mcp-transport.ts` (slice 2) |
| 3. MCP session storage interface + in-memory impl | **REALIZED** | `src/stores.ts` (`PersistentSessionStore`), `src/persistence.ts` (slice 3) |
| 4. Capability registry projection | **REALIZED (single-connector)** — SUBSUMED into discovery | `src/guard.ts` `listVisibleCapabilities`, `ConnectorVisibilityState` (slice 2). Cross-connector multiplexer → item 10 |
| 5. Per-request authz middleware + tenant resolver port | **REALIZED** | `src/authz.ts` (`authorizeRequest`, `TenantResolver`, `ConsentResolver`) (slice 2) |
| 6. Elicitation protocol + surface-neutral renderer contract | **REALIZED (protocol)** | `src/elicitation.ts` (`ElicitationManager`); typed modes / provisional `ElicitationPolicy` (F8, architect-gated). No UI renderer (no UI surface) (slice 2) |
| 7. Audit/redaction event schema | **REALIZED** | `src/audit.ts` (`AuditEvent`, `SecretRedactor`, `InMemoryAuditSink`) (slice 2) |
| 8. Secret lifecycle interface + redacted diagnostics | **REALIZED** | `src/context.ts` (`MockSecretStore`, audited `getSecret`), `src/stores.ts` (`PersistentSecretStatusStore`, status-only) (slice 2/3) |
| 9. DurableCall/workflow adapter for long-running tools | **REALIZED** | `src/durable.ts` (`DurableCallAdapter`, `PersistentDurableCallStore`) (slice 7) |
| 10. STP connector discovery/multiplexer read-only projection | **PARTIAL** — discovery realized; cross-connector multiplexer DEFERRED | `src/guard.ts` `listVisibleCapabilities` + `ConnectorVisibilityState` (single fake connector only) |
| 11. Sample fake-data connector/provider | **REALIZED** (worked example) | `src/mock/fake-connector.ts` (`createFakeConnector`, `fakeManifest`) (slice 2) |
| 12. Wave adapter migration guide/probes | **DEFERRED — NOT in this branch** | out of scope; `mcp-wave` MUST NOT be touched here |
| 13. Domain provider adoption guide | **DOC** | `docs/ADOPTION_GUIDE.md` (with item 11 as the worked example) |

**Disposition:** public `0.1.0` under BR-42l, narrow read-only freeze. The frozen root `.`
carries no real network / production credentials / Claude.ai dependency / DB / `mcp-wave`
coupling — the in-memory mocks are `./testing` fixtures a real host replaces. The **first
bootstrap-publish (owner 2FA) and the broker-aware impl-freeze remain owner-gated** (see
`spec/SPEC_EVOL_MCP_PLATFORM_ACTIVATION.md`); the api-extractor golden-report gate enforces
the frozen surface before publish.

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
