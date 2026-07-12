# SPEC EVOL — `@sentropic/mcp-platform` Activation (private mock → publish-now with a narrow read-only freeze)

Status: **REVISED v3 — Codex 2nd-engine reconciled** — owner-decided **2026-07-11**: PUBLISH NOW with a **narrow read-only freeze** (freeze only the surface the openerp bank connector drives; ship mutation/elicitation/durable *execution* as unstable `./experimental`; add a type-level breaking-change gate). v2 = 2-peer Opus review; **v3 integrates the independent Codex 2nd-engine findings** (all CONFIRMED, architect-fixable): the root is **not leak-free yet** so publish is now a HARD gate (§7.5/§12); the manifest capability-classification vocabulary is DECLARATIVE metadata that stays frozen while only the EXECUTION path is experimental (§3, decision D-v3); the api-extractor gate is specified concretely, not promised (§7.5); `ConnectorSecretRequirement.scope` also gains `'operator'` (§4). Work package: **BR-42l** under **WP-CATALOG**. Broker STUDY **P1** activation.
Parent study: `spec/SPEC_STUDY_UNIVERSAL_CONNECTOR_ACCOUNT_BROKER.md` (P1 §0/§9-Phase0, narrow-freeze §6.2, decided/open §2.1, custody §4.3, 2FA/elicitation §5).
Platform socle: `spec/SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM.md` (manifest/adapter §4, elicitation §5, records §6.3/§6.4, visibility §7.1, durable §8).
First real consumer: `spec/SPEC_EVOL_BANK_CONNECTOR.md` (federated openerp adapter, **read-only**; operator-secret delta §4, egress boundary §3.1; gates P1 at B3).

## 0. Executive summary

`@sentropic/mcp-platform` is today a **private, `version: 0.0.0`, mock-only scaffold** with **zero external consumers** (`packages/mcp-platform/package.json:2-4`; grep of `@sentropic/mcp-platform` finds only the study/bank specs and `package-lock.json`, no `import`). The scaffold is faithful — it transcribes the full §4/§5/§6/§7/§8 contract — but exports **contract types and the mock harness through one flat entry** (`src/index.ts:10-159`), and is explicitly NOT root-locked.

The 2-peer review found the earlier "freeze `.` / unstable `./testing`" split **did not actually enforce the narrow freeze**. The owner narrowed the freeze to **only the read-only pure-adapter surface openerp drives** and moved the mutation/elicitation/durable **execution** surface to a **published-but-unstable `./experimental` tier**. The Codex 2nd engine then confirmed the **root is still not leak-free in source**: `index.ts:10-159` flat-exports `ElicitationPolicy` (`:23`), the `DurableCall` mirror (`:53`), `ElicitationManager` (`:92`), the guard (`:119`), the stores (`:132-147`), context/mock fixtures (`:84,:88`), and `AppMcpProviderManifest` still embeds `elicitation?: ElicitationPolicy[]` (`manifest.ts:177`). v3 therefore restates the split as a **hard pre-publish gate with a concrete check** (§7.5/§12), not a promise. A **real type-level gate (api-extractor + allowlist + banned-symbol grep)** replaces discipline as the enforcement. This is a **real activation chantier, not a `package.json` flip** (STUDY §6.2, §10.5).

**Decision D-v3 — declarative metadata vs execution path (reconciles the "read-only freeze still names mutation vocabulary" finding).** The frozen root legitimately keeps the manifest **capability-classification vocabulary** — `Mutability` (`manifest.ts:21`), `CapabilityGates`/`requiresElicitation` (`:30-34`), `CapabilityTool` (`:60-73`), `AppInvocationEnvelope.elicitationRef` (`runtime.ts:33`, a bare `string`), `durableCallRef?: DurableCallRef` (`runtime.ts:43`, `DurableCallRef = string` at `:22`). These are **DECLARATIVE**: a connector *describes* its capabilities (a read-only adapter still declares `mutability: 'read-only'`, `gates.requiresElicitation: false`, and may thread an opaque `elicitationRef`/`durableCallRef` *string*). Nothing here imports an unstable structure. What moves to `./experimental` is the **EXECUTION path only**: `assertMutationGate`/`invokeGuardedTool`/`GuardedInvokeDeps` (`guard.ts:55,86-99`), the `ElicitationManager` class (`elicitation.ts:99`) and its `ElicitationStore` dep (`stores.ts:193`), and the `ElicitationPolicy`/`DurableCall`-record shapes. Declarative metadata = frozen; enforcement machinery = experimental.

## 1. Goal and non-goals

### 1.1 Goal
- Remove `private: true`, bump `0.0.0 → 0.1.0`, add `files`/`publishConfig`/`exports`, wire CI paths-filter + validate/publish jobs + Make targets, bootstrap-publish, attach OIDC trusted publisher — a public, consumable, semver-governed contract package.
- Split the flat surface into **three tiers**: a **frozen root `.`** (read-only pure-adapter contract + declarative capability metadata per D-v3), a **published-but-unstable `./experimental`** (mutation-gate execution + elicitation machine + durable-call record mirror + store ports), and a **published-but-unstable `./testing`** (mocks/fixtures). Enforced by the **export map + a checked-in api-extractor report + a root-symbol allowlist + a banned-symbol grep** (§7.5), not by discipline.
- Absorb the bank-connector **operator-secret delta** into the frozen `SecretStatus` **and** `ConnectorSecretRequirement` from day one — but **only the `'operator'` union member** (the sole real break-risk); optional fields land additively later.
- Prove the frozen surface against **1 real read-only host flow** (openerp bank connector), importing **root-only**, not package-local mocks and not `./experimental`.

### 1.2 Non-goals for this activation
- No `AccessGrant` type, no `resource_grants` schema, no registry storage/catalog, no h2a↔Sentropic sync envelope in **any** published tier's frozen guarantee (STUDY §6.2, §2.1-open, §3.4).
- No cross-user/cross-agent semantics; no workspace-atom grants (needs ARCH-11 + AccessGrant).
- No egress SERVICE code (api/socle-owned, BR-42m/bank territory) — only the declarative seam + a normative invariant.
- No new connectors implemented here; the package stays app-neutral (no Wave/immo/bank leakage — platform §2.3).

## 2. Current state (grounded)

- `package.json:2-4` — `@sentropic/mcp-platform`, `0.0.0`, `private: true`; `exports` declares only `.` (types+import, ESM-only); no `files`, no `publishConfig`. Not in root `package-lock.json`.
- `src/index.ts:10-159` — one flat entry re-exporting **both** contract (`./manifest.js`, `./runtime.js`) **and** mock harness (`./mock/*`, `./audit.js:84`, `./context.js:88`, `./authz.js`, `./persistence.js`, `./stores.js:132-147`, `./durable.js`, `ElicitationManager:92`, `./guard.js:119`, `./digest.js:159`). This is the leak the split must eliminate.
- **Freeze-leak couplings (all CONFIRMED, MUST be broken before freeze):**
  - `AppMcpProviderManifest` (`manifest.ts:169`) carries `elicitation?: ElicitationPolicy[]` (`:177`), and `ElicitationPolicy` (`:138`) is **provisional/architect-gated (F8)** — a would-be-frozen manifest structurally imports an unstable type.
  - `ElicitationManager` (`elicitation.ts:99`) ctor references `ElicitationStore` (`stores.ts:193`).
  - `invokeGuardedTool`/`GuardedInvokeDeps` (`guard.ts:86-99`) reference the mock `InMemoryAuditSink` (`audit.ts`, imported `guard.ts:14`); `assertMutationGate` (`guard.ts:55`) references `ElicitationManager` (`guard.ts:13`).
- Pure read-only surface (no unstable import): manifest/capability types incl. the declarative-metadata vocabulary (D-v3), envelopes, `StpConnectorContext` (`runtime.ts:196`), `AppConnectorProviderAdapter` (`runtime.ts:245`), lifecycle records (`runtime.ts:57-104`), `ConnectorVisibilityState` (`runtime.ts:110`), `listVisibleCapabilities` (`guard.ts:27`, imports only `AppCapability`).
- No consumer imports the package yet: `mcp-wave` still uses the raw `@modelcontextprotocol/sdk`. The *current* real host flow is the openerp bank connector (bank B3), which is **read-only**.

## 3. Public API surface — three tiers

Enforced by the `exports` map **plus** the §7.5 gate (checked-in api-extractor report + root allowlist + banned-symbol grep). Only the root `.` carries a compat guarantee.

### 3.1 FROZEN — root `.` (read-only pure adapter + declarative metadata; public, semver-governed, gated)

Manifest & capability **classification metadata** — DECLARATIVE per D-v3 (`manifest.ts`, pure types; a read-only adapter populates them with read-only values):
- `RedactionClass`, `Mutability` (`:21`), `IdempotencyRequirement`, `CapabilityGates`/`requiresElicitation` (`:30-34`), `AuthFreshnessPolicy`.
- `CapabilityResource`, `CapabilityTool` (`:60-73`), `CapabilityPrompt`, `AppCapability` (closed schemas, incl. the closed read-only exception).
- `ConnectorSecretRequirement` (`:95-99`) — scope union **widened with `'operator'`** (§4), `ConnectorTenantResolutionInput`, `ConnectorTenantContext`.
- `AppMcpProviderManifest` — **with `elicitation?` REMOVED from the frozen shape** (refactor R1); a read-only adapter never declares elicitation policy. Elicitation re-attaches via an experimental manifest extension.

Scope vocabulary (frozen unions):
- `SecretStatus.scope` **with `'operator'`** (§4), `ConnectorSecretRequirement.scope` **with `'operator'`** (§4), `IdempotencyRequirement.scope`, `AppMcpProviderManifest.authz.tenantResolution`.

Runtime read/result contract (`runtime.ts`):
- Envelopes: `AppInvocationEnvelope` (incl. `elicitationRef?: string`, `:33`, a bare ref-passing string — no experimental structure), `AppToolInvocation`, `AppResourceRead`, `AppPromptRequest`, `AppResultEnvelope` (incl. `durableCallRef?: DurableCallRef`, `:43`), `AppToolResult`, `AppResourceResult`, `AppPromptResult`, `DurableCallRef` (`:22`, a bare `string` alias — carries no experimental structure).
- `StpConnectorContext` (`:196`, per-invocation envelope with audited `getSecret(name)`, `:234`), `AppConnectorProviderAdapter` (`:245`, the pure adapter contract). `invokeTool` may return `DurableCallRef` (string) without importing the experimental `DurableCall` record.
- Lifecycle records: `LifecycleState`, `McpSession`, `ConsentGrant`, `ConnectorEnrollment`, `SecretStatus`, `ConnectorSecretStatus`.

Visibility / deny-as-missing (read-only discovery only):
- `ConnectorVisibilityState` (`:110`), `VisibilityContext`; the pure, dependency-free, deterministic helper `listVisibleCapabilities` (`guard.ts:27`, published as a **stable helper**).

**Refactor R1 (build-time, this branch):** (a) split `guard.ts` so `listVisibleCapabilities`/`VisibilityContext` stay dependency-free while the mutation-gate execution (`assertMutationGate`/`invokeGuardedTool`/`GuardedInvokeDeps`) moves to the experimental entry; (b) drop `elicitation?` off the frozen `AppMcpProviderManifest`; (c) rewrite `src/index.ts` from a flat `export *`-style transcription into an **explicit hand-written allowlist re-export** of ONLY the §3.1 symbols (this is the pre-publish gate of §7.5(a)). Source today couples all three — the activation branch performs the extraction, not a callback bag.

### 3.2 UNSTABLE — `./experimental` (published, `@experimental`, NOT frozen, semver-exempt)

The mutation/elicitation/durable **execution + record** surface — real implementations, but not consumer-proven, so no compat guarantee. Per D-v3 this is the ENFORCEMENT machinery, distinct from the frozen declarative metadata:
- **Mutation-gate execution:** `MutationGateReason`, `MutationGateResult`, `assertMutationGate` (`guard.ts:55`), `invokeGuardedTool`/`GuardedInvokeDeps` (`guard.ts:86-99`, retyped against an **audit-sink PORT**, not the mock `InMemoryAuditSink`), `idempotencyDigest`.
- **Elicitation state machine:** `ElicitationState`, `ElicitationMode`, `ElicitationRecord`, `Completer`, `DelegationResolver`, `CreateInput`, and the `ElicitationManager` class (`elicitation.ts:99`, security-load-bearing, dependency-injectable store). Kept unstable so the transition contract can still harden before a stable pin (OQ2).
- **Provisional elicitation policy (F8):** `ElicitationPolicy`, `ElicitationPolicyMode`, `elicitationPolicyIsSecretSafe`, and the experimental manifest extension that re-adds `elicitation?` for mutation-capable hosts. Stays `@experimental` until the architect ratifies the canonical shape.
- **DurableCall record mirror (OQ4):** `DurableCall`, `DurableCallKind`, `DurableCallState`, `McpDurableCall`, `McpDurableCallRefs`, `DurableCallWaitingFor`. The canonical shape lives in Hermes (`SPEC_EVOL_AGENT_RUNTIME_HERMES_LOOP §3.2`), **not a published package** — consumers cannot `import` it. The mirror stays **experimental** until Hermes publishes; never frozen. (The frozen `DurableCallRef` string alias is the seam that lets the read-only root avoid this mirror entirely.)
- **Store PORT interfaces:** `SessionStore`, `ConsentStore`, `EnrollmentStore`, `SecretStatusStore`, `ElicitationStore`, `RecordStore` — real seams a DB/KMS host satisfies, not yet runtime-proven. If any *frozen* signature ever needs a store, only the **port interface** is promoted — never a persistent class.

### 3.3 UNSTABLE — `./testing` (published, `@internal`, NOT frozen, semver-exempt)

Mocks/fixtures/reference a real host replaces: `MockOidcIssuer`, `InMemoryMcpServer`/`InMemoryMcpClient`, `createFakeConnector`/`fakeManifest`, `InMemoryAuditSink`/`SecretRedactor`, `MockSecretStore`/`createStpConnectorContext` (`context.ts:126`), `authorizeRequest`/`resolveAuthorizedTenant`/`InMemoryTenantRegistry`/`InMemoryConsentRegistry`, `MemoryRecordStore`/`FileRecordStore`/`Persistent*Store`, `DurableCallAdapter`/`PersistentDurableCallStore`.

### 3.4 NOT published anywhere (gated OUT of the package)

- `AccessGrant` (broker policy/index record, STUDY §3.4) — lands with the broker. Consumers compose via the **opaque-ref seam already on the contract** (`consentRefs`, `grantRefs`, `enrollmentRef`, `mandateRef`), never by importing a grant type.
- `resource_grants` storage/schema, registry storage, tenant catalog, stable connector IDs, attestation-at-register (STUDY §2.1-open).
- local↔Sentropic sync envelope, custody/KMS-envelope schema, egress-service API (STUDY §4, bank §3).

## 4. Operator-secret delta absorption (bank connector §4/§3.1)

Baked into **both** frozen `SecretStatus` (`runtime.ts:96-101`) and frozen `ConnectorSecretRequirement` (`manifest.ts:95-99`) from `0.1.0` — **only the union widening**, since a union widening is the sole change that would break early consumers; optional fields are additive at any later minor and are deferred:

```ts
// runtime.ts SecretStatus
scope: 'operator' | 'principal' | 'tenant' | 'workspace' | 'connector-instance'; // + 'operator'
// manifest.ts ConnectorSecretRequirement (Codex finding: §4 "mirror" now COVERS this type explicitly)
scope: 'operator' | 'principal' | 'tenant' | 'workspace' | 'connector-instance'; // + 'operator'
// planned-additive (any later MINOR, no break): operatorRef?: string; rotationWindow?: { previousValidUntil: string }
```

- `'operator'` scope = platform-held, tenant-agnostic secret (e.g. Plaid `client_id`/`secret`), readable **only inside the egress boundary**, never by tenant/app/agent. `validateSecrets` still discloses **state only** (unchanged) — now covering `operator`. Both the *status* (`SecretStatus.scope`) and the *requirement* (`ConnectorSecretRequirement.scope`) carry the member so a manifest can DECLARE an operator secret and its status can be reported.
- **`operatorRef` / `rotationWindow` are NOT in 0.1.0.** Optional fields (multi-operator addressing, dual-key rotation overlap) addable at any later minor with zero break; shipping them now would freeze speculative shape before a consumer drives them. Planned-additive.
- **Egress-boundary `getSecret` invariant — NORMATIVE, not a package type guarantee.** The package ships the `getSecret(name)` **signature** (`runtime.ts:234`, per-call audited, NAME-only) and a **conformance test**, but cannot *type-guarantee* that a host dereferences raw only inside the active egress boundary. Invariant: raw crosses only inside the boundary; outside, only handles/normalized data. The mock `createStpConnectorContext` (`context.ts:149-172`) **dereferences raw and is out-of-scope test material** — a fixture, not the guarantee; hosts MUST NOT read it as the contract. Enforcement = the bank spec's negative tests (state-only disclosure, resolver-only-in-boundary, revocation-wins) run in the socle gate.
- **`secretsEgress` residence — RESOLVED to the manifest (OQ3):** an optional additive `secretsEgress?: { mode: 'sentropic-egress' | 'in-boundary' }` on `AppMcpProviderManifest`. Optional ⇒ additive at any later minor ⇒ NOT required in 0.1.0 (planned-additive; the read-only openerp flow does not need routing declared).
- The **egress service itself is out of scope** (api/socle-owned; bulkheads/quotas/mTLS per bank §3.2/G9). The package owns only the type + the `getSecret` invariant + its conformance test.

## 5. Consumer co-design (1 real read-only host flow — not package-local mocks)

Per the contract-consumer-codesign rule, the frozen surface is validated by a real consumer during activation, not by `createFakeConnector`.

- **Primary anchor — openerp bank connector (federated, pure adapter, READ-ONLY).** Bank B3 **explicitly gates on P1 activation**. Acceptance = openerp's `packages/bank-connector` implements `AppConnectorProviderAdapter` (manifest + `resolveTenant` + read-only `invokeTool`/`readResource` threading `StpConnectorContext` into every call, bank §5) against the **published root `.` only**, mono-tenant/synthetic-OFX, with the operator-secret tier + deny-as-missing for an unconsented `itemRef`. It **MUST import root-only — nothing from `./experimental` and nothing from `./testing`** — proving the freeze is correctly narrow (no mutation-gate execution, no elicitation machine, no durable-call record in a read-only flow). This root-only import constraint is a checked DoD item (§12).
- **Secondary — Wave migration.** `mcp-wave` currently uses the raw MCP SDK. Migrating Wave onto the adapter contract (read-only first, STUDY §8.2) is the second validator; when Wave needs mutation it drives `./experimental` and helps promote pieces toward frozen. Follow-up, not a P1 blocker.
- **Tertiary — immo.** Federated consumer of the same contract; validates pure-adapter/no-custody a second time. Awaited, not gating.
- Design rule: any field a consumer needs but the frozen root lacks is added **additively** and re-validated against openerp before it is called frozen (npm-publish-consumability lesson).

## 6. Boundaries & state residence

- **Connector = pure `AppConnectorProviderAdapter`.** No catalog ownership, no credential custody, no registry storage (platform §2.2; openerp stays federated).
- **Catalog = separate** (BR-70 resource-plane / BR-42i/j) — connector IDs, tenant catalog, discovery projection.
- **Control-plane UI = separate** (BR-42m) — inventory/enrollment/grant surfaces (STUDY §7).
- **Egress service = api/socle** (bank §3.1/§3.2) — raw-secret dereferencing, bulkheads, quotas.
- **State residence:** the package owns **type contracts + a reference injectable enforcement kernel (`./experimental`) only**. Durable state (sessions, consent, enrollment, secret-status, elicitation) resides in the **consuming runtime** (control-plane DB/KMS) behind the experimental store ports; the package never mandates a store. `AccessGrant`/`resource_grants` residence stays with the broker/ARCH-11.

## 7. Publish mechanics

Mirror the established `@sentropic/mcp-auth` pattern (`Makefile:857-892`, `.github/workflows/ci.yml:1362-1374`).

1. **Un-private + package fields:** drop `private: true`; add `"publishConfig": { "access": "public" }`, `"files": ["dist","README.md","LICENSE"]`, and extend the `exports` map (today `.` only, ESM) to `.`, `./experimental`, `./testing` — each declaring **both `import` and `require` conditions** (dual-emit ESM+CJS) so CJS consumers can `require()` the contract; if a subpath is ESM-only, state it explicitly and gate it. (llm-mesh `package.json` is the template.)
2. **Version:** `0.0.0 → 0.1.0` (first real minor; 0.x = additive-first — §8). `1.0.0` deferred until ARCH-11/AccessGrant so the surface can widen additively (OQ5).
3. **Min-TS statement:** declare the supported TypeScript floor (via `typesVersions`/documented engines) so the frozen `.d.ts` is consumable on a known baseline; CI type-checks the report on that floor.
4. **Root lockfile:** add to the root workspace lock (activation = real consumption). Un-private makes `enforce-package-bump` cover it (`ci.yml:65-70` skips private only).
5. **Bootstrap first publish:** `workflow_dispatch` `bootstrap_publish_target: mcp-platform` → `make publish-mcp-platform-token` using `NPM_TOKEN`. First publish only.
6. **Attach OIDC trusted publisher:** after bootstrap, drive `npmjs.com /access` (Playwright) to attach the OIDC trusted publisher; steady-state publishes run token-free (npm-trusted-publisher-via-playwright).
7. **Make targets:** add `build-mcp-platform`, `publish-mcp-platform` (OIDC/`id-token`), `publish-mcp-platform-token` (`NPM_TOKEN_FILE` bootstrap) + `api-extract-mcp-platform` (the §7.5 gate) — copy the mcp-auth block, swap path/name.
8. **CI paths-filter + jobs:** add `mcp_platform` + `mcp_platform_publish` filters (guard the paths-filter staleness footgun — omitting `packages/mcp-platform/**` silently skips publish), a `validate-mcp-platform` job (build + the §7.5 gate), and a `publish-mcp-platform` job gated `github.ref == 'refs/heads/main'` with `permissions: id-token: write`. **The publish job depends on `validate-mcp-platform` passing — the §7.5 gate BLOCKS publish (§12).**

### 7.5 Type-level breaking-change gate (the enforcement, specified concretely)

The v2 spec named "api-extractor" but under-specified it. Codex correctly noted **api-extractor diffs a report and trims by release tag; it does NOT by itself classify SemVer nor auto-catch an *untagged* symbol that leaks**. The gate is therefore **api-extractor + two independent checks the reviewer/CI runs**, all wired into `validate-mcp-platform`:

1. **TSDoc release tags as the leak-check basis.** Tag every exported symbol: root `.` symbols `@public`; `./experimental` symbols `@experimental`; `./testing` symbols `@internal`. api-extractor's `apiReport` + `stripInternal`/release-tag trimming produce the root report from these tags.
2. **Entrypoint & config.** `api-extractor.json` with `mainEntryPointFilePath: <dist>/index.d.ts` (root `.` ONLY — the experimental/testing entries are excluded from the gate), `apiReport.enabled: true`, `dtsRollup.enabled: true`, `bundledPackages` as needed. The gate runs api-extractor over the ROOT rollup only.
3. **Checked-in `.api.md` baseline.** Commit `packages/mcp-platform/etc/mcp-platform.api.md`. api-extractor runs in CI with `--local false` (verify mode): **any diff between the generated report and the committed baseline FAILS CI**. A legitimate root change requires the author to regenerate + commit the baseline in the same PR.
4. **Explicit root-symbol ALLOWLIST (the untagged-leak catch api-extractor misses).** A checked-in `packages/mcp-platform/etc/root-allowlist.json` enumerating the EXACT §3.1 exported symbol names. `validate-mcp-platform` asserts `symbols(dist/index.d.ts) === allowlist` — a set equality. A newly exported symbol that someone forgot to tag `@experimental` still appears in the root `.d.ts` and thus FAILS the set-equality check, even though api-extractor's tag-trim would have passed it. This is the artifact that makes the freeze real, not tag-discipline.
5. **Banned-symbol / banned-path grep.** CI greps `src/index.ts` for any import from `./guard`, `./elicitation`, `./stores`, `./durable`, `./mock/*`, `./audit`, `./context`, `./authz`, `./persistence`, `./digest`, or a re-export of `ElicitationPolicy`/`ElicitationManager`/`DurableCall`/`assertMutationGate`/`invokeGuardedTool` — any hit FAILS (belt-and-braces with the allowlist; catches a leak at source before build). Symmetrically greps the generated root `.d.ts` for `@internal`/`@experimental`/`@alpha`/`@beta` release tags — any hit FAILS.
6. **Export-map + `files` diff + version-bump check.** CI diffs the `exports` map and `files` array against the committed `package.json`; a change to either without a version bump FAILS. `enforce-package-bump` (now covering the un-private package) requires the version to move on any surface change. **SemVer class is enforced by a human-checked rule keyed to the `.api.md` diff** (widening/new-optional/new-subpath = minor; remove/rename/required-add = major) — api-extractor supplies the diff; the reviewer + the bump check enforce the class. `./experimental` and `./testing` are exempt from steps 2-6.

## 8. Versioning & compatibility

- **Additive-first, 0.x.** New optional fields, new union members, new subpath exports = **minor**; renames/removals/required-field additions = **major**. The §7.5 gate surfaces each root diff for classification (not auto-classified — §7.5(6)).
- The **operator union member ships in `0.1.0`** (on both `SecretStatus.scope` and `ConnectorSecretRequirement.scope`) precisely to avoid a breaking union-widening once bank/broker consume it. Optional operator fields (`operatorRef`, `rotationWindow`, `secretsEgress`) are deferred as planned-additive minors.
- **Deprecation lifecycle:** a frozen root symbol is retired by (1) `@deprecated` in a **minor** (the `.api.md` report records it), (2) kept for **≥1 subsequent minor** with the replacement available, (3) removed **only at the next major**. No frozen field is removed inside 0.x.
- The **opaque-ref seam** (`consentRefs`/`grantRefs`/`enrollmentRef`/`mandateRef`) is the forward-compat hinge: `AccessGrant` arrives later as a *separate* type these refs point at, with **zero change** to the frozen root.
- `./experimental` and `./testing` are **explicitly exempt** from semver and from the gate — hosts are warned (README + `@experimental`/`@internal` tags) not to depend on them in production; anything promoted to root first passes the openerp validation.

## 9. Phasing & what stays gated

- **P1a (this spec):** three-tier split + R1 refactor (incl. the hand-written allowlist `index.ts`), operator union member on both types, un-private + publish + OIDC + the §7.5 gate live, openerp read-only root-only co-design. No ARCH-11 dependency.
- **P1b:** Wave migration onto the contract (read-only, then first `./experimental` mutation consumer), second validator; promote consumer-proven `./experimental` pieces toward frozen.
- **Gated OUT (needs ARCH-11 / AccessGrant / 39h — STUDY §9 Phase 2-4):** canonical grant storage, workspace-atom grants, deny-as-missing over `resource_grants`, cross-agent/cross-user modes, h2a↔Sentropic sync, Sentropic-managed cross-org custody, real bank data (bank G1-G10). None enter the `0.1.0` frozen root; they compose later via the opaque-ref seam and separate packages.

## 10. Risks

- **Freeze-not-enforced (top finding, RESTATED by Codex — the root is not leak-free in source today, `index.ts:10-159`):** mitigated by R1(c) hand-written allowlist `index.ts`, the §7.5 gate (checked-in `.api.md` + root allowlist set-equality + banned-symbol grep), and the publish job depending on `validate-mcp-platform`. **Residual:** the gate is only as good as the committed allowlist/baseline — a reviewer who regenerates both to bless a bad change defeats it; mitigated by the human SemVer-class rule + openerp root-only proof, not by tooling alone.
- **Declarative-vs-execution mislabeling (D-v3):** a future edit could add an unstable *structure* to a declarative metadata type (e.g. re-embed `ElicitationPolicy` on the manifest). Caught by the set-equality allowlist (new symbol) and the banned-symbol grep (`ElicitationPolicy` re-export).
- **Freeze-too-narrow for Wave / mutation hosts:** mutation/elicitation execution ships in `./experimental` now (usable, unstable); early adopters unblocked without a frozen-shape lock; consumer-proven pieces promote additively.
- **Egress invariant is normative, not typed:** a host could mis-handle a raw secret → enforced by the bank negative tests + the package conformance test, documented as a socle-gate contract (not a package type claim).
- **DurableCall record drift:** Hermes is unpublished, so the mirror can diverge → kept `./experimental` + a transcription-parity note pointing at Hermes §3.2; promote to frozen only when Hermes publishes and a consumer drives it. The frozen root avoids the record entirely via the `DurableCallRef` string alias.
- **Store-port premature freeze:** ports stay `./experimental` until control-plane consumes them.
- **Bootstrap/OIDC + paths-filter drift:** explicit filter + a post-publish `npm view` check in the Make target (mcp-auth pattern).

## 11. Resolved owner decisions

1. **OQ1 — tier packaging:** RESOLVED → single package with `.` / `./experimental` / `./testing` **subpaths** + the §7.5 gate. **Not** a separate `@sentropic/mcp-platform-testing` package.
2. **OQ2 — `ElicitationManager`:** RESOLVED → `./experimental` (types + class), unstable until the transition contract is consumer-hardened.
3. **OQ3 — `secretsEgress`/egress residence:** RESOLVED → **manifest field** (optional, additive); deferred, not in 0.1.0.
4. **OQ4 — `DurableCall` record mirror:** RESOLVED → **experimental mirror** (Hermes unpublished); never frozen until Hermes publishes. Frozen root uses only the `DurableCallRef` string alias.
5. **OQ5 — version start:** RESOLVED → **`0.1.0`**; `1.0.0` deferred until ARCH-11/AccessGrant.
6. **D-v3 — declarative metadata vs execution path (2026-07-11):** RESOLVED → capability-classification vocabulary (`Mutability`/`CapabilityGates`/`requiresElicitation`/`CapabilityTool`/`elicitationRef`/`durableCallRef`) is DECLARATIVE and FROZEN; only the enforcement machinery (`assertMutationGate`/`invokeGuardedTool`/`ElicitationManager`/`ElicitationPolicy`/`DurableCall` record) is `./experimental`.

## 12. Acceptance / DoD

**HARD PUBLISH GATE — publish is BLOCKED until BOTH hold (Codex finding: the root is not leak-free today):**
- **(a)** the post-split `src/index.ts` is an **explicit hand-written allowlist re-export** of ONLY the §3.1 frozen symbols (no `export *`, no re-export of guard/elicitation/stores/durable/mock/context/audit — verified by the §7.5(5) banned-symbol grep); and
- **(b)** the **api-report artifact proves ZERO `@experimental`/`@internal` symbols (and zero `./experimental`/`./testing`-sourced symbols) in the root surface** — via the checked-in `etc/mcp-platform.api.md` diff + the `etc/root-allowlist.json` set-equality check (§7.5(3)(4)) + the `.d.ts` release-tag grep (§7.5(5)).

Remaining DoD:
- `@sentropic/mcp-platform@0.1.0` published public via OIDC trusted publisher; `npm view` resolves; root lockfile includes it; `enforce-package-bump` green.
- Root `.` exports **only** the frozen §3.1 surface; mutation/elicitation/durable *execution*+record under `./experimental`; mocks under `./testing`. `ElicitationPolicy`, `ElicitationManager`, the mutation-gate execution and the `DurableCall` record are **not** in root `.`.
- **§7.5 gate live in `validate-mcp-platform` and RED on:** any un-baselined root `.api.md` change; any root-allowlist set mismatch; any banned import in `src/index.ts`; any `@internal`/`@experimental` tag in the root `.d.ts`; any `exports`/`files` change without a version bump. `publish-mcp-platform` depends on it.
- R1 refactor applied: `guard.ts` split (read-only `listVisibleCapabilities` frozen; mutation-gate execution experimental); `AppMcpProviderManifest` frozen shape carries **no** `elicitation?`; `src/index.ts` rewritten to the hand-written allowlist.
- `SecretStatus.scope` **and** `ConnectorSecretRequirement.scope` carry the `'operator'` union member and **not** `operatorRef`/`rotationWindow` (planned-additive).
- **Pre-publish conformance tests (locations/names):**
  - `packages/mcp-platform/tests/root-surface.test.ts` — asserts the package-root export set equals `etc/root-allowlist.json` and that no `./experimental`/`./testing` symbol is reachable from root (the type-level freeze, as a runtime assertion).
  - `packages/mcp-platform/tests/operator-scope.test.ts` — `SecretStatus` and `ConnectorSecretRequirement` accept `scope: 'operator'`; `validateSecrets` reports operator status **state-only**.
  - `packages/mcp-platform/tests/secrets.test.ts` (existing) — extended: state-only disclosure covers `operator`; fail-closed on missing/revoked.
  - `packages/mcp-platform/tests/egress-boundary.conformance.test.ts` — `getSecret(name)` is NAME-only audited (never the value) and fail-closed (`context.ts:149-172` as fixture-under-test, asserted as the reference behaviour, NOT the guarantee).
- `exports` map declares `import` + `require` (or a stated ESM-only exception); supported minimum TypeScript version documented.
- openerp `bank-connector` implements `AppConnectorProviderAdapter` against the **published root `.` only** (read-only, mono-tenant), importing **nothing from `./experimental` or `./testing`** — proving the surface end-to-end without `AccessGrant`/registry/sync.
- No domain (Wave/immo/bank) leakage into the package; `mcp-wave` repo untouched (platform §2.3).
