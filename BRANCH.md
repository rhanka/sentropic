# BR-73: LLM mesh/gateway consumer-neutral routing

Status: ACTIVE — implementation phase
Branch: `feat/llm-mesh-gateway-routing`
Worktree: `tmp/llm-mesh-gateway-routing`
Base: `origin/main` at `feebc6769aac8bd313d84310b1f0d66d07b68ee1`
Track feature: `01KZHZCNN1CR98NCE9KB7ZZM8G`
Track imported branch root: `01KZHZDBD07V5DJ5TBW7WRHV1D` (workspace `br-73`)
Canonical evolution spec: `spec/SPEC_EVOL_LLM_MESH_GATEWAY_ROUTING.md`

## Objective

Make `@sentropic/llm-mesh` the single control plane for provider-neutral model
routing and account policy, while keeping `@sentropic/llm-gateway` a thin,
wire-faithful data plane. Restore consumer choice across enrolled Codex, Claude
Code, Cloud Code, and future transports; add bounded, configurable failover;
and give h2a enough public configuration to integrate without owning routing
knowledge.

## Owner-ratified decisions

- Default route precedence is last successfully enrolled first. Consumers such
  as h2a must wire all public options and must not hardcode Cloud Code.
- Routing policy and the model-equivalence council belong to `llm-mesh`.
- Equivalence entries are benchmark-backed, overridable, and mandatory to
  update or explicitly exclude whenever a model is added to the mesh catalog.
- The gateway remains usable in every direction: for Claude Code, Codex, AGY,
  OpenCode, Hermes, and future provider-compatible clients.
- Default fallback mode retests the preferred route after a configurable
  negative-cache TTL (default 5 minutes) and prefers the same account-transport
  type. An automatic one-way failover mode is also supported.
- Session routing is strictly sticky by default. Rotation between equivalent
  accounts is opt-in and discouraged because upstream context/prompt cache
  continuity is not guaranteed.
- Existing Codex credentials are not inferred from legacy consumer state;
  consumers must re-enrol Codex through the current mesh contract.
- Sentropic lands and publishes the two libraries first. h2a then performs the
  local consumer integration and functional UAT before this branch may merge.

## Scope / guardrails

- No edits in the h2a repository. h2a owns its consumer integration.
- Dependency direction is `llm-gateway -> llm-mesh`, never the reverse.
- No provider call may be retried after the first response byte is emitted.
- Routing/failover never bypasses caller ownership, credential precedence,
  account eligibility, or the cross-user pooling kill switch.
- Secrets and refresh tokens never enter routing plans, logs, discovery output,
  equivalence artifacts, or gateway responses.
- All commands use repository Make targets; `ENV=` is last when applicable.
- Automated tests use `ENV=test-br73-llm-routing`; no service uses root `dev`.
- New text, code, comments, and artifacts are in English.

## Branch Scope Boundaries (MANDATORY)

- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `PLAN.md`
  - `plan/done/73-BRANCH_feat-llm-mesh-gateway-routing.md` (closure only)
  - `spec/SPEC_EVOL_LLM_MESH_GATEWAY_ROUTING.md`
  - `docs/reviews/llm-mesh-gateway-routing/**`
  - `docs/uat/2026-08-*-llm-mesh-gateway-routing*.md`
  - `.track/events.jsonl`
  - `.track/head.json`
  - `packages/llm-mesh/README.md`
  - `packages/llm-mesh/package.json`
  - `packages/llm-mesh/src/**`
  - `packages/llm-mesh/tests/**`
  - `packages/llm-gateway/README.md`
  - `packages/llm-gateway/package.json`
  - `package-lock.json` (`BR73-EX1` only)
  - `packages/llm-gateway/src/**`
  - `packages/llm-gateway/tests/**`
  - `scripts/llm-model-equivalences/**`
  - `Makefile`
  - `.github/workflows/ci.yml`
- **Forbidden Paths (must not change in this branch)**:
  - `api/**`
  - `ui/**`
  - `e2e/**`
  - `deploy/**`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - every other `packages/**`
  - every other repository, including `/home/antoinefa/src/h2a/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - Root lockfiles only if a package dependency changes; no dependency change is
    currently planned.
  - Any extra CI workflow beyond `.github/workflows/ci.yml` requires `BR73-EXn`.
- **Exception process**:
  - Declare `BR73-EXn` here with reason, impact, rollback, and owner approval
  before touching any conditional or forbidden path.
- `BR73-EX1` (owner-approved by the accepted package-floor decision): update
  the root lockfile only for the gateway dependency floor and the two package
  versions. Impact is lock metadata only; rollback is the matching lockfile
  hunk if either package bump is reverted.

## Environment and agent slots

- Main implementation slot 0: Codex conductor; API `9365`, UI `5565`, Maildev
  `1465`; `ENV=test-br73-llm-routing`.
- Design reviewers are read-only and receive no service slot.
- h2a UAT runs in the h2a-owned repository/environment and must report the exact
  Sentropic candidate commit/package versions it integrated.

## Orchestration mode

- [x] Mono-branch, ordered lots.
- [ ] Multi-branch.

Rationale: mesh and gateway form one public contract and gateway consumes mesh;
one candidate commit is required for h2a integration/UAT. Independent review
agents are read-only and do not create implementation branches.

## Feedback loop

- `BR73-F1` (`clarification`, resolved by owner): default ordering, routing
  ownership, fallback modes, same-transport preference, stickiness, migration,
  publication order, and h2a responsibility are captured above and in the spec.
- `BR73-F2` (`attention`, resolved 2026-08-08): Gemini 3.6 High and h2a reviewed
  exact v1 SHA-256 `e260831...d82`; all blocking/major findings are reconciled
  in accepted design v2 and archived under `docs/reviews/`.
- `BR73-F3` (`attention`, open): h2a must complete local integration and
  functional UAT on the exact PR candidate before merge.
- `BR73-F4` (`attention`, open): package versions must be verified against npm
  before bump and rechecked after final rebase; publication is CD-only.

## Plan / todo

- [x] **Lot 0 — Branch, durable state, and specification**
  - [x] Create isolated worktree from current `origin/main`.
  - [x] Pass `harness check branch` in the worktree.
  - [x] Register BR-73 in `PLAN.md`.
  - [x] Create/import the Track feature and declare acceptance; harness scope
    remains authoritative because Track permits scope declarations only on
    workpackage/spec-phase containers.
  - [x] Write the canonical two-package SPEC_EVOL.
  - [x] Record a review dossier tied to the exact spec hash.
  - [x] Obtain Gemini 3.6 High adversarial design review.
  - [x] Notify h2a, ask for its independent consumer review, and record the
    response without editing h2a.
  - [x] Reconcile both reviews; amend spec/plan/Track before implementation.
  - Lot gate: no product source change while `BR73-F2` is open.

- [x] **Lot 1 — Mesh routing control plane**
  - [x] Move canonical target/alias routing knowledge from gateway into mesh.
  - [x] Add typed equivalence-council records with evidence, freshness,
    capabilities, account-transport preferences, and explicit exclusions.
  - [x] Add catalog-completeness validation: each new model is classified in
    the council or carries a documented exclusion.
  - [x] Add a deterministic refresh/check recipe for CI and operator updates.
  - [x] Add route planning with last-successful-enrolment precedence, explicit
    overrides, same-transport preference, health/cooldown and negative cache.
  - [x] Add ordered, new-affinity round-robin and per-model rule strategies
    with validated, atomically activated named profiles.
  - [x] Add owner-bound expiring plan/candidate references and opaque prepared
    attempts; gateway receives no provider credential or account id.
  - [x] Add configurable fallback modes (`retest-preferred` default and
    `one-way`) with injectable clock and bounded pre-first-byte candidates.
  - [x] Preserve strict sticky account/session routing by default; expose
    equivalent-account rotation only as an explicit discouraged policy.
  - [x] Add audited affinity describe/promote/reset/rebind with race-safe
    revisions and provisional new-affinity leases.
  - [x] Export redacted route discovery and diagnostics with reason codes.
  - [x] Unit tests: precedence, overrides, capability rejection, equivalence
    freshness/completeness, TTL expiry, one-way mode, same-transport ordering,
    strict stickiness, opt-in rotation, owner replay/TOCTOU rejection, health
    scopes, secret redaction, policy profiles and fake-clock behaviour.
  - Lot gate: `make typecheck-llm-mesh`; scoped and full
    `make test-llm-mesh`; `make build-llm-mesh`; `make pack-llm-mesh`.

- [x] **Lot 2 — Gateway execution data plane**
  - [x] Consume mesh route plans; remove gateway-owned canonical mappings.
  - [x] Keep compatibility re-exports for one release when source-compatible.
  - [x] Execute the bounded candidate sequence only before response commitment.
  - [x] Preserve lossless canonical tools/tool-results/images/thinking/usage/
    stop/header/error events and add the Codex/OpenAI execution adapter.
  - [x] Classify retryable availability/auth/quota outcomes and report them to
    mesh without owning durable health policy.
  - [x] Preserve Anthropic/OpenAI wire, SSE ordering, response headers,
    provider-shaped errors, caller auth, metering, quota and kill switches.
  - [x] Keep `/v1/messages` and `/v1/chat/completions` compatible; do not replace
    either wire with `/v1/responses`.
  - [x] Provide ingress-neutral configuration for Claude Code, Codex, AGY,
    OpenCode, Hermes and compatible clients.
  - [x] Tests: candidate execution, no retry after first byte, provider-shaped
    terminal error, cancellation, ownership isolation, bounded attempts,
    headers/SSE fidelity, capability fail-fast, aggregate cost, compatibility
    exports, no secret/account disclosure.
  - Lot gate: `make typecheck-llm-gateway`; scoped and full
    `make test-llm-gateway`; `make build-llm-gateway`;
    `make pack-llm-gateway`.

- [ ] **Lot 3 — Versioning, docs, CI and package candidate**
  - [x] Update both READMEs with ownership, policies, overrides and cache caveat.
  - [x] Wire equivalence freshness/completeness validation into Make and CI.
  - [x] Verify current registry versions through the repository recipe.
  - [x] Bump `@sentropic/llm-mesh` and `@sentropic/llm-gateway` with compatible
    dependency range; refresh lock data only if required.
  - [x] Re-run all typecheck/test/build/pack gates for both packages.
  - [x] Run `make scope-check` before each atomic commit.
  - [ ] Push and open/update the PR using this file as source of truth.

- [ ] **Lot 4 — h2a local integration and functional UAT**
  - [ ] Send h2a the exact PR commit, package versions and integration contract.
  - [ ] h2a wires route/fallback/stickiness options without copied route tables.
  - [ ] h2a locally integrates the candidate packages and exercises a real
    Claude session through its gateway after enrolment.
  - [ ] UAT covers last-enrolled default, explicit selection, unavailable-model
    fallback, cooldown/retest, same-account-type preference, streaming, compact
    continuation, logout/re-enrolment, and no Cloud-Code-only regression.
  - [ ] h2a returns exact commands, versions/SHA, observable outcomes and a
    signed pass/fail; record under `docs/uat/`.
  - [ ] Fix blocking feedback and repeat affected gates/UAT.

- [ ] **Lot 5 — Final validation and merge**
  - [ ] Rebase on current `origin/main`; re-run harness branch check.
  - [ ] Reverify npm versions after rebase and confirm both bumps are unique.
  - [ ] Full mesh/gateway typecheck/test/build/pack and equivalence CI check.
  - [ ] `make scope-check` passes with no undeclared paths.
  - [ ] GitHub CI is green and h2a UAT is accepted on the final candidate.
  - [ ] Use branch-lifecycle event-loss check and acceptance refresh.
  - [ ] Archive this file to
    `plan/done/73-BRANCH_feat-llm-mesh-gateway-routing.md` and remove root
    `BRANCH.md` in the final pre-merge commit.
  - [ ] Merge the PR; verify CD publishes both new package versions.

## AI-flaky policy

Only nondeterministic provider/network behaviour may be classified as flaky,
and only after one success on the same commit and command. All routing tests use
fake clocks and fake transports and therefore are deterministic; any failure in
them blocks merge. No timeout-only amendments are accepted.

## Closure evidence

- Track feature specified, realized and acceptance-linked.
- Two independent spec review artifacts reconciled.
- Exact local and CI commands with results recorded here or in PR checks.
- h2a integration/UAT artifact names the final candidate SHA and versions.
- Both package versions visible on npm only after merge-triggered CD.
