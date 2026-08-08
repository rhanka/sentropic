# Feature: Cowork connector-host functional MVP

## Objective
Build the architect- and owner-ratified same-day closed-alpha vertical slice in which Cowork embeds/selects Sentropic chat sessions and safely exposes a different Cowork workstation's `screen_capture`/`input_action` through the connector-host mount. The binding Option-B narrow-surface conditions are recorded below.

## Scope / Guardrails
- This build implements only the ratified Option-B narrow MVP; no push or UAT is included.
- General computer use is out of scope until separately ratified with its trusted-policy/human-in-the-loop envelope.
- D6(b) only: Cowork is a connector on `packages/connector-host`, not a standalone MCP server and not the #489 inbound Gmail/Drive `/mcp` approach.
- Same-day MVP is closed-alpha, isolated non-admin Windows OVH only, explicit different-device selection, per-action consent, no permanent input grant, no high-risk/irreversible action, and fail-closed results.
- Reuse BR-41c identity/lease/broker foundations and the study §5 guardrails; apply #439 per-request tenancy/exposure and #492 teardown ordering.
- One migration maximum in `api/drizzle/*.sql`, only after OQ ratification.
- Make-only workflow; every test/build command uses `ENV=test-cowork-connector` or `ENV=e2e-cowork-connector` as its final argument; never `ENV=dev`.
- Work only in `tmp/cowork-connector-mvp` on `feat/cowork-connector-host-mvp`; run `harness check branch` before work and `make scope-check` before every commit.
- Atomic selective staging and `make commit MSG="..."`; no `git add .`; all new text is English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `spec/SPEC_EVOL_COWORK_CONNECTOR_HOST_MVP.md`
  - `packages/cowork-desktop/src/**`
  - `packages/cowork-desktop/tests/**`
  - `packages/cowork-desktop/packaging/**`
  - `packages/cowork-desktop/package.json`
  - `packages/cowork-bridge/src/**`
  - `packages/cowork-bridge/tests/**`
  - `packages/cowork-bridge/package.json`
  - `packages/connector-host/src/**`
  - `packages/connector-host/tests/**`
  - `packages/connector-host/package.json`
  - `api/src/services/connector-host/cowork.ts`
  - `api/src/services/cowork/**`
  - `api/src/services/catalog/execution-seam.ts`
  - `api/src/services/catalog/sources/connector-host-tool-source.ts`
  - `api/src/services/catalog/sources/standalone-tool-source.ts`
  - `api/src/services/skills/catalog.ts`
  - `api/src/services/skills/foundation-executor.ts`
  - `api/src/services/chat-service.ts`
  - `api/src/routes/auth/device.ts`
  - `api/src/services/device-code-store.ts`
  - `api/src/routes/api/chrome-extension.ts`
  - `api/src/routes/api/admin.ts`
  - `api/src/routes/api/chat.ts`
  - `api/src/routes/api/me.ts`
  - `api/src/routes/api/streams.ts`
  - `api/src/db/schema.ts`
  - `api/tests/**`
  - `api/package-lock.json`
  - `package-lock.json`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
  - `api/src/routes/api/mcp.ts`
  - `api/src/services/connector-host/gmail.ts`
  - `api/src/services/connector-host/google-drive.ts`
  - `packages/chat-ui/**`
  - `packages/mcp-platform/**`
  - `ui/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (BR-COWORK-EX1, at most one ratified identity/lease migration)
  - `packages/chat-server/src/**` (only if architect rejects the proposed app-level context seam)
  - `.github/workflows/**`
- **Exception process**:
  - Declare `BR-COWORK-EXn` in `## Feedback Loop` with reason, impact, rollback, and architect approval before touching a conditional/forbidden path.
  - Run `make scope-check` before the exception commit and mirror the exception in the spec if it changes architecture.

## Feedback Loop
- `resolved`: architect and owner ratified the binding Feature 3 Option-B conditions before product edits; `COWORK_MVP_RATIFICATION_archi.md` is the decision record.
- `resolved`: BR-COWORK-EX1 authorizes the single `0042_cowork_provisioning_exposure.sql` migration for server-issued kiosk provisioning and durable Cowork workspace exposure grants; impact is deny-by-default authorization storage and rollback is removal of the new tables after revoking affected leases.
- `resolved`: BR-COWORK-EX2 authorizes `api/src/services/device-code-store.ts` solely for BR-41c enrollment PoP staging; impact is device-code pending state only and rollback is removal of the PoP fields with the dependent route/client change. The user explicitly requested this enrollment binding.
- `resolved`: BR-COWORK-EX3 authorizes `api/src/routes/api/chrome-extension.ts` solely to keep the published Cowork presence transport while routing `desktop_cowork` to durable ownership-checked storage; browser tab behavior is unchanged and rollback is the isolated desktop route branch.
- `resolved`: BR-COWORK-EX4 authorizes `api/src/routes/api/admin.ts` and `api/src/routes/api/me.ts` solely to terminalize outstanding Cowork leases immediately before their existing user-delete cascades; impact is limited to #492 revoke-before-cascade and rollback is removal of those terminalization statements.
- `resolved`: Architect and owner ratified the Feature 3 narrow Option-B surface. The remote execution path is now attached only to the isolated benign-kiosk VM MVP; it is not a general computer-use surface.
- `resolved`: I1–I5 are published by `docs/governance/surface-invariants.md` in the separate h2a governance repository (h2a PR #152). This checkout cites that cross-repository provenance and does not require the file locally. `origin/feat/d6a-agents-surface-fusion` (#502) is a secondary pointer only.
- `attention`: `make test-api-endpoints SCOPE=tests/api/auth-device-code.spec.ts ENV=test-cowork-connector` could not run because the API service is absent after the isolated stack bootstrap (the compose API image build is unavailable in this checkout). The new scoped API suites remain pending on a runnable test stack.
- `deferred`: production/unattended takeover and BR-41c/d/e hardening are explicitly outside the same-day acceptance line.
- `clarification`: conductor provides the isolated Windows OVH target and confirms controller A and target B are different devices for UAT.

## AI Flaky tests
- Accept only provider/network/model nondeterminism with at least one success on the same commit and command; never add timeout padding.
- Any related failure blocks. An unrelated accepted failure records command, file, signature, main comparison, and explicit owner sign-off here before merge.

## Feature 3 binding conditions (verbatim)
- C1/OQ-1: PER-INVOCATION BROKER CLOSURE keyed by toolCall.id in api/src/services/connector-host/cowork.ts; the shared/durable mount resolves #439 tenancy ONLY, hands off to a fresh closure that owns the lease lifecycle. NO per-invocation state (lease/target/consent/toolCall.id) on the mount.
- C2/OQ-4: HUMAN-SELECT-ALWAYS target deviceId, even with one eligible device; NEVER auto-pick, NEVER from model/tool args. Exposure via the connector-account-workspace-exposure model.
- C3/OQ-6: DEVICE PROOF-OF-POSSESSION on delivery; dedicated /devices/:deviceId/leases/sse gated by device-proof (bearer alone rejected).
- C4/OQ-7: SERVER-SIGNED LEASE ENVELOPE, MAC over EXACTLY {leaseId, capability, targetDeviceId, nonce, expiry} with the existing OAUTH_SIGNING_KEK-class key; device verifies BEFORE acting; plus the device-signed ack = two-sided authorization. Tamper any field → invalid.
- C5/OQ-9 TWO HARD GATES: (a) execution REFUSED unless target.capabilities.isolatedVmTarget===true AND NODE_ENV!=='production' AND target.capabilities.kioskSurface is set (the benign-app constraint — see below); (b) device revocation revokes outstanding leases BEFORE the device row is deleted (#492 revoke-before-cascade) + Stop-revokes-active-lease + atomic consume/expire/revoke.
- C6/OQ-10: I1-I5 cite docs/governance/surface-invariants.md (h2a PR #152) as the authoritative publisher — a CROSS-REPO reference to the separate h2a governance repo (do NOT require the file in this checkout; it is verifiable at /home/antoinefa/src/h2a/docs/governance/surface-invariants.md). Keep origin/feat/d6a-agents-surface-fusion (#502) only as a secondary pointer. This is a DOC citation, not a safety control — if the exact file is absent locally, cite the identifier and proceed; do NOT STOP the build on C6.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single integrated TERRA build and final test cycle)
- [ ] **Multi-branch**
- Rationale: one security-sensitive vertical slice shares the same identity, lease, connector and chat contracts; a single ratified branch avoids cross-branch contract drift.

## UAT Management (in orchestration context)
- UAT runs only on the integrated, commit-identical branch after automated gates; no sub-branch UAT.
- The conductor controls any later push/qualification step. This design-authoring turn does not push.
- Use `ENV=e2e-cowork-connector` for automated qualification and the conductor-provisioned isolated Windows OVH machine for the manual script in the spec.

## Plan / Todo (lot-based)
- [x] **Lot 0a — Design grounding and executable plan**
  - [x] Verify branch `feat/cowork-connector-host-mvp`, base `c9e745b96`, and harness branch scope before writing.
  - [x] Ground connector-host, Cowork, bridge, chat, BR-41c, threat guardrails, #439/#492 and D6 fusion with path:line evidence.
  - [x] Quote I1–I5 and write the exact MVP/deferred line, TERRA lots and Windows OVH UAT.
  - [x] Commit only the spec and this plan; no product code or push.
- [x] **Lot 0b — Architect ratification / freeze**
  - [x] Resolve the implemented spec §9 questions in the architect decision record before edits.
  - [x] Freeze the narrow host/runtime seam, per-call broker, account selection, capability lease, delivery route, result states and audit fields.
  - [x] Retain the already-ratified BR-41c migration foundation; F3 itself adds no migration.
  - [x] Re-run `harness check branch` and `make scope-check` before implementation.
- [ ] **Lot 1 — Embedded chat and Sentropic session join (Features 1/2)**
  - [x] Add local-only WebView2 shell, published chat-ui composition, conversation list/selection, history hydration, send/stop and session switching.
  - [x] Add narrow native RPC + authenticated StreamHub proxy; keep bearer/refresh tokens out of webview JavaScript.
  - [x] Wire refresh-first `SessionAuthClient`, with device-code only as fallback; separate controller chat SSE from target lease delivery.
  - [x] Tests: route/method allowlist, token non-disclosure, session projection/switch race, NDJSON error, SSE reconnect, refresh/re-enroll fallback.
  - [x] Gate: `make typecheck-cowork-bridge ENV=test-cowork-connector`; `make test-cowork-bridge ENV=test-cowork-connector`; `make typecheck-cowork-desktop ENV=test-cowork-connector`; `make test-cowork-desktop ENV=test-cowork-connector`.
  - [ ] Windows VM UAT: attach the CoreWebView2 host adapter, package the local Svelte assets, then prove session list/history/live stream and navigation/download/new-window denial on the isolated VM.
- [ ] **Lot 2 — Cowork connector-host adapter and chat mount**
  - [ ] Register `cowork-desktop` manifest with `screen_capture`/`input_action`; no resources, prompts or secrets.
  - [ ] Implement strict tenant/exposure/account/audit ports and adapter-injected broker; trusted UI selection maps durable device to connector instance.
  - [ ] Add context-carrying chat tool source/executor that binds trusted `toolCall.id` to a per-call broker (or ratified mount field) and calls `mountConnectorHost`; never call `/api/v1/mcp` or encode idempotency as a hint.
  - [ ] Tests: deny-as-missing, no auto/broadcast, cross-user/workspace/hint denial, capability visibility, tool-call id propagation, audit redaction.
  - [ ] Gate: `make typecheck-connector-host ENV=test-cowork-connector`; `make test-connector-host ENV=test-cowork-connector`; `make typecheck-api ENV=test-cowork-connector`; `make lint-api ENV=test-cowork-connector`.
- [x] **Lot 3 — Targeted device identity, lease and delivery**
  - [x] Add the BR-41c durable device, presence, and lease schema with its single migration and non-terminal issuance idempotency index.
  - [x] Add the Ed25519 (OQ-1 architect-revisable) device identity activation primitive with collision, revoked-reuse, and key-rotation denial.
  - [x] Bind device-code approval to the `cowork-enroll-v1:` proof before committing an active device identity.
  - [x] Add the portable device-identity storage and signing contracts without imposing them on unrelated bridge hosts.
  - [x] Persist one desktop Ed25519 identity in `device-identity.json` and reuse it across restarts.
  - [x] Send the stable key-bound identity in enrollment and presence mutations instead of accepting a server-minted desktop id.
  - [x] Add durable active/revoked ownership checks for Cowork presence mutations.
  - [x] Route only `desktop_cowork` register, keepalive, and unregister through durable ownership checks; preserve browser tab handling.
  - [x] Add durable short-TTL lease issuance, idempotency, signature acknowledgement, replay protection, and pre-execution revocation primitives.
  - [x] Expose bounded, authenticated lease issue, acknowledge, revoke, and device-scoped poll primitives with no remote execution route.
  - [x] Add device-filtered lease SSE notification backed by the durable queue; a connection never queries another device's rows.
  - [x] Test persistent desktop identity generation, enrollment proof transport, and stable device-id presence transport.
  - [x] Add API coverage for human approval plus enrollment PoP, active-device commit, cross-user collision, and revoked-device reuse denial.
  - [x] Add API coverage for durable owner-scoped registration, keepalive, unregister, and revoked-device denial.
  - [x] Add API coverage for eligibility, idempotent durable leases, wrong-device/expiry/replay/revocation acknowledgement denial, and device-filtered poll/SSE delivery.
  - [x] Implement BR-41c foundation: stable key/id, durable active presence, one-use capability lease, signed ack, expiry/revoke and eligibility.
  - [x] Implement device-filtered notify and ownership-checked device-scoped poll fallback; connector bounded await remains deferred to Lot 4.
  - [x] Add tests for restart-safe DB reads, wrong owner/device, stale presence, duplicate/replay, expiry/revoke, and filtered poll/SSE delivery.
  - [x] Recheck locked eligibility before returning an idempotent in-flight lease, including the stale-presence retry case.
  - [!] API integration gate remains blocked on the absent isolated API service; rerun the scoped suites then `make test-api ENV=test-cowork-connector` on a runnable stack.
  - [x] Bump `@sentropic/cowork-bridge` to 0.2.1 and `@sentropic/cowork-desktop` to 0.3.1.
- [x] **Lot 4 — Consent-gated eyes/hands and canonical result (MVP-narrow)**
  - [x] Add the `cowork-desktop` connector-host adapter and toolCall.id-keyed invocation closure; shared mount state is tenancy-only.
  - [x] Require an authenticated, human session-bound target selection, including where exactly one device is eligible; no model argument can select a target.
  - [x] Deliver a server-signed lease only to device proof-of-possession poll/SSE, verify before device action, and require device-signed acknowledgement and terminal result.
  - [x] Require `isolatedVmTarget` plus `kioskSurface` and non-production server mode before issuance; use the Option-B benign-kiosk environment for OQ-5 safety by construction.
  - [x] Allow only click/scroll/type at the executor; deny chords, Enter, and submission. Input consent is foreground Allow once only, Stop revokes active leases, and all bounded failure outcomes are `PAS-FAIT`.
  - [x] Emit ID-only redacted audit events and keep I3 holder=`remote-B`, view=`A`.
  - [x] Run the desktop/bridge/connector/API scoped gates where the local stack is available; API integration remains contingent on the test stack.
  - [x] General computer use remains separately ratification-gated in `spec/SPEC_EVOL_COWORK_COMPUTER_USE_GENERAL.md`; it needs a trusted-policy/human-in-the-loop envelope and must not inherit this MVP surface.
- [ ] **Lot 4b — Independent codex-sol release-block remediation (re-run required)**
  - [x] Fix 1 critical: consent-before-acknowledgement and final pre-act revoke/expiry/Stop race closure.
    - [x] Implement consent-first acknowledgement, synchronous Stop cancellation, and local pre-act expiry/cancellation checks.
    - [x] Prove held-consent timeout, expiry, Stop, device-deletion, and account-deletion races produce zero provider calls.
  - [x] Fix 2 critical: server-issued key-bound kiosk provisioning attestation; client claims are non-authoritative.
    - [x] Add the single durable provisioning/exposure migration and server-only attestation record keyed by the device public key.
    - [x] Require authenticated provisioning before enrollment and re-check exact Notepad attestation at target selection and acknowledgement.
    - [x] Prove arbitrary claimed safety flags, unprovisioned enrollment, and un-attested target selection fail closed.
  - [x] Fix 3 high: complete canonical invocation binding and mismatch-safe idempotency.
    - [x] Persist canonical principal/workspace/session/target/capability/action-hash binding and revoke mismatched idempotency collisions.
    - [x] Prove same tool-call ID cannot converge across a changed invocation closure.
  - [x] Fix 4 high: durable device-workspace-capability exposure grants at every authorization seam.
    - [x] Enforce existing grants during mount discovery/account resolution, human selection, broker invocation, direct issue, and locked issuance.
    - [x] Prove selection narrows a grant and an ungranted workspace/capability cannot issue control.
  - [x] Fix 5 high: lease/action-bound one-use remote consent; persisted remote allows are deleted and ignored.
  - [x] Fix 6 high: strict literal printable text schema and Windows primitive coverage.
  - [x] Fix 7 high: bounded integrity-bound capture result persisted before FAIT and returned to the broker.
  - [ ] Acceptance: re-run the independent codex-sol adversarial leg; do not claim CLEAR before that result.
- [ ] **Lot 5 — Integrated validation and Windows OVH UAT**
  - [ ] Run all Lot 1–4 typecheck/lint/tests plus `make test-api ENV=test-cowork-connector`; document any accepted AI flaky signature.
  - [ ] Build/package through existing Make targets with `ENV=test-cowork-connector` last; record exact artifact SHA-256 and branch HEAD.
  - [ ] On commit-identical controller A + isolated OVH target B, execute spec §8: refresh, session select/history/stream, capture, confirmed click/type, deny, Stop, offline/wrong/expired/replay.
  - [ ] Fail UAT on ambiguous target, missing prompt, host execution, raw-sensitive audit, high-risk action, late execution, or false success.
- [ ] **Lot 6 — Final consolidation**
  - [ ] Update the spec and this plan with ratified decisions, actual files/tests, MVP limitations, UAT evidence IDs and deferred BR-41c/d/e work.
  - [ ] Bump every changed publishable package version and verify package contents through existing Make targets.
  - [ ] Run `make scope-check`, final CI/UAT gates, record owner sign-off, then follow the repository PR/BRANCH cleanup workflow.
