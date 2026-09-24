# Feature: Deployable LLM process specification (Lot D)

## Objective
- [x] Specify an autonomous Node/TypeScript LLM gateway process, deployment, budget admission, identity resolution through existing stores (G1b deferred), and seat-secret consumption; deliver design only.

## Scope / Guardrails
- [x] Branch `spec/llm-deployable-process`; worktree `tmp/llm-deployable-process`; requested base `origin/main` at `75032fc85`.
- [x] Read mandatory rules and template; `harness check branch` passed before editing.
- [x] No implementation, migration, package bump, publication, push, PR, or merge in this branch.
- [x] Make-only validation/commits; selective staging; English text; approximately 150 changed lines per commit.
- [x] Environment `test-llm-deployable-process`; reserved cleanup arguments `API_PORT=9460 UI_PORT=5660 MAILDEV_UI_PORT=1560`; no services planned or started.
- [x] `ENV` is last in every make command; root development environment remains untouched.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - [x] `BRANCH.md`
  - [x] `spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md`
- [x] **Forbidden Paths (must not change in this branch)**:
  - [x] All files outside the two allowed paths, including code, `.track/**`, `Makefile`, `docker-compose*`, `.github/workflows/**`, `deploy/**`, `.cursor/rules/**`, and `plan/**`.
- [x] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [x] None in this branch; future build exceptions are proposals only.
- [x] **Exception process**:
  - [x] Future `BRxx-EXn` proposals must state reason, impact, rollback, and approval gate; none authorizes a change here.

## Feedback Loop
- [x] D-N4 | conductor decision (reversible) | Owner: conductor | Date: 2026-09-24 | Status: attention | New repo-scoped Actions-secret API credential in custody with rotation is OWNER PROVISIONING; GitHub update commits before idempotent k8s delivery, pre-commit failure requires reauth_required/alert, and all triggers share concurrency with an independent freshness alert. Rationale: preserve rotating refresh tokens despite delivery failure and best-effort cron; initial SLO is 40-minute delivery age/10-minute remaining validity, verified per provider.
- [x] D-N5 | conductor decision (reversible) | Owner: conductor | Date: 2026-09-24 | Status: attention | Only the custody job creates/updates sentropic-llm-seats; exclude every kustomization/secretGenerator/prune and require optional: false. Rationale: prevent apply/rollback from rewinding generation; B5 tests waiting for first delivery and subsequent apply preservation.
- [x] D-N3 | conductor decision (reversible) | Owner: conductor | Date: 2026-09-24 | Status: attention | Option (a): host image consumes/qualifies the monorepo workspace graph; E8's exact published tuple applies only to h2a. Rationale: qualify what api/Dockerfile actually builds and keep separate B5/B7 evidence.
- [x] D-N6 | conductor decision (reversible) | Owner: conductor | Date: 2026-09-24 | Status: attention | B0 targets mesh 0.22.0, gateway 0.19.0 and cluster 0.13.0 with a new compatibility matrix before B3b; B3d qualifies it before B5/B7. Rationale: API additions exceed cluster 0.12's optional-peer ceilings; no patch assumption.
- [x] D-N7 | conductor decision (reversible) | Owner: conductor | Date: 2026-09-24 | Status: attention | Pin mcp-auth 0.2.1 and jose 5.10.0; Lot F publication and isolated service-only qualification block B0. Rationale: published 0.2.0 has broken file:../oauth-verify; cite fix/mcp-auth-oauth-verify-dep, currently in review.
- [x] D-N1 | conductor decision (reversible) | Owner: conductor | Date: 2026-09-24 | Status: attention | Option A: extend B3c to migrate product `gw.ts` to real admission, partition rejection, settlement and readiness; section 11 parity depends on it. Rationale: product identities must not bypass the standalone safeguards.
- [x] D-N2 | conductor decision (reversible) | Owner: conductor | Date: 2026-09-24 | Status: attention | Trusted server configuration owns partition assignments; cutover evidence retains only revision ids/hashes and cannot advance product dispatch generation. Rationale: separate authorization configuration from dispatch authority.
- [x] D-M1 | conductor decision (reversible) | Owner: conductor | Date: 2026-09-24 | Status: attention | Require B0 proof of `/gw` to `/` remapping; omit API-to-gateway ingress absent a real consumer; correct objective and completed-check wording. Rationale: preserve in-process product routing and accurate planning state.
- [x] O-D1 | direct owner decision | Owner: product owner via conductor | Date: 2026-09-24 | Status: acknowledge | Seat delivery (a) maintained with full knowledge: the scheduled GitHub Actions job updates the GitHub Secret and pushes the fresh access token into k8s; this is the first automated CI→cluster Secret write, with no CI precedent.
- [x] O-D2 | direct owner decision | Owner: product owner via conductor | Date: 2026-09-24 | Status: acknowledge | IRREVERSIBLE G1a BR-47 budget migration is ratified now and part of Lot D's build design; real over-budget HTTP 429 is required. G1b identity bindings remain deferred; v0 uses memberships and service_clients. No migration is executed on this planning branch.
- [x] O-D3 | direct owner decision | Owner: product owner via conductor | Date: 2026-09-24 | Status: acknowledge | Preprod first using KUBE_CONFIG_DATA_PREPROD; no production Role design now. Production seat delivery and its new security gate return to the owner only after the IP-change spike passes and the refresh/delivery loop is stable.
- [x] D-FL1 | Branch: Lot D | Owner: conductor | Severity: process | Status: attention | Repro: harness recorder/review writes extra artifacts | Expected: two-file scope | Actual: record design here and defer independent review to conductor | Evidence: owner brief | Rationale: preserve explicit planning scope; no consensus claimed.
- [x] D-FL2 | Branch: Lot D | Owner: conductor | Severity: evidence | Status: attention | Repro: search supplied roots for validation id/original phrase | Expected: original conductor artifact | Actual: no match | Evidence: spec section 0 | Rationale: retain brief attribution and independently verified code findings.
- [x] D-FL3 | Branch: Lot D | Owner: gateway/cluster maintainer | Severity: design | Status: attention | Repro: reconcile F1 with lazy-surface E1/E7 | Expected: one loading and mounting path | Actual: private Node host on port 3001 uses cluster-mesh registry/loaders/namespace module; product and external identities are partitioned per tenant | Evidence: spec D1-D3 | Rationale: preserve domain independence and existing cutover storage without another dispatcher.
- [x] D-FL4 | Branch: Lot D | Owner: ledger/identity maintainer + conductor | Severity: design | Status: acknowledge | Repro: F5 split of former G1 | Expected: budget enforcement without new identity table | Actual: G1a irreversible and ratified by O-D2; G1b deferred, v0 directory resolution | Evidence: spec D4-D5 | Rationale: existing memberships/service_clients cover v0; tenant strategy stays separate from identity.
- [x] D-FL5 | Branch: Lot D | Owner: deployment maintainer | Severity: design | Status: attention | Repro: F2/F9/F10 compare IdP precedent | Expected: independently deployable gateway | Actual: reuse scanned sentropic-api/node:24-alpine3.23 with gateway command, existing image pin, internal Service, one replica/Recreate; real CNI gate is manual preprod | Evidence: spec D6-D8 | Rationale: avoid an unnecessary image pipeline; dedicated image requires later size evidence.
- [x] D-FL6 | Branch: Lot D | Owner: custody maintainer | Severity: design | Status: attention | Repro: F3/F4/F8 and O-D1/O-D3 supersede stale custody SHA | Expected: one refresher, no token copies in backups | Actual: scheduled job updates GitHub Secrets and preprod projection with generation CAS; projection resolver verifies DB owner once, never persists custody tokens or refreshes them; provider revocation per device | Evidence: spec D7/B4 | Rationale: apply owner decisions; operator bundle retains DATABASE_URL/runtime-key delivery; prod credential design deferred.
- [x] D-FL7 | Branch: Lot D | Owner: conductor/deployment operator | Severity: future execution gate | Status: attention | Repro: F9 scope reconciliation | Expected: bounded build exceptions | Actual: EX1 includes preprod rollout-status and operator bundle, EX3 narrows CI, EX4 deploy, EX5 ratified G1a; EX2 dropped; B1 root manifests conditional, .security only for a later new image; custody write identity stays cross-lane | Evidence: spec sections 8-11 | Rationale: no pending irreversible Lot D decision; future scoped edits/G3 checks remain execution gates, prod seats deferred.
- [x] D-FL8 | Branch: Lot D | Owner: gateway/mesh/ledger maintainers | Severity: design | Status: attention | Repro: F6/F7/F10 admission review | Expected: enforced caps without duplicate rows | Actual: no recordLlmUsage in standalone; shared key upsert if composed observation remains; Retry-After capped at 60s; quote seam decided in B0, B3 split by owner | Evidence: spec D5/B0/B3a-c | Rationale: preserve frozen wire and one settlement row; any mapping change needs a separate wire-contract decision.
- [x] D-FL9 | Branch: Lot D | Owner: backup maintainer | Severity: residual risk | Status: attention | Repro: F11 inspect deploy/k8s/base/70-pgbackup-cronjob.yaml | Expected: owner's no-Python rule | Actual: existing amazon/aws-cli:2.34.53 runtime uses Python | Evidence: spec D7 | Rationale: flag existing backup dependency only; remediation is outside the two-file scope.
- [x] D-FL10 | Branch: Lot D | Owner: cluster/gateway maintainers | Severity: build dependency | Status: attention | Repro: re-read both revised sibling specs on resume | Expected: matching service/session auth leaves | Actual: gateway separates /auth and /auth-hono; lazy-surface still describes a shared /gateway/auth-hono bridge | Evidence: spec sections 0/D4/B0 | Rationale: require cluster leaves/loaders matching Lot 2 and isolated packed tests before B1; preserve one loading path and edit neither sibling here.

## AI Flaky tests
- [x] Not applicable: documentation-only branch; no provider calls or runtime tests.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, single writer; no cherry-pick or delegated implementation.
- [x] Multi-branch execution is deferred to the conductor for future build lots.

## UAT Management (in orchestration context)
- [x] No web, Chrome, or VSCode behavior changes; user-interface UAT is not applicable here.
- [x] Specify operational UAT for standalone/composed gateway, tenant isolation, budgets, seat rotation, and rollout in the spec.

## Plan / Todo (lot-based)
- [x] **Lot D — Revision round 2 (N1-N7 and minors)**
  - [x] Routing group: extend B3c/product parity; separate partition configuration from dispatch generation; apply namespace, ingress and branch-wording minors.
  - [x] Qualification group: distinguish workspace image from h2a published tuple; freeze new minor compatibility targets and mcp-auth/jose prerequisites; cite the Lot F replacement.
  - [x] Custody group: specify owner-provisioned API credential, durable GitHub commit order, concurrency/freshness monitoring and job-only Secret ownership, with B4/B5 acceptance evidence.
  - [x] Reviewed N1-N7/minors across decisions, build dependencies and acceptance; recorded D-N1..7/D-M1 as attention conductor decisions (reversible), preserving O-D1/O-D2/O-D3.
  - [x] Checks passed: `harness check branch`, `git diff --check origin/main`, and `make scope-check ENV=test-llm-deployable-process` for each revision group; only the spec and this file changed.
  - [x] Cleanup passed: `make down API_PORT=9460 UI_PORT=5660 MAILDEV_UI_PORT=1560 ENV=test-llm-deployable-process`; `make ps API_PORT=9460 UI_PORT=5660 MAILDEV_UI_PORT=1560 ENV=test-llm-deployable-process` returned no services. Only the unset DISABLE_RATE_LIMIT Compose warning appeared; no services were started.
  - [x] Planning-only validation: runtime tests/build qualification remain future-lot evidence, independent review stays conductor-owned, and publication/owner provisioning/manual preprod gates remain explicit. No scope exception, infrastructure edit, push, PR, merge or publication.
- [x] **Lot D — Revision round 1 (F1-F11)**
  - [x] Re-read required rules/template and both sibling specs read-only; mechanical branch check passed. Resume found F1/O-D1..3 committed at 4d0d79484 and two staged files, no unstaged edits; preserved and committed that fix group at 5606bb36b.
  - [x] Record O-D1/O-D2/O-D3 as direct owner decisions; later decisions supersede earlier review requests.
  - [x] F1: cluster-mesh loading/mounting, per-tenant identity partition, existing composition-root cutover record, h2a host retirement and dependency handoff.
  - [x] F5/F6/F7/F10: ratified G1a, deferred G1b, one ledger row, bounded retry hint and split admission lots with B0 quote decision.
  - [x] F3/F4/F8/F11: current custody source/refresher/projection resolver, preprod-only write identity, operator DB-secret channel and backup residual risk.
  - [x] F2/F9/F10: reuse API image, narrow exceptions/CI, manual G3 network gate and reconcile build/acceptance plan.
  - [x] Reviewed F1-F11 and final diff; branch and whitespace checks passed, scope passed before each fix-group and handoff commit, cleanup/ps passed with no services; collected history/status. Independent review remained conductor-owned; no pending irreversible Lot D decision.
- [x] **Lot 0 — Evidence and scope**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/testing.md`, `plan/BRANCH_TEMPLATE.md`, project overview and relevant plan context.
  - [x] Create this file before the specification; verify branch mechanically and inspect make targets.
  - [x] Read package exports/router/stubs, h2a entry point, deployment manifests/readme, quota/metering/routing/control-plane specs, and in-progress seat custody.
  - [x] Locate original conductor wording or document an explicit evidence limitation (D-FL2).
  - [x] Gate: `make scope-check ENV=test-llm-deployable-process` passed before the initial plan commit.
- [x] **Lot 1 — Process and deployment design**
  - [x] Write `spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md`: evidence, numbered decisions, entry point ownership, image, namespaces, probes, k8s and secrets.
  - [x] Specify which h2a responsibilities move upstream and which stay consumer-owned.
  - [x] Gate: source-contract review and `make scope-check ENV=test-llm-deployable-process` passed on preceding process/admission commits; repeat before each remaining commit.
- [x] **Lot 2 — Admission, identity, and delivery plan**
  - [x] Specify ledger-backed over-budget emission and seat consumption; revision round 1 supersedes the initial identity-table proposal with v0 directories, ratified G1a and deferred G1b.
  - [x] Specify CI image build/publish, future `BRxx-EXn` exceptions, lot dependencies, file-level tests and operational UAT.
  - [x] Classify reversible defaults and irreversible future gates; record decisions in Feedback Loop.
  - [x] Gate: source-contract review and `make scope-check ENV=test-llm-deployable-process` passed on preceding delivery commit; repeat before final commit.
- [x] **Lot 3 — Consolidation and final validation**
  - [x] Reconcile all requested deliverables against existing contracts; spec sections 0-11 name evidence, decisions, file-level build tests, future exceptions and unresolved dependencies.
  - [x] Review every diff hunk; `git diff --check origin/main` and `harness check branch` passed. Runtime typecheck/lint/test are not applicable to prose; future recipes are explicitly marked unexecuted.
  - [x] `make scope-check ENV=test-llm-deployable-process` passed before each preceding commit; final staged scope gate is required again for this completion commit.
  - [x] Commit only the two allowed files via `make commit`; preserve `BRANCH.md` for conductor handoff; no push/PR/merge/publication.
  - [x] Cleanup passed: `make down API_PORT=9460 UI_PORT=5660 MAILDEV_UI_PORT=1560 ENV=test-llm-deployable-process`; `make ps API_PORT=9460 UI_PORT=5660 MAILDEV_UI_PORT=1560 ENV=test-llm-deployable-process` returned no services. Compose only warned that `DISABLE_RATE_LIMIT` is unset; no service was started.
  - [x] Prepare handoff with exact checks, O-D1..3/D-FL1..10, G1a/G1b/G2-G4 risks, two-file scope, and final `git log --oneline origin/main..HEAD`.
