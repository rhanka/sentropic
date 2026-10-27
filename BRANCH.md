# Feature: W2.b app registry dispatch and artifact HTTP

## Objective
- [ ] Mount the compiled cluster-mesh registry and APP-P1 HTTP on one durable artifact host.

## Scope / Guardrails
- [x] Base W2.a `247015eba` merged with W1.d `8729aff22`; merge commits only.
- [x] Merge approved W1.b `79a6a968c` fixture-shutdown correction; no production composition override; Track log blobs identical across all three bases.
- [x] Worktree `tmp/worktrees/app-w2b`; branch `feat/app-cm-w2b`; draft base `feat/app-cm-integration`.
- [x] Read Docker lock, complete plan-v2 and W0-close.d reservations; sole root/API lock writer.
- [x] Make-only; builds, tests and starts take shared Docker flock; teardown after each step.
- [x] Tests first; ENV=test-app-w2b last; API/UI/Maildev ports 8796/5182/1089; no dev.
- [x] Selective staging; scope-check before make commit; authored commits under 150 lines; no trailers.
- [x] Preserve MCP auth, connectors/resources, supervisor and single author/generation.
- [x] Activation stays closed; W3 owns activation/content/image/infrastructure.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/app.ts`
  - `api/src/routes/namespaces/mcp.ts`
  - `api/src/routes/namespaces/resources.ts`
  - `api/src/routes/namespaces/resources-module.ts`
  - `api/src/routes/namespaces/artifacts.ts`
  - `api/src/services/artifacts/transport.ts`
  - `api/src/services/artifacts/credentials.ts`
  - `api/src/services/artifacts/instance.ts`
  - `api/src/services/artifacts/composition.ts`
  - `api/src/services/artifacts/lifecycle.ts`
  - `api/tests/api/artifacts-host-recovery.test.ts`
  - `api/src/services/mcp/cluster-registry.ts`
  - `api/src/services/mcp/registry-dispatch.ts`
  - `api/src/services/cluster-mesh-adapter.ts`
  - `api/tests/api/app-artifacts-transport.test.ts`
  - `api/tests/api/artifacts-host-credentials.test.ts`
  - `api/tests/api/artifacts-host-publication.test.ts`
  - `api/tests/api/app-mcp-registry.test.ts`
  - `api/tests/api/app-mcp-installed.test.ts`
  - `api/package.json`
  - `api/package-lock.json`
  - `package.json`
  - `package-lock.json`
  - `api/vitest.config.ts`
  - `api/tsconfig.json`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/**`
  - `.track/**`
  - `plan/**`
  - `deploy/**`
- **Conditional Paths (allowed only with explicit exception)**:
  - `.github/workflows/**`
- [x] Exception process: BR02B-EXn records reason, impact and rollback before expansion.

## Feedback Loop
- [ ] W1.b P2: verify OAuth tuple, scopes, expiry and revocation with DB time after waits.
- [x] W2.a P2 reconciliation: API artifacts uses file workspace; root lock removes private registry copy; TS/Vitest artifacts aliases removed.
- [ ] W2.a P2 installed proof: api/tests/api/app-mcp-installed.test.ts runs Node/tsx outside Vitest resolution; final strict install pending.
- [x] Bundle red: production esbuild settings refused the loaded profile with invalid compiled artifacts profile; /tmp/app-w2b-focused1.log.
- [x] API build keeps artifacts and cluster-mesh external, preserving physical runtime instances and package topology guards.
- [ ] Retry failed pushes every ten minutes; draft PR after push; no merge.
- [ ] Independent final-head reviews and remote CI remain separate receipts.

## AI Flaky tests
- [x] No AI calls or timeout increases planned; no accepted flakes.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, one author; independent final-head review.

## UAT Management (in orchestration context)
- [x] API-only; browser/Chrome/VSCode acceptance remains W3/W4/W5.

## Plan / Todo (lot-based)
- [x] Lot 0: mechanical branch check and merge W1.d; freeze scope and environment.
- [x] Lot 1 tests authored first in api/tests/api/artifacts-host-credentials.test.ts; current OAuth/session authority.
- [x] Lot 1 reader: locked session/OAuth tuple, consent, audience, proof key and DB-time expiry; validation pending.
- [x] Test fixture uses allowed id_token substitution and waits for physical PG connection closure before drop.
- [x] Lot 2 manifests/locks regenerated strictly without peer overrides; API leaf metadata refreshed to source versions.
- [ ] Lot 2 strict install/physical compilation final receipt.
- [x] Lot 3 tests authored in api/tests/api/app-artifacts-transport.test.ts; exact dispatch, denial, HTTP and MCP routing.
- [x] Lot 3 durable test: HTTP session ensure and OAuth MCP replay, MCP publish and HTTP replay; assert one artifact/release and two receipts.
- [x] Current-reader vectors include matching/wrong DPoP proof, revocation during artifact-row waits and expiry during quota waits for both credential kinds.
- [x] Credential red /tmp/app-w2b-credential-final-red.log: session expiry after credential-row wait and revoked required scope with a remaining read scope; 3 failures/20 passes before repair.
- [x] Lot 4 core: compiled exact-name dispatch and bounded APP-P1 HTTP adapter delegate to W1 host.
- [x] Lot 4 singleton: one durable PG host with dedicated private S3, explicit quota and default-closed activation.
- [x] Lot 4 mount: verified credential tuples, shared MCP supervisor guard, resources author and /resources/artifacts/*; 28 namespaces retained.
- [x] MCP transport is acquired through the cluster-mesh loader; Drive/Gmail ports and original URLs remain mounted.
- [ ] Lot 5: focused tests, relevant regressions, API typecheck/lint/build.
  - [ ] api/tests/api/{app-mcp-registry,artifacts-host-publication,artifacts-host-recovery,artifacts-host-migrations,mcp-resource-server,cluster-mesh-mcp-singleton,cluster-mesh-namespace-inventory}.test.ts.
  - [ ] Resource/gateway/D1/auth suites selected from actual filenames.
  - [ ] Strict install and physical package-resolution inventory without aliases.
  - [ ] Runtime logs and locked make down ENV=test-app-w2b; no remaining services.
- [ ] Lot 6: exact-head evidence and W3 handoff; scope check; push; draft PR using this body.

## Inherited main qualification record

> # Feature: Decision Q1 live qualification smoke
>
> ## Objective
> - [ ] Record bounded live protocol and identity evidence for JEV and OpenAI Decisions; keep production refused pending OD-4 calibration.
>
> ## Scope / Guardrails
> - [x] Owner GO dated 2026-10-29; spec v4 section 7.4; H1/H2 base `213638676`.
> - [x] Worktree `tmp/worktrees/decision-q1`, branch `feat/decision-q1-live`, mono-branch.
> - [x] Make only; no Python; secrets enter Compose from the existing root `.env` without copying values.
> - [x] Maximum three attempts per candidate, counting failed, refused and ambiguous calls; no retries.
> - [x] Local qualification only, `ENV=test-decision-q1` last; API 8802, UI 5202, Maildev 1102.
> - [x] Serialize Docker with `/home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md`; run `make down` afterward.
>
> ## Branch Scope Boundaries (MANDATORY)
> - **Allowed Paths (implementation scope)**:
>   - `BRANCH.md`
>   - `spec/decision/**`
>   - `packages/llm-mesh/src/decision/descriptor.ts`
>   - `packages/llm-mesh/src/decision/openai-descriptor.ts`
>   - `packages/llm-mesh/src/decision/descriptor-validation.ts`
>   - `packages/llm-mesh/package.json`
>   - `package-lock.json`
>   - `packages/llm-mesh/tests/decision-public-surface.test.ts`
>   - `packages/llm-mesh/tests/decision-jev-v4l3.test.ts`
>   - `packages/llm-mesh/tests/decision-qualification-admission.test.ts`
>   - `packages/llm-mesh/tests/decision-qualification.test.ts`
>   - `packages/llm-mesh/tests/decision-jev-request.test.ts`
>   - `packages/llm-mesh/tests/decision-openai-routing.test.ts`
>   - `packages/cluster-mesh/tests/fixtures/train.ts`
>   - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json`
>   - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`
> - **Forbidden Paths (must not change in this branch)**:
>   - `Makefile`
>   - `docker-compose*.yml`
>   - `.cursor/rules/**`
>   - `api/**`
> - **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
>   - `.github/workflows/**`
>
> ## Feedback Loop
> - [x] No calibration authorized; live observations cannot qualify immutable weights, billing beyond the admitted bound, or production readiness.
> - [x] Q1-CRED-01: JEV preflight refused peripheral whitespace; normalized transiently after Compose injection, source env unchanged; refusal consumes attempt 1.
> - [x] Q1-INV-01: parser previously forbade observed IDs with unqualified production status; permit evidence inventory while retaining admission gates; regression keeps nonempty IDs and proves production refusal.
> - [ ] Q1-REV-01: conductor to select two exact complementary reviewer models before merge; h2a discovery has host presence but no model identities, no configured gateway catalog; no consensus claimed.
> - [x] Q1-CI-01: reproduced job 123314702961's three stale-version failures; rebound independent train and selected fixture to llm-mesh 0.32.2 and guarded archive SHA-512; 1,228 cluster-mesh tests and scope pass, 138 expected skips; see `spec/decision/q1-2026-10-29/ci-repair.md`.
>
> ## AI Flaky tests
> - [x] No flaky acceptance or additional live calls beyond the cap.
>
> ## Orchestration Mode (AI-selected)
> - [x] Mono-branch; no integration from other branches.
>
> ## UAT Management (in orchestration context)
> - [x] API-only qualification fixture; no UI, Chrome or VSCode surface change.
>
> ## Plan / Todo (lot-based)
> - [x] **Lot 0 — Baseline and constraints**
>   - [x] Read master/workflow rules, spec section 7.4, API host and descriptors; mechanical branch check passed.
>   - [x] Verify ports, credential names, control pricing and isolated stack.
> - [x] **Lot 1 — Bounded live evidence**
>   - [x] Fix a public synthetic binary criterion and retain only that fixture input.
>   - [x] No documented zero-cost Decisions entitlement probe established; first POST counts as attempt 1.
>   - [x] Record served identity, tokens, priced cost, billing bound, latency, verdict shape and refusals per attempt.
>   - [x] Fail closed on descriptor identity mismatch; three calls per candidate including the JEV preflight refusal, five egresses total, 77 micro-USD.
> - [x] **Lot 2 — Evidence and descriptors**
>   - [x] Retain scrubbed receipts in `spec/decision/`; accepted identities/evidenceRefs cite only observed results.
>   - [x] Bump llm-mesh from published 0.32.1 to 0.32.2; align workspace lock and public version assertion.
>   - [x] Preserve unqualified production and OD-4 calibration requirement; 16 host/route tests pass.
> - [ ] **Lot 3 — Final validation and draft PR**
>   - [x] Mesh descriptor, qualification, adapter, pricing, public and request suites: 88 files / 1,566 tests pass.
>   - [x] llm-mesh typecheck/lint and mechanical scope checks pass; commits at most 150 lines.
>   - [x] Secret scan, attempt counts, identity comparison and durable 77 micro-USD ledger verified; zero reserved/pending.
>   - [x] Stop local stack with `make down`; publish report `spec/decision/q1-live-smoke.md`.
>   - [x] Draft PR #834 created against main; exact-head CI remains the final checkpoint.
>   - [ ] Observe CI completed/success on exact head; report head, 77 micro-USD and candidate outcomes.
