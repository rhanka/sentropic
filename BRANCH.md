# Feature: Cowork connector-host functional MVP

## Objective
Specify, then after architect ratification build, a same-day closed-alpha vertical slice in which Cowork embeds/selects Sentropic chat sessions and safely exposes a different Cowork workstation's `screen_capture`/`input_action` through the connector-host mount. This plan is PENDING ratification via `neg:cowork-cu-cadrage-20260718`.

## Scope / Guardrails
- This authoring pass changes only `BRANCH.md` and `spec/SPEC_EVOL_COWORK_CONNECTOR_HOST_MVP.md`; no product code, push, or UAT.
- Implementation starts only after the architect resolves the spec's open questions; until then all implementation lots remain unchecked.
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
  - `api/src/services/skills/foundation-executor.ts`
  - `api/src/services/chat-service.ts`
  - `api/src/routes/auth/device.ts`
  - `api/src/services/device-code-store.ts`
  - `api/src/routes/api/chat.ts`
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
- `attention`: architect ratification is pending via `neg:cowork-cu-cadrage-20260718`; Lot 0 must resolve spec §9 before product edits.
- `attention`: BR-COWORK-EX1 is proposed, not active; one durable device/lease migration is allowed only after schema/route ownership is ratified.
- `resolved`: BR-COWORK-EX2 authorizes `api/src/services/device-code-store.ts` solely for BR-41c enrollment PoP staging; impact is device-code pending state only and rollback is removal of the PoP fields with the dependent route/client change. The user explicitly requested this enrollment binding.
- `deferred`: production/unattended takeover and BR-41c/d/e hardening are explicitly outside the same-day acceptance line.
- `clarification`: conductor provides the isolated Windows OVH target and confirms controller A and target B are different devices for UAT.

## AI Flaky tests
- Accept only provider/network/model nondeterminism with at least one success on the same commit and command; never add timeout padding.
- Any related failure blocks. An unrelated accepted failure records command, file, signature, main comparison, and explicit owner sign-off here before merge.

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
- [ ] **Lot 0b — Architect ratification / freeze**
  - [ ] Resolve every spec §9 question in `neg:cowork-cu-cadrage-20260718`; record decisions here before edits.
  - [ ] Freeze WebView2/runtime RPC, context-carrying chat seam, per-call broker/invocation-ref transport, connector/device account placement, scopes, capability lease, delivery route, result states and audit fields.
  - [ ] Activate BR-COWORK-EX1 only if one migration is approved; otherwise stop as blocked.
  - [ ] Re-run `harness check branch` and `make scope-check` before implementation.
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
- [ ] **Lot 3 — Targeted device identity, lease and delivery**
  - [x] Add the BR-41c durable device, presence, and lease schema with its single migration and non-terminal issuance idempotency index.
  - [x] Add the Ed25519 (OQ-1 architect-revisable) device identity activation primitive with collision, revoked-reuse, and key-rotation denial.
  - [x] Bind device-code approval to the `cowork-enroll-v1:` proof before committing an active device identity.
  - [x] Add the portable device-identity storage and signing contracts without imposing them on unrelated bridge hosts.
  - [x] Persist one desktop Ed25519 identity in `device-identity.json` and reuse it across restarts.
  - [x] Send the stable key-bound identity in enrollment and presence mutations instead of accepting a server-minted desktop id.
  - [ ] Implement ratified BR-41c minimum: stable key/id, durable active presence, one-use capability lease, signed ack, expiry/revoke and eligibility.
  - [ ] Implement device-filtered notify + ownership/proof-checked poll fallback and connector bounded await; no dormant-success claim.
  - [ ] Tests: restart durability, wrong owner/device, stale presence, capability mismatch, duplicate/replay, expiry/revoke, SSE filtering, poll recovery.
  - [ ] Gate scoped API suites, then `make test-api ENV=test-cowork-connector`.
- [ ] **Lot 4 — Consent-gated eyes/hands and canonical result**
  - [ ] Add foreground action detail/preview with Deny or Allow once; remove permanent input grant from connector path.
  - [ ] Enforce isolated-OVH low-risk allowlist; block key/Enter and all sensitive/irreversible classes; add local Stop and redacted audit.
  - [ ] Post one idempotent canonical result; atomically consume lease; timeout/offline/deny/stop/mismatch must be **PAS-FAIT**.
  - [ ] Add mock-provider vertical test: chat tool → mount → lease → ack → consent → eyes/hands → result → resumed model answer.
  - [ ] Gate desktop/bridge/connector/API scoped tests in `ENV=test-cowork-connector`.
- [ ] **Lot 5 — Integrated validation and Windows OVH UAT**
  - [ ] Run all Lot 1–4 typecheck/lint/tests plus `make test-api ENV=test-cowork-connector`; document any accepted AI flaky signature.
  - [ ] Build/package through existing Make targets with `ENV=test-cowork-connector` last; record exact artifact SHA-256 and branch HEAD.
  - [ ] On commit-identical controller A + isolated OVH target B, execute spec §8: refresh, session select/history/stream, capture, confirmed click/type, deny, Stop, offline/wrong/expired/replay.
  - [ ] Fail UAT on ambiguous target, missing prompt, host execution, raw-sensitive audit, high-risk action, late execution, or false success.
- [ ] **Lot 6 — Final consolidation**
  - [ ] Update the spec and this plan with ratified decisions, actual files/tests, MVP limitations, UAT evidence IDs and deferred BR-41c/d/e work.
  - [ ] Bump every changed publishable package version and verify package contents through existing Make targets.
  - [ ] Run `make scope-check`, final CI/UAT gates, record owner sign-off, then follow the repository PR/BRANCH cleanup workflow.
