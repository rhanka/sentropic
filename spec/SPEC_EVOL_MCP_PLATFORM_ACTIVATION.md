# SPEC EVOL — `@sentropic/mcp-platform` Activation (private mock → publish-now with a narrow read-only freeze)

Status: **REVISED v2** — owner-decided **2026-07-11**: PUBLISH NOW with a **narrow read-only freeze** (freeze only the surface the openerp bank connector drives; ship mutation/elicitation/durable as unstable `./experimental`; add a type-level breaking-change gate). 2-peer Opus adversarial review reconciled into this revision; **Codex review owed** (pre-merge gate). Work package: **BR-42l** under **WP-CATALOG**. Broker STUDY **P1** activation.
Parent study: `spec/SPEC_STUDY_UNIVERSAL_CONNECTOR_ACCOUNT_BROKER.md` (P1 §0/§9-Phase0, narrow-freeze §6.2, decided/open §2.1, custody §4.3, 2FA/elicitation §5).
Platform socle: `spec/SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM.md` (manifest/adapter §4, elicitation §5, records §6.3/§6.4, visibility §7.1, durable §8).
First real consumer: `spec/SPEC_EVOL_BANK_CONNECTOR.md` (federated openerp adapter, **read-only**; operator-secret delta §4, egress boundary §3.1; gates P1 at B3).

## 0. Executive summary

`@sentropic/mcp-platform` is today a **private, `version: 0.0.0`, mock-only scaffold** with **zero external consumers** (`packages/mcp-platform/package.json:2-4`; grep of `@sentropic/mcp-platform` finds only the study/bank specs and `package-lock.json`, no `import`). The scaffold is faithful — it transcribes the full §4/§5/§6/§7/§8 contract — but exports **contract types and the mock harness through one flat entry** (`src/index.ts`), and is explicitly NOT root-locked (README top matter).

The 2-peer review found the earlier "freeze `.` / unstable `./testing`" split **did not actually enforce the narrow freeze**: the proposed frozen root still structurally imported unstable types (elicitation store, mock audit sink, provisional elicitation policy). The owner therefore narrowed the freeze to **only the read-only pure-adapter surface the openerp bank connector drives**, and moved the entire mutation/elicitation/durable surface to a **published-but-unstable `./experimental` tier**. A **real type-level gate (api-extractor)** replaces discipline as the enforcement. This is a **real activation chantier, not a `package.json` flip** (STUDY §6.2, §10.5).

## 1. Goal and non-goals

### 1.1 Goal
- Remove `private: true`, bump `0.0.0 → 0.1.0`, add `files`/`publishConfig`/`exports`, wire CI paths-filter + validate/publish jobs + Make targets, bootstrap-publish, attach OIDC trusted publisher — a public, consumable, semver-governed contract package.
- Split the flat surface into **three tiers**: a **frozen root `.`** (read-only pure adapter contract only), a **published-but-unstable `./experimental`** (mutation gate + elicitation machine + durable-call mirror + store ports), and a **published-but-unstable `./testing`** (mocks/fixtures). The narrow freeze is enforced by the **export map + an api-extractor golden report**, not by discipline.
- Absorb the bank-connector **operator-secret delta** into the frozen `SecretStatus` from day one — but **only the `'operator'` union member** (the sole real break-risk); optional fields land additively later.
- Prove the frozen surface against **1 real read-only host flow** (openerp bank connector), not package-local mocks.

### 1.2 Non-goals for this activation
- No `AccessGrant` type, no `resource_grants` schema, no registry storage/catalog, no h2a↔Sentropic sync envelope in **any** published tier's frozen guarantee (STUDY §6.2, §2.1-open, §3.4).
- No cross-user/cross-agent semantics; no workspace-atom grants (needs ARCH-11 + AccessGrant).
- No egress SERVICE code (api/socle-owned, BR-42m/bank territory) — only the declarative seam + a normative invariant.
- No new connectors implemented here; the package stays app-neutral (no Wave/immo/bank leakage — platform §2.3).

## 2. Current state (grounded)

- `package.json:2-4` — `@sentropic/mcp-platform`, `0.0.0`, `private: true`; no `files`, no `publishConfig`, no `exports`. Not in root `package-lock.json`.
- `src/index.ts` — one flat entry re-exporting **both** contract (`./manifest.js`, `./runtime.js`) **and** mock harness (`./mock/*`, `./audit.js`, `./context.js`, `./authz.js`, `./persistence.js`, `./stores.js`, `./durable.js`, `ElicitationManager`, `./guard.js`, `./digest.js`).
- **Freeze-leak couplings found by review (all CONFIRMED, MUST be broken before freeze):**
  - `AppMcpProviderManifest` (`manifest.ts:169`) carries `elicitation?: ElicitationPolicy[]` (`:177`), and `ElicitationPolicy` (`:138`) is **provisional/architect-gated (F8)** — so the would-be-frozen manifest structurally imports an unstable type.
  - `ElicitationManager` (`elicitation.ts:99`) ctor references `ElicitationStore` (`stores.ts:193`).
  - `invokeGuardedTool` / `GuardedInvokeDeps` (`guard.ts:86-99`) reference the mock `InMemoryAuditSink` (`audit.ts`), and `assertMutationGate` (`guard.ts:55`) references `ElicitationManager`.
- Pure read-only surface (no unstable import): manifest/capability types, envelopes, `StpConnectorContext` (`runtime.ts:196`), `AppConnectorProviderAdapter` (`runtime.ts:245`), lifecycle records (`runtime.ts:57-104`), `ConnectorVisibilityState` (`runtime.ts:110`), `listVisibleCapabilities` (`guard.ts:27`, imports only `AppCapability`).
- No consumer imports the package yet: `mcp-wave` still uses the raw `@modelcontextprotocol/sdk` and does **not** import `@sentropic/mcp-platform`. Wave is *prospective*; the *current* real host flow is the openerp bank connector (bank B3), which is **read-only**.

## 3. Public API surface — three tiers

Enforced by the `exports` map **and** an api-extractor golden report gate (§7.5). Only the root `.` carries a compat guarantee.

### 3.1 FROZEN — root `.` (read-only pure adapter; public, semver-governed, api-extractor-gated)

Manifest & capability classification (`manifest.ts`, pure types):
- `RedactionClass`, `Mutability`, `IdempotencyRequirement`, `CapabilityGates`, `AuthFreshnessPolicy`.
- `CapabilityResource`, `CapabilityTool`, `CapabilityPrompt`, `AppCapability` (closed schemas, incl. the closed read-only exception).
- `ConnectorSecretRequirement`, `ConnectorTenantResolutionInput`, `ConnectorTenantContext`.
- `AppMcpProviderManifest` — **with `elicitation?` REMOVED from the frozen shape** (see refactor R1); a read-only adapter never declares elicitation policy. Elicitation re-attaches via an experimental manifest extension.

Scope vocabulary:
- `SecretStatus.scope` union **with the new `'operator'` member** (§4), `ConnectorSecretRequirement.scope`, `IdempotencyRequirement.scope`, `AppMcpProviderManifest.authz.tenantResolution`.

Runtime read/result contract (`runtime.ts`):
- Envelopes: `AppInvocationEnvelope`, `AppToolInvocation`, `AppResourceRead`, `AppPromptRequest`, `AppResultEnvelope`, `AppToolResult`, `AppResourceResult`, `AppPromptResult`, `DurableCallRef` (a bare `string` alias — carries no experimental structure).
- `StpConnectorContext` (per-invocation envelope with audited `getSecret(name)`), `AppConnectorProviderAdapter` (the pure adapter contract). `invokeTool` may return `DurableCallRef` (string) without importing the experimental `DurableCall` shape.
- Lifecycle records: `LifecycleState`, `McpSession`, `ConsentGrant`, `ConnectorEnrollment`, `SecretStatus`, `ConnectorSecretStatus`.

Visibility / deny-as-missing (read-only discovery only):
- `ConnectorVisibilityState`, `VisibilityContext`; the pure, dependency-free, deterministic helper `listVisibleCapabilities` (published as a **stable helper**).

**Refactor R1 (build-time, this branch):** split `guard.ts` so `listVisibleCapabilities`/`VisibilityContext` stay dependency-free; drop `elicitation?` off the frozen `AppMcpProviderManifest`. Source today couples both — the activation branch performs the extraction, not a callback bag.

### 3.2 UNSTABLE — `./experimental` (published, `@experimental`, NOT frozen, semver-exempt)

The mutation/elicitation/durable/store surface — real implementations, but not consumer-proven, so no compat guarantee:
- **Mutation gate:** `MutationGateReason`, `MutationGateResult`, `assertMutationGate`, `invokeGuardedTool`, `GuardedInvokeDeps` (retyped against an **audit-sink PORT**, not the mock `InMemoryAuditSink`), `idempotencyDigest`.
- **Elicitation state machine:** `ElicitationState`, `ElicitationMode`, `ElicitationRecord`, `Completer`, `DelegationResolver`, `CreateInput`, and the `ElicitationManager` class (security-load-bearing, dependency-injectable store). Kept unstable so the transition contract can still harden before a stable pin (OQ2).
- **Provisional elicitation policy (F8):** `ElicitationPolicy`, `ElicitationPolicyMode`, `elicitationPolicyIsSecretSafe`, and the experimental manifest extension that re-adds `elicitation?` for mutation-capable hosts. Stays `@experimental` until the architect ratifies the canonical shape.
- **DurableCall mirror (OQ4):** `DurableCall`, `DurableCallKind`, `DurableCallState`, `McpDurableCall`, `McpDurableCallRefs`, `DurableCallWaitingFor`. The canonical shape lives in Hermes (`SPEC_EVOL_AGENT_RUNTIME_HERMES_LOOP §3.2`), **which is not a published package** — so consumers cannot `import` it. The mirror stays **internal/experimental** until Hermes publishes; it is never frozen (a frozen mirror would lock a shape this package does not own).
- **Store PORT interfaces:** `SessionStore`, `ConsentStore`, `EnrollmentStore`, `SecretStatusStore`, `ElicitationStore`, `RecordStore` — real seams a DB/KMS host satisfies, but not yet runtime-proven (no control-plane consumer). If any *frozen* signature ever needs a store, only the **port interface** is promoted — never a persistent class.

### 3.3 UNSTABLE — `./testing` (published, `@internal`, NOT frozen, semver-exempt)

Mocks/fixtures/reference a real host replaces: `MockOidcIssuer`, `InMemoryMcpServer`/`InMemoryMcpClient`, `createFakeConnector`/`fakeManifest`, `InMemoryAuditSink`/`SecretRedactor`, `MockSecretStore`/`createStpConnectorContext`, `authorizeRequest`/`resolveAuthorizedTenant`/`InMemoryTenantRegistry`/`InMemoryConsentRegistry`, `MemoryRecordStore`/`FileRecordStore`/`Persistent*Store`, `DurableCallAdapter`/`PersistentDurableCallStore`.

### 3.4 NOT published anywhere (gated OUT of the package)

- `AccessGrant` (broker policy/index record, STUDY §3.4) — lands with the broker. Consumers compose via the **opaque-ref seam already on the contract** (`consentRefs`, `grantRefs`, `enrollmentRef`, `mandateRef`), never by importing a grant type.
- `resource_grants` storage/schema, registry storage, tenant catalog, stable connector IDs, attestation-at-register (STUDY §2.1-open).
- local↔Sentropic sync envelope, custody/KMS-envelope schema, egress-service API (STUDY §4, bank §3).

## 4. Operator-secret delta absorption (bank connector §4/§3.1)

Baked into frozen `SecretStatus` from `0.1.0` — **only the union widening**, since a union widening is the sole change that would break early consumers; optional fields are additive at any later minor and are therefore deferred:

```ts
export type SecretStatus = {
  name: string;
  scope: 'operator' | 'principal' | 'tenant' | 'workspace' | 'connector-instance'; // + 'operator' (the ONLY 0.1.0 break-risk)
  state: LifecycleState; // present-and-active vs revoked/expired/suspended
  rotatedAt?: string;
};
// planned-additive (any later MINOR, no break): operatorRef?: string; rotationWindow?: { previousValidUntil: string }
```

- `'operator'` scope = platform-held, tenant-agnostic secret (e.g. Plaid `client_id`/`secret`), readable **only inside the egress boundary**, never by tenant/app/agent. `validateSecrets` still discloses **state only** (unchanged) — now covering `operator`. Mirror the new member on `ConnectorSecretRequirement.scope`.
- **`operatorRef` / `rotationWindow` are NOT in 0.1.0.** They are optional fields (multi-operator addressing, dual-key rotation overlap) that can be added at any later minor with zero break; shipping them now would freeze speculative shape before a consumer drives them. Noted as planned-additive.
- **Egress-boundary `getSecret` invariant — NORMATIVE, not a package type guarantee.** The package ships the `getSecret(name)` **signature** (`runtime.ts:234`, per-call audited, NAME-only) and a **reference/conformance test**, but cannot *type-guarantee* that a host dereferences raw only inside the active egress boundary. The invariant is documented and normative: raw crosses only inside the boundary; outside, only handles/normalized data. The mock `createStpConnectorContext` (`context.ts:149`) **dereferences raw and is out-of-scope test material** — a fixture, not the guarantee; hosts MUST NOT read it as the contract. Enforcement = the bank spec's negative tests (state-only disclosure, resolver-only-in-boundary, revocation-wins) run in the socle gate.
- **`secretsEgress` residence — RESOLVED to the manifest (OQ3):** an optional additive `secretsEgress?: { mode: 'sentropic-egress' | 'in-boundary' }` field on `AppMcpProviderManifest`. Because it is optional it is **additive at any later minor** and is NOT required in 0.1.0 (deferred as planned-additive; the read-only openerp flow does not need routing declared).
- The **egress service itself is out of scope** (api/socle-owned; bulkheads/quotas/mTLS per bank §3.2/G9). The package owns only the type + the `getSecret` invariant + its conformance test.

## 5. Consumer co-design (1 real read-only host flow — not package-local mocks)

Per the contract-consumer-codesign rule, the frozen surface is validated by a real consumer during activation, not by `createFakeConnector`.

- **Primary anchor — openerp bank connector (federated, pure adapter, READ-ONLY).** Bank B3 **explicitly gates on P1 activation**. Acceptance = openerp's `packages/bank-connector` implements `AppConnectorProviderAdapter` (manifest + `resolveTenant` + read-only `invokeTool`/`readResource` threading `StpConnectorContext` into every call, bank §5) against the **published root `.`**, mono-tenant/synthetic-OFX, with the operator-secret tier + deny-as-missing for an unconsented `itemRef`. This exercises exactly the frozen root: manifest, capability classification, scope vocab (incl. `operator`), context, `SecretStatus` delta, read-only visibility. It imports **nothing from `./experimental`** — proving the freeze is correctly narrow (no mutation gate, no elicitation, no durable call in a read-only flow).
- **Secondary — Wave migration.** `mcp-wave` currently uses the raw MCP SDK. Migrating Wave onto the adapter contract (read-only first, STUDY §8.2) is the second validator; when Wave needs mutation it drives `./experimental` and helps promote pieces of it toward frozen. Follow-up, not a P1 blocker.
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

1. **Un-private + package fields:** drop `private: true`; add `"publishConfig": { "access": "public" }`, `"files": ["dist","README.md","LICENSE"]`, and an `exports` map with `.`, `./experimental`, `./testing` — each declaring **both `import` and `require` conditions** (dual-emit ESM+CJS) so CJS consumers can `require()` the contract; if a subpath is ESM-only, state it explicitly and gate it. (llm-mesh `package.json` is the template.)
2. **Version:** `0.0.0 → 0.1.0` (first real minor; 0.x = additive-first — §8). `1.0.0` deferred until ARCH-11/AccessGrant so the surface can still widen additively (OQ5).
3. **Min-TS statement:** declare the supported TypeScript floor for consumers (via `typesVersions`/documented engines) so the frozen `.d.ts` is consumable on a known baseline; CI type-checks the golden report on that floor.
4. **Root lockfile:** add to the root workspace lock (activation = real consumption). Un-private makes `enforce-package-bump` cover it (`ci.yml:65-70` skips private only).
5. **Type-level breaking-change gate (NEW — the enforcement, not prose):** an **api-extractor** job (or a tsd golden `.api.md`) runs against the root `.` `.d.ts`, emits a checked-in **golden API report**, and **FAILS CI on any diff to the root surface** not accompanied by (a) an updated report and (b) a semver bump matching the change class (widening = minor, remove/rename/required-add = major). The same job runs `stripInternal`/report trimming so **no `@internal` or `@experimental` symbol leaks into the root `.d.ts`** (verified, not assumed). `./experimental` and `./testing` are excluded from the gate.
6. **Make targets:** add `build-mcp-platform`, `publish-mcp-platform` (OIDC/`id-token`), `publish-mcp-platform-token` (`NPM_TOKEN_FILE` bootstrap) + an `api-extract-mcp-platform` check — copy the mcp-auth block, swap path/name.
7. **CI paths-filter + jobs:** add `mcp_platform` + `mcp_platform_publish` filters (guard the paths-filter staleness footgun — omitting `packages/mcp-platform/**` silently skips publish), a `validate-mcp-platform` job (build + api-extractor gate), and a `publish-mcp-platform` job gated `github.ref == 'refs/heads/main'` with `permissions: id-token: write`.
8. **Bootstrap first publish:** `workflow_dispatch` `bootstrap_publish_target: mcp-platform` → `make publish-mcp-platform-token` using `NPM_TOKEN`. First publish only.
9. **Attach OIDC trusted publisher:** after bootstrap, drive `npmjs.com /access` (Playwright) to attach the OIDC trusted publisher; steady-state publishes run token-free (npm-trusted-publisher-via-playwright).

## 8. Versioning & compatibility

- **Additive-first, 0.x.** New optional fields, new union members, new subpath exports = **minor**; renames/removals/required-field additions = **major**. The api-extractor gate mechanically classifies each root diff (§7.5).
- The **operator union member ships in `0.1.0`** precisely to avoid a breaking union-widening once bank/broker consume it. Optional operator fields (`operatorRef`, `rotationWindow`, `secretsEgress`) are deferred as planned-additive minors.
- **Deprecation lifecycle (how a frozen field retires):** a frozen root symbol is retired by (1) marking it `@deprecated` in a **minor** (api-extractor records it; the golden report shows the deprecation), (2) keeping it for **≥1 subsequent minor** with the replacement available, (3) removing it **only at the next major**. No frozen field is ever removed inside 0.x; before 1.0.0 a deprecation is carried, not dropped.
- The **opaque-ref seam** (`consentRefs`/`grantRefs`/`enrollmentRef`/`mandateRef`) is the forward-compat hinge: `AccessGrant` arrives later as a *separate* type these refs point at, with **zero change** to the frozen root.
- `./experimental` and `./testing` are **explicitly exempt** from semver and from the gate — hosts are warned (README + `@experimental`/`@internal` tags) not to depend on them in production; anything promoted to root first passes the openerp validation.

## 9. Phasing & what stays gated

- **P1a (this spec):** three-tier split + R1 refactor, operator union member, un-private + publish + OIDC + api-extractor gate, openerp read-only co-design. No ARCH-11 dependency.
- **P1b:** Wave migration onto the contract (read-only, then first `./experimental` mutation consumer), second validator; promote consumer-proven `./experimental` pieces toward frozen.
- **Gated OUT (needs ARCH-11 / AccessGrant / 39h — STUDY §9 Phase 2-4):** canonical grant storage, workspace-atom grants, deny-as-missing over `resource_grants`, cross-agent/cross-user modes (`explicit-validation`/`assisted`), h2a↔Sentropic sync, Sentropic-managed cross-org custody, real bank data (bank G1-G10). None enter the `0.1.0` frozen root; they compose later via the opaque-ref seam and separate packages.

## 10. Risks

- **Freeze-not-enforced (was the top review finding):** mitigated by moving every unstable-typed symbol to `./experimental`, the R1 refactor (guard split + manifest `elicitation?` removal), and the **api-extractor gate** that fails on any `@internal`/`@experimental` leak into the root `.d.ts`.
- **Freeze-too-narrow for Wave / mutation hosts:** mutation/elicitation ship in `./experimental` now (usable, unstable), so early mutation adopters are unblocked without a frozen-shape lock; consumer-proven pieces promote additively.
- **Egress invariant is normative, not typed:** a host could still mis-handle a raw secret → enforced by the bank negative tests + the package conformance test, and documented as a contract the socle gate checks (not a package type claim).
- **DurableCall mirror drift:** Hermes is unpublished, so the mirror can silently diverge → kept `./experimental` + a transcription-parity note pointing at Hermes §3.2; promote to frozen only when Hermes publishes and a consumer drives it.
- **Store-port premature freeze:** ports stay `./experimental` until control-plane consumes them (no wrong-shape lock).
- **Bootstrap/OIDC + paths-filter drift:** explicit filter + a post-publish `npm view` check in the Make target (mcp-auth pattern).

## 11. Resolved owner decisions (2026-07-11)

1. **OQ1 — tier packaging:** RESOLVED → single package with `.` / `./experimental` / `./testing` **subpaths** + the api-extractor gate. **Not** a separate `@sentropic/mcp-platform-testing` package (one version, one gate).
2. **OQ2 — `ElicitationManager`:** RESOLVED → `./experimental` (types + class), unstable until the transition contract is consumer-hardened; not frozen at 0.1.0.
3. **OQ3 — `secretsEgress`/egress residence:** RESOLVED → **manifest field** (optional, additive); deferred as planned-additive, not in 0.1.0.
4. **OQ4 — `DurableCall` mirror:** RESOLVED → **internal/`./experimental` mirror** (Hermes is unpublished — a direct import is impossible today); never frozen until Hermes publishes.
5. **OQ5 — version start:** RESOLVED → **`0.1.0`**; `1.0.0` deferred until ARCH-11/AccessGrant so the surface can still widen additively.

## 12. Acceptance / DoD

- `@sentropic/mcp-platform@0.1.0` published public via OIDC trusted publisher; `npm view` resolves; root lockfile includes it; `enforce-package-bump` green.
- Root `.` exports **only** the frozen read-only pure-adapter surface (§3.1); mutation/elicitation/durable/store-ports under `./experimental`; mocks under `./testing`. `ElicitationPolicy`, `ElicitationManager`, the mutation gate and the DurableCall mirror are **not** in root `.`.
- **api-extractor gate is live and RED on any un-bumped root-surface change; the golden `.api.md` report is checked in; no `@internal`/`@experimental` symbol appears in the root `.d.ts`.**
- R1 refactor applied: `guard.ts` split (read-only `listVisibleCapabilities` frozen; mutation gate experimental); `AppMcpProviderManifest` frozen shape carries **no** `elicitation?`.
- `SecretStatus` frozen shape carries the `'operator'` union member and **not** `operatorRef`/`rotationWindow` (planned-additive); state-only disclosure test green; egress-boundary conformance test green.
- `exports` map declares `import` + `require` conditions (or a stated ESM-only exception); supported minimum TypeScript version documented.
- openerp `bank-connector` implements `AppConnectorProviderAdapter` against the **published root `.`** (read-only, mono-tenant), importing nothing from `./experimental` — proving the surface end-to-end without `AccessGrant`/registry/sync.
- No domain (Wave/immo/bank) leakage into the package; `mcp-wave` repo untouched (platform §2.3).
