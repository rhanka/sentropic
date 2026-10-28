# Feature: W3.d default-closed artifact content infrastructure

## Objective
- [ ] Deliver the content Kubernetes workload and isolated TLS routes without activating artifacts or accessing any cluster.

## Scope / Guardrails
- [x] Source: `.tmp/app-switch-week/plan-v2.md` W3.d and sections 3, 4, 5; W0 host-fit/reservations and W3.c inherited.
- [x] Base `origin/feat/app-cm-integration` at `763bb9d7e`; branch `feat/app-cm-w3d`; worktree `tmp/worktrees/app-w3d`.
- [x] Make-only; shared Docker flock `/home/antoinefa/.cache-tmp/sentropic-docker.lock`; no parallel builds.
- [x] Every make command ends with `ENV=test-app-w3d`; ports API=8806, UI=5192, Maildev=1099.
- [x] No cluster operations, production activation, Python, rebase, force-push, AI trailers or destructive cleanup.
- [x] Serving, reader activation and host publication remain explicitly disabled before FIRST-IMMO, including main auto-deploys.
- [x] API remains the sole migration executor; content starts only the compiled content entrypoint.
- [x] Atomic commits under 150 changed lines; selective staging; `make commit` only.
- [x] External DNS/TLS/IAM/storage provisioning and positive live activation belong to tenant/W3.e/W5 lanes.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `deploy/k8s/base/artifact-content-*.yaml`
  - `deploy/k8s/base/kustomization.yaml`
  - `deploy/k8s/base/30-api.yaml`
  - `deploy/k8s/overlays/preprod/kustomization.yaml`
  - `deploy/k8s/overlays/prod/kustomization.yaml`
  - `deploy/k8s/overlays/preprod/artifact-content-*.yaml`
  - `deploy/k8s/overlays/prod/artifact-content-*.yaml`
  - `deploy/k8s/overlays/preprod/patch-artifact-content-config.yaml`
  - `deploy/k8s/overlays/prod/patch-artifact-content-config.yaml`
  - `deploy/ci/artifact-content/**`
  - `docs/runbooks/app-artifact-content-infrastructure.md`
- [x] **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/**`
  - `api/src/**`
  - `api/drizzle/**`
  - `.track/**`
  - `plan/**`
- [x] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile`
  - `.github/workflows/ci.yml`
  - `.github/workflows/app-cm-w3d.yml`
- [x] **Exception process**: BR-CM-W3-EX1 below is the bounded inherited T3 build/deploy exception.

## Feedback Loop
- [x] BR03d-EX1 (mechanical alias of BR-CM-W3-EX1) / acknowledged by owner W3.d packet and W0 reservations: add a render-only Make target/include and CI invocation. Impact: offline qualification only; rollback: remove include/step and content resources, retain closed flags. No deploy target execution or general CI refactor.
- [x] Tenant handoff: DNS/TLS provisioning, dedicated namespace-local credentials, private bucket checkpoint/restore and actual accepted image digest remain external receipts; document exact gates without asserting live readiness.
- [x] BR03d-EX1 includes `.github/workflows/app-cm-w3d.yml`: shared CI excludes this app integration base; mirror W3.c's topic workflow for exact-head offline checks. Conductor removes topic workflows before main integration; rollback removes this topic workflow only.

## AI Flaky tests
- [x] No AI tests or flaky exception selected; deterministic manifest and denial checks only.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; merge integration updates only; no cherry-picks or rebase.

## UAT Management (in orchestration context)
- [x] Offline manifest inspection and local denial checks only; no root dev services or live browser activation.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read MASTER/workflow/testing, template, plan W3.d/dependencies/ownership, W0 reservations, W3.c entrypoint and image tests.
  - [x] Create isolated worktree and pass mechanical `harness check branch` before work.
  - [x] Freeze scope, exception, environment and ports; leave other lanes untouched.
- [ ] **Lot 1 — Tests first**
  - [x] Add `deploy/ci/artifact-content/{tests.mk,bundle-checks.mjs,bundle.selftest.mjs,network.selftest.mjs}`.
  - [x] Prove red: rendered overlays fail `Deployment/artifact-content must occur once` (0 vs 1), before any content manifest exists.
  - [ ] Test closed gates despite enabled secret values, least privilege, network peer namespace isolation, both TLS wildcard depths and exact app route precedence.
  - [ ] Test synthetic digest replacement across API/IdP/content, unchanged backup/restore access and mutation denials; Kustomize renders digest-only identity (drops the source tag).
- [x] **Lot 2 — Workload and default closure**
  - [x] Add content Deployment/Service/ConfigMap/NetworkPolicies and base registration; pin API gate env values explicitly.
  - [x] Dedicated unprivileged ServiceAccount, read-only root, bounded resources/probes, no migration command or broad app secret.
  - [x] Keep storage egress closed pending tenant-specific network/IAM receipts; health can run without secrets.
- [x] **Lot 3 — Environment routes and certificates**
  - [x] Add prod/preprod content ingress, explicit Certificate and domain patches/registrations.
  - [x] Both stable and pinned wildcard SANs, dedicated TLS secret, HTTPS-only route; no catch-all/identity headers.
- [ ] **Lot 4 — Handoff and final validation**
  - [x] Document tenant DNS/TLS/storage/restore/digest evidence and FIRST-IMMO activation gate in runbook.
  - [ ] Pass `make test-artifact-content-manifests API_PORT=8806 UI_PORT=5192 MAILDEV_UI_PORT=1099 ENV=test-app-w3d`.
  - [ ] Pass inherited IdP parent-overlay regression and W3.c static image checks as applicable.
  - [ ] Complete independent review, scope check and diff inspection; address blocking findings.
  - [ ] Create draft PR against `feat/app-cm-integration` using this file; push and verify CI on exact final head.
  - [ ] Run locked `make down ENV=test-app-w3d` and confirm no services remain.

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
