# Feature: GB1 build contract validation

## Objective
- [ ] Validate the frozen G0 v3 build descriptor without executing installs or scripts.

## Scope / Guardrails
- Scope limited to the app cutover: api identity read/write paths, one control data migration, ui F11 screens, e2e; plus G6 CM-consumption swaps and the G7 ops replacement (scripts + idp-identity-sync overlays).
- One migration max: `api/drizzle/control/0015_app_cm_identity_cutover.sql` (control stream; slot 0015, main owns 0014).
- Make-only workflow, no direct Docker commands; each Docker-using make command through `.tmp/packets/docker-slot.sh make ...`, one slot per command, never nested; `make down-volumes ENV=<env>` after every test stack.
- Branch development in isolated worktree `tmp/worktrees/app-cm-a4-3` on branch `feat/app-cm-a4` (base `main` since #882 merged; PR #879 retargeted).
- Test campaigns on `ENV=test-a4-cutover` (ENV last), never root dev; never `ENV=dev`.
- All new text in English.
- No dual writer, no legacy fallback; the app keeps business data only.
- Pins: a4-cm-gaps-r2.md (binding design, lots G0/G6/G7); A2.0b amendment r6 sha256 5bde078cd12a35fb752eadb48496f0373dc8940883c701b920878a165; owner-answers-20261030.md (Q-G interim accepted; Q-K=A with HMAC + .env/k8s rotation; Q-WS1 deleted-with-workspace; Q-IDP1 case-by-case with nominative consent); PR #879 base `main` at `b9cdb2d33` (train #914; G1–G5 arrived via #912 `a1d0a815a`).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `docker-compose.test.yml` (BRxx-EX16)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/src/server/build-*.ts`
  - `packages/artifacts/src/server/failures.ts`
  - `packages/artifacts/package.json`
  - `packages/artifacts/tests/build-contract.test.ts`
  - `packages/artifacts/tests/fixtures/build-contract/**`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `package-lock.json`
- **Conditional Paths**: none.
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- [x] A4-CLOSE-DELETE-DIAG — CI 42132522076 identifies SQLSTATE 40001 at the account phase while other CM transactions create workspaces. A local concurrent-writer regression reproduces the rolled-back receipt. The host now acquires a shared writer gate before ordinary write snapshots, exclusive for qualified delete operations, across API replicas. Read-only authentication stays concurrent; ordinary writers remain parallel; failed connections release their gate on destruction. Gate wait consumes the existing deadline, with unchanged attempts/budgets. Deletion, workspace, authentication, consent and host-scope suites: 34/34 passed; API typecheck/lint passed.
- [x] A4-CLOSE-CHAT-SWITCH — CI 42134359400 passes all six E2E shards, including the unchanged chat session/workspace switching scenario (4.8 seconds), all presence/lock cases and the admin lifecycle. No separate speculative chat UI change or browser retry was introduced.
- [x] A4-CLOSE-PROVISION-CONCURRENCY — CI 42134359400 endpoint shard 3 exhausted serializable attempts while creating two distinct accounts in parallel. A 16-account provisioning regression reproduced the same predicate conflict. Root account provisioning now drains competing writers before its snapshot through the existing exclusive gate, without changing attempts/deadlines. Provisioning, tenant-metrics and deletion suites: 11/11 passed; the original metric response assertions remain exact.
- [x] A4-CLOSE-RESTORE-SCHEMA — The real production-dump import/boot now completes. Port restore smoke checks to the CM identity tables and equivalent credential/user/expiry indexes, require legacy-table absence and the exhaustive invalidation receipt. Scoped Schema Validation: 4/4 passed.
- [x] A4-CLOSE-CONSENT — CI 42127383445 shows a consent-details 503 while concurrent settings requests run on the same admin session. A PostgreSQL activity-write conflict reproduces 503 for otherwise valid consent. GET consent now uses the read-only runner, with no activity mutation; current session/account/client policy checks remain. Retain typed custody code/SQLSTATE only at unexpected HTTP failures. Fan-out and conflict regressions keep their 200 assertions; no retries are added.
- [x] BRxx-EX17 — Closing restore CI 42127383445: preserve the legacy critical session user/expiry indexes on CM-owned login sessions in the canonical custody schema. Rationale: the restored database now has CM identity tables, while its smoke assertions still inspect removed public tables/indexes; CM also lacked the two equivalent session lookup indexes. Impact: two additive indexes in the existing canonical schema application, with equivalent schema assertions plus legacy-absence and import-receipt checks. Rollback: revert the index declarations and smoke mapping together before cutover; no extra migration or data change.
- [x] BRxx-EX16 — Closing CI 42127383445: provide the existing synthetic API-test deletion budgets in `docker-compose.test.yml` for the E2E API. Rationale: A4 introduced mandatory qualified operation budgets; the browser stack supplies no record, so account and workspace deletion fail closed with 503. Impact: test stacks receive explicit 10,000 ms / one-attempt budgets and a synthetic receipt reference; production still requires its protected qualification record, and browser assertions/timeouts/retries are unchanged. Rollback: remove the test environment entry.
- [x] A4-CLOSE-COMMENTS — Translate authoritative tenant refusal after workspace authorization into HTTP 403 without masking unexpected failures. Approved creators can read comments immediately after atomic workspace provisioning (four concurrent reads); a withdrawn tenant grant is denied with no comment mutation. Tenant and workspace grants remain independent and fail-closed.
- [x] A4-CLOSE-PRESENCE — Project email/display name from the validated CM account rather than absent JWT presentation claims. Bind pooled PostgreSQL notification callbacks to the SSE subscriber context so identity reads do not borrow an unrelated expired UOW. Regression probe reproduced the inherited context before the fix and passes after it; no polling timeout or retry change.
- [x] A4-CLOSE-MEMBERS — Restore the workspace-admin-only members section and its existing h4 heading. The transport still derives mutation authority from committed workspace memberships; access-control E2E flow and assertions are unchanged.
- [x] A4-IMPORT-EPHEMERAL — Owner decision B (2026-11-05): no email code/ticket, magic link, WebAuthn challenge or login session/refresh token is imported, for either rehearsal or real cutover. Counts by type are bound to the manifest and retained in the cutover receipt. Re-request a code and log in after cutover. Source column and shape validation, remote divergence refusal, invitation hashes, passkeys, provider-secret refusal and connector custody remain fail-closed. Supersedes the earlier ticket/session preservation acceptance; no production signing seed enters CI.
- [x] BRxx-EX15 — Owner 2026-11-05 closing packet: allow `packages/cluster-mesh/src/identity-contracts/accounts.ts`, `packages/cluster-mesh/src/storage/identity/atomic-deletion.ts`, `packages/cluster-mesh/tests/identity-lifecycle.spec.ts` and the app deletion authorizer/tests to restore admin disable/delete of pending accounts. Rationale: main permits moderation before approval; A4 introduced incompatible state guards in both the lifecycle and V2 deletion coordinator. Impact: pending non-admin accounts can be disabled or deleted by an authorized admin; self-action, protected-admin and active-delete refusals remain. Rollback: revert these guard/test hunks together. Existing branch package bump covers the changed CM source.
- [ ] A4-CLOSE — Owner 2026-11-05: invalidate every inventoried ephemeral identity proof and open login at import in both rehearsal and real cutover, record per-type counts, preserve all other fail-closed checks; restore workspace member UI and presence parity; resolve fresh-workspace comment failures; local ENV=test-a4-fix2, API_PORT=8796 UI_PORT=5196 MAILDEV_UI_PORT=1096; push and watch PR #879 until green; do not merge. Mergeable Track source for the designated conductor writer.
- [x] A4-TEST-POLICY — Declare the API Vitest configuration for synthetic fixture policy only; production Q-K remains required. The first C2 check flagged this previously undeclared path but exited zero, and commit 3f587bf61 proceeded. The declaration is corrected here; subsequent gates must inspect PASS text as well as the exit status. Rollback: revert the test env entry; no production configuration changes.
- [x] BRxx-EX1 — Approved r2 F11 requires CM-owned screens. Allow only `packages/cluster-mesh/ui/**`, `tests/ui/**`, its browser exports/optional peer metadata, and root/UI lock/dependency entries needed to mount them. Backend CM source/tests stay excluded. Impact: one shared screen behavior across root projections; publication/version validation is required after rebase. Rollback: revert the UI projection/package commits together before activation; no data or A2.0b branch changes.
- [x] A4-STACK — delivered by the A2.0b merge (#882) and the G1–G5 train (#912, `a1d0a815a`, carried on `main` through train #914 `b9cdb2d33`): UOW, auth-hono binding/runner, importer, V2 planes and all P1–P6 contracts are on `main`.
- [x] A4-AUTH-BINDING — delivered by the merges above; the app binding/runner mounts and the mounted-route suites run in the cutover campaign.
- [x] A4-WORKSPACE-DELETE — P5 `createAtomicWorkspaceDeletionV1` on `main`; the app DELETE route is bound to it (G6 series 4), 503 branch deleted.
- [x] A4-MEMBERSHIP-SEAM — P2 boundary domain/port on `main`; the app seam is deleted (G6 series 2), resolution goes through the CM port.
- [x] A4-SERVICE-TENANCY — P3 issuer + binding `serviceTenancy` on `main`; the app selector is deleted (G6 series 3), OBO is CM-owned.
- [x] A4-CONSENT-READER — P4 `oauthTenantStoreV1` on `main`; the app reads authority and bindings through the finders (G6 series 1), no bound SQL reader survives outside the recorded artifacts JOIN.
- [x] BRxx-EX2 — G7 replica runners must ship in the api image: allow `api/package.json` build entries for `identity-replica-export.ts` and `identity-replica-sync.ts` only (same esbuild flags as the `oauth-register-client.ts` precedent, no dependency or version change). Impact: two extra bundled scripts in `dist/scripts/`; no new image, no new dependency. Rollback: drop the two bundle segments and the runner files together.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single integration branch, single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: one integration branch merging ready wagon heads; wagons were built and tested on their own branches.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- No UI surface changes in wagons E + F; UAT = package suites + scoped api lanes + CI. No browser UAT for this train.
- Execution flow (mandatory):
  - Develop and run tests in `tmp/worktrees/train-next`.
  - Push branch before CI.
  - No root-workspace UAT needed (no app surface changed).

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `.tmp/packets/COMMON-RULES.md`.
  - [x] Create isolated worktree `tmp/worktrees/train-next` on branch `release/train-next` from `origin/main` (HEAD fa7199852).
  - [x] Verify wagon heads: E `chore/ci-ai-tests-scoped` = fe78bfcbf; F `feat/artifacts-sqlite-u1` = 0d4acee17; neither touches `.track`.
  - [x] Confirm command style: `/home/antoinefa/src/sentropic/.tmp/packets/docker-slot.sh make … ENV=test-train-next` with `ENV` last, one slot per make command, never nested.
  - [x] Confirm scope boundaries declared above (TN01-EX2/EX3/EX5/EX6/EX9).
  - [x] Environment mapping: `ENV=test-train-next` for every test lane; no custom ports (disposable compose services per make target).
- [x] **Lot 1 — Merge wagon E (`chore/ci-ai-tests-scoped` @ fe78bfcbf)**
  - [x] `git merge --no-ff chore/ci-ai-tests-scoped`; resolve conflicts as UNION (`BRANCH.md` keeps this train doc; only BRANCH.md conflicted).
  - [x] Lot gate: merge shows only wagon-E paths; E tip is an ancestor of HEAD; `.track/` untouched.
- [x] **Lot 2 — Merge wagon F (`feat/artifacts-sqlite-u1` @ 0d4acee17)**
  - [x] `git merge --no-ff feat/artifacts-sqlite-u1`; resolve conflicts as UNION (BRANCH.md + regen-owned files; no markers left).
  - [x] Normalize 0.3.0 to 0.2.14 (`packages/artifacts/package.json`, `ARTIFACTS_PROVIDER_VERSION`, CHANGELOG heading); keep main's cluster-mesh `0.26.0-dev.8` and peer range `>=0.2.0 <0.3.0`.
  - [x] Union root-cause repair (TN01-EX10): wagon F base predates G2/LOT1; restored main's presigner deps, four subpath exports, mcp-core byte-stable block, CHANGELOG 0.2.13 section, registry test file, catalog range.
  - [x] Union port fix: sqlite management unit + store ACL paths + `artifact_access_events` table follow the G2 sharing port (`accessMode`/`changed`, `recordEvent`, authoritative `access_mode`); conformance assertions updated to G2 semantics.
  - [x] Lot gate: both wagon tips are ancestors of HEAD (`git merge-base --is-ancestor`); `.track/` untouched.
- [ ] **Lot 3 — Versions + regeneration ONCE through make**
  - [x] Registry check through a repo make target: `qualify-published-install` proves 0.2.14 free (`is not published`) and 0.2.13 published (install exit 0, resolved integrity).
  - [x] `typecheck-artifacts` green after the union port fix (0 errors).
  - [x] `make lock-root` (TN01-EX2): version/range lines only (artifacts 0.2.14, cluster-mesh dev.8, llm-gateway 0.22.4); presigner restored after the package.json union repair.
  - [x] APP-P1 pin recompute (TN01-EX6): the boot oracle refused the main digest, so the true digests were computed in-container from the repo code — profile `9d216231…` unchanged, manifest 0.2.14 `8e80ebf4…`; history chain 0.2.5–0.2.13 verified identical; `cluster-registry.ts`, both pin tests and the 0.2.13/0.2.14 chain entries updated.
  - [x] `make lock-api` (TN01-EX2): no diff, already in sync.
  - [x] Cluster-mesh `selected` fixture re-pin (TN01-EX3): fixture `package.json` restored to the base tuple with the train versions (mesh dev.8, artifacts 0.2.14); sibling receipt packed via `pack-artifacts` (guard pass, sha256 `48a1530d…`) and collected; `refresh-lazy-package-lock` green; lock carries the packed bytes at the registry URL form; tuple-spec integrity synced to the verified `sha512-5k7YRUpu…`; `test-lazy-package` 135/135 green.
  - [ ] `make memory-l5-pack STAGE=pre-candidate …` + `make memory-l5-verify` (TN01-EX5) — requires a clean tree, runs after the regen commits.
  - [ ] Cluster-mesh `selected` fixture re-pin through `packaging.mk refresh-lazy-package-lock` (TN01-EX3).
  - [ ] APP-P1 pin recompute through make if the pin tests fail on the union (TN01-EX6).
  - [ ] `make memory-l5-pack STAGE=pre-candidate …` + `make memory-l5-verify` (TN01-EX5).
  - [ ] Lot gate: `make scope-check` PASS C2 before any commit.
- [x] **Lot 4 — Final validation (all on `ENV=test-train-next`, LAST)**
  - [x] Typecheck & lint: `typecheck-artifacts` green (0 errors) + `lint-artifacts` green + `typecheck-api` green (no `error TS`).
  - [x] Scoped lanes: sqlite-conformance 20/20, sqlite-export 2/2, adapter-conformance.integration 36/36 both backends (pg lane needed the full 0001–0008 migration chain, fixed in-train), `test-lazy-package` 135/135, `test-ci-expected-results` 28/0.
  - [x] Api pin lanes: app-mcp-registry 25/25, app-mcp-installed 2/2, artifacts-host-publication 17/17 (APP-P1 0.2.14 digest `8e80ebf4…` confirmed by the running service).
  - [x] AI scoped lane: `initiative-generation-async` + `executive-summary-sync` 4/4 green on the union (owner green-at-least-once satisfied; root-cause wait fix from wagon E holds).
  - [x] Pre-existing MCP tool definitions byte-identical (tools/list snapshot 1/1).
  - [x] `make down-volumes ENV=test-train-next` last (stack + volumes removed, no test-train-next containers left).
- [ ] **Lot 5 — PR + wagon closure + report** (in progress)
  - [ ] Atomic commits via `make commit MSG="…"` (specific `git add` only, BRANCH.md checkboxes updated in the same commits); `make scope-check` PASS C2 before every commit; no AI trailers; no `[skip ci]`.
  - [ ] Push `release/train-next` to origin; open exactly one READY PR (body = this BRANCH.md); comment #908 and #891 as superseded by the train PR and close them; do NOT merge the train PR.
  - [ ] Report every step and every CI run id to `.tmp/rv/train-next.md` (root workspace).
- [ ] **Lot 6 — Single CI watch** (in progress)
  - [x] PR #914 `pull_request` events spawned no Actions run: `opened` + `synchronize` + `reopened` all produced zero check-runs and zero workflow runs (same quirk as wagon F's first push; `ci.yml` YAML valid, base=main correct, workflow active, global Actions flow healthy). Triggered the single CI with a normal content commit, then close/reopen — still nothing.
  - [x] Manual dispatch (wagon-F precedent): `gh workflow run CI --ref release/train-next` → run 41842605281 (`workflow_dispatch`, in progress). This is the one and only CI run on the final head; empty-commit budget (3, owner-authorized) untouched. Pull-request event delivery for #914 to be investigated owner-side.
  - [ ] Watch the single PR CI; fix real failures at the root; if only the AI shards fail, retrigger with an empty commit, up to 3 times (owner-authorized).
- [ ] **Lot 7 — Train fix pass (rebase onto A4 main + reviews E1/F1 + wagon G)**
  - [x] Rebase onto origin/main (a1d0a815a, A4 train): already contained; union keeps this train BRANCH.md with the BRLOCK-EX1 line; generated files re-taken then regenerated in the single pass below.
  - [x] E1 root fix (TN01-EX11): `ai` filter covers `api/src/config/**`, `api/src/services/comments/**`, `context-*.ts`, `document-*.ts`, `packages/llm-gateway/**`; self-test `scripts/check-ci-ai-filters.sh` green on fixed filter, red on pre-fix filter (11 paths); wired into the `changes` job.
  - [x] Merge wagon G (`feat/artifacts-files-parity-lot2` @ 6546031d0) with `git merge --no-ff`; conflicts resolved as UNION (train BRANCH.md kept; version stays 0.2.14); no markers left; G tip is an ancestor of HEAD.
  - [x] Versions ONCE: `@sentropic/artifacts` 0.2.14; `packages/cluster-mesh` restored to main's `0.26.0-dev.9` (TN01-EX12, train touches no cm src); no other package above main.
  - [x] Regen through make: root lock (cm dev.9), api lock (F1: all 5 `file:` entries synced to union manifests; `lock-api` alone cannot move `file:` versions so the #878 one-line sync applies), selected fixture (mesh dev.9 + artifacts 0.2.14, lock refreshed from verified packed bytes, tuple integrity synced and cross-checked); APP-P1 pin verified unchanged (G tools outside frozen P1 selection; boot healthy + pin test green).
  - [x] L5 P1 regen: retained 65203d6a manifest+sidecar in history/ (self-sha names), packed fresh manifest 8862b06f (44 contracts) + lock-snapshot 7e159e96 via `memory-l5-pack`, `memory-l5-verify` ok (bindings verified against declared lock + l5Head e3251ac9a + main a1d0a815a); `scope-check` PASS C2.
  - [x] Scoped tests on `ENV=test-train-next` (LAST): ai-filter self-test green; ci-expected-results 28/28; test-artifacts 60 files/621 green (lot2 20/20, snapshot 24 defs); adapter-conformance.integration 36/36; migration.integration 16/16; pin lanes 25+2+17 green; AI lanes 2+2 green; test-lazy-package 135/135 green; typechecks + lint (0 errors) green; `make down-volumes ENV=test-train-next` last (no leftovers).
  - [ ] Atomic `make commit` commits (specific files only, ≤150 lines except machine-generated regens); push `--force-with-lease`; PR #914 body lists wagons E, F, G; single CI watched, real failures fixed at root.
