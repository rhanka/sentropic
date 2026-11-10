# Feature: llm-mesh Claude seat runner

## Objective
Ship a concrete Node ClaudeCodeCliRunner in @sentropic/llm-mesh so a Claude seat authenticates a claude CLI child and serves the anthropic provider.

## Scope / Guardrails
- Scope limited to packages/llm-mesh (src/node runner, transport quota mapping, catalog opus-5-5, tests, version, CHANGELOG).
- One migration max in `api/drizzle/*.sql` (not applicable, no migration).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/worktrees/llm-mesh-claude-seat`.
- Automated test campaigns run on dedicated environments (`ENV=test-llm-mesh-claude-seat`), never on root `dev`.
- UAT qualification branch/worktree is commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off).
- In every `make` command, `ENV=<env>` is passed as the last argument.
- All new text in English.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/llm-mesh/src/node/claude-code-cli-*.ts`
  - `packages/llm-mesh/src/node/index.ts`
  - `packages/llm-mesh/src/global.d.ts`
  - `packages/llm-mesh/src/transport/claude-code-runtime-client.ts`
  - `packages/llm-mesh/tests/node/claude-code-cli-runner.test.ts`
  - `packages/llm-mesh/tests/transport/claude-code-runtime-client.test.ts`
  - `packages/llm-mesh/tests/decision-public-surface.test.ts`
  - `packages/llm-mesh/package.json`
  - `packages/llm-mesh/CHANGELOG.md`
  - `packages/cluster-mesh/tests/fixtures/train.ts`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`
  - `package-lock.json`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- `BR01-EX1` (declared 2026-11-09, active): touch `packages/cluster-mesh/tests/fixtures/train.ts` + `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json|package-lock.json` (llm-mesh pin lines only).
  - Reason: the ordered 0.33.1 bump breaks the cluster-mesh selected-fixture alignment gate (`prepare-artifacts.spec.ts` strict pin path) and cascades into `llm-surface`/`gateway-surface` loader state assertions (`TRAIN_LLM_MESH_VERSION` vs workspace version); CI cannot go green without the sync.
  - Impact: test-fixture data only, no cluster-mesh source change; llm-mesh lines only (no other lane version touched).
  - Rollback: `git checkout origin/main -- <those 3 files>` restores the 0.33.0 pins.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: single package, one lane, one test cycle.

## UAT Management (in orchestration context)
- [x] **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- No UI changes in this branch, no UAT checkpoints.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read rules/MASTER.md, rules/workflow.md, rules/testing.md, .tmp/packets/COMMON-RULES.md, .tmp/rv/llm-mesh-accounts-plan.md.
  - [x] Create isolated worktree tmp/worktrees/llm-mesh-claude-seat on feat/llm-mesh-claude-seat-runner from origin/main (ec3c0bcc8).
  - [x] Verify branch: feat/llm-mesh-claude-seat-runner.
  - [x] Environment mapping: ENV=test-llm-mesh-claude-seat, API_PORT=8919, UI_PORT=5319, MAILDEV_UI_PORT=1219.
  - [x] Confirm command style: docker-slot.sh make ... ENV=<env> with ENV last.
  - [x] Confirm scope and guardrails.
  - [x] Validate scope boundaries, no BRxx-EXn needed.
- [x] **Lot 1 — Node ClaudeCodeCliRunner + quota mapping + factory**
  - [x] New src/node/claude-code-cli-runner.ts + claude-code-cli-wire.ts: spawn claude CLI headless (-p, stream-json, --effort, --system-prompt-file or stdin, model id), CLAUDE_CODE_OAUTH_TOKEN in child env only, normalize CLI output to ClaudeCodeCliEvent, quota/rate-limit to typed rate_limited failure, timeouts, abort.
  - [x] Runtime client: pass typed quota failures through with numeric fields only (secret boundary intact).
  - [x] Factory createClaudeSeatAnthropicClient for clients.anthropic; export runner + factory from ./node subpath.
  - [x] Lot gate:
    - [x] `make typecheck-llm-mesh ENV=test-llm-mesh-claude-seat` green
    - [x] Scoped runs: `make test-llm-mesh SCOPE=tests/node/claude-code-cli-runner.test.ts ENV=test-llm-mesh-claude-seat` 28/28 (reprise review)
    - [x] Scoped runs: `make test-llm-mesh SCOPE=tests/transport/claude-code-runtime-client.test.ts ENV=test-llm-mesh-claude-seat` 117/117
    - [x] `make lint-llm-mesh ENV=test-llm-mesh-claude-seat` green
- [x] **Lot 2 — Seat import proof (no catalog change)**
  - [x] Verify: claude already accepted by parseCliSeatProfile/importSeatBundle/EncryptedFileKeyring path (existing tests pin it: cli-seat-import.test.ts CLIS incl. claude, local-account-transport-service-claude.test.ts importSeatBundle claude pair anthropic/claude-code); no catalog addition (routing tests pin no-faithful-target for 5.5 families; runner validates modelId by regex).
  - [x] Lot gate: existing coverage, no new test needed.
- [x] **Lot 3 — Version, changelog, lockfiles, full gates**
  - [x] Bump packages/llm-mesh/package.json 0.33.0 -> 0.33.1 (npm latest is 0.33.0), CHANGELOG entry, lockfiles via make lock-root (root lock workspace entry 0.33.1; gateway ^0.33.0 and cluster-mesh peer <0.34.0 ranges already cover it).
  - [x] Full `make test-llm-mesh ENV=test-llm-mesh-claude-seat` 101 files / 1778 tests green, typecheck + lint green; pinned version test moved 0.33.0 -> 0.33.1.
- [x] **Lot 4 — CI fallout: cluster-mesh fixture sync (BR01-EX1)**
  - [x] `packages/cluster-mesh/tests/fixtures/train.ts`: TRAIN_LLM_MESH_VERSION 0.33.0 -> 0.33.1.
  - [x] `fixtures/selected/package.json` + `package-lock.json`: llm-mesh pin lines 0.33.0 -> 0.33.1 only (no other lane version touched); lock integrity = CI-packed sibling sha512 of this branch 0.33.1 tarball (pack is content-deterministic; the heavy local refresh is not runnable here — mcp-platform dist absent and install-internal-packages blocked by root-owned vitest cruft).
  - [x] Scoped runs: prepare-artifacts 20/20, llm-surface 12/12, gateway-surface 7/7 ENV=test-llm-mesh-claude-seat.
  - [ ] `make scope-check` PASS, commit, push, CI green.
- [ ] **Lot 5 — Correctifs review Wonder (BLOCKER/MAJOR/MINOR, PR #981)**
  - [x] BLOCKER env : allowlist minimale (`PATH` + locale/TZ), purge préfixes auth/endpoint/cloud, câblée dans `execute` + probe.
  - [x] BLOCKER confinement CLI : `--verbose` (requis stream-json 2.1.x, vérifié sur CLI réel), `--tools ""`, `--strict-mcp-config` sans `--mcp-config`, `--no-session-persistence`, sandbox (cwd/HOME/`CLAUDE_CONFIG_DIR`), init fail-closed sur inventaire non vide.
  - [x] MAJOR timeout/abort : groupe détaché, escalade SIGTERM → SIGKILL groupe, teardown des pipes, attente `close`, deadline dure indépendante de la lecture.
  - [x] MAJOR mémoire : caps ligne/total stdout, stderr en bytes, probe capée, `StringDecoder` + flush résiduel.
  - [x] MAJOR qualification : probe `--version` >= 2.1 + `--help` (flags de confinement requis), test e2e factory → client → wire.
  - [x] MINOR : abort avant spawn, `ClaudeCliQuotaError` exporté de `./node`, quota structuré d'abord, CHANGELOG (patch assumé : ranges consumers `<0.34.0`).
  - [x] Seat import : aucun changement nécessaire (`SeatCli` inclut `claude`, paire `claude → claude-code`, tests existants).
  - [x] Vérifié empiriquement sur CLI réel 2.1.321 : erreur `--verbose` requise, init `tools:[]`/`mcp_servers:[]`, hooks ambiants sans sandbox, aucun hook avec sandbox, `apiKeySource:"none"`, échec auth typé.
- [ ] **Lot 6 — CI fallout run 42711632214 (tête 9f0a28ecd)**
  - [x] `validate-cluster-mesh (lazy)` : `lock integrity sha512-4/Lz… != sibling sha512-TN6…` — le tarball sibling packé en CI a changé car les 6 commits review modifient le contenu llm-mesh (attendu) ; fixture `selected/package-lock.json` resynchronisée (ligne integrity llm-mesh uniquement → hash sibling du log CI, pack CI déterministe pour cet arbre).
  - [x] `test-e2e (2)` : `07_comment_assistant … AI-Assistant-badge toBeVisible` — test Playwright UI uniquement, aucun import du node runner côté UI/apps (vérifié : seuls des re-exports backend cluster-mesh référencent le chemin). Lane sans UI. Classé flake non lié (pratique main : shard 1 chat / shard 4 organizations déjà notés) ; tête fraîche pour re-run.
- [x] **Lot 7 — CI tête 0b815811b + merge main 303f5557a (reprise RESUME 09/11)**
  - [x] Run PR `42722948698` (tête `bb0fcb535`) : **completed/success**, 0 échec (lazy + e2e-2 verts sur run PR attaché).
  - [x] Merge `origin/main` (`26e0360c3`, PR #985 artifacts-live — seul `BRANCH.md` en conflit, résolu `--ours`, ligne BRLOCK-EX1 intacte) → `0b815811b`, `scope-check` PASS C2, push OK. Aucun run `pull_request` créé par GitHub (même comportement plateforme que `49f1be4ac`) → repli `workflow_dispatch` `42726112392`.
  - [x] Dispatch `42726112392` (tête `0b815811b`) : **failure cantonné à `test-e2e (2)` + `test-e2e (4)`** (ci-gate suit). Signatures UI-only, sans lien avec le lane (aucune UI touchée) : shard 2 `09-run-steering-core` (`steers in-flight…`, `expect().toBe()`), shard 4 `02-organizations` (`read-only viewer`, `waitForURL` timeout + `toBeVisible`). Classé flake non lié : le même arbre était vert sur le run PR précédent, et main documente elle-même des flakes e2e (commits docs `shard 1 matrix lock`, `shard 5 AI generation provider`) ; push main `d8818c5b4` rouge sur `retain-daily-identities` (infra, non-e2e). Tête fraîche pour re-run (règle : pas de rerun/skip).
  - [x] Merge `origin/main` (`303f5557a`, PR #987 + #989 — seul `BRANCH.md` en conflit, résolu `--ours`) → `4363d7f75`, `scope-check` PASS C2, push OK. Run PR `42728785764` créé cette fois : **completed/success**, 0 échec.
  - [x] Note Lot 7 (`22a36aaa5`, push OK, sans run `pull_request` plateforme) → dispatch `42732350591` : **completed/success, 0 échec, 6/6 e2e verts** (shards 2+4 verts — flake avéré).
- [x] **Lot 8 — Merge main d03ca3e27 (PR #988 e2e-ui-flaky + #990) + run PR vert**
  - [x] Main a avancé (fix e2e `02-organizations`/`03-chat`/`07-matrix` + `MenuPopover`, forge artifacts-live — corroborre le classement flake, aucun recouvrement avec le lane hors `BRANCH.md` résolu `--ours`) → `324c95640`, `scope-check` PASS C2, push OK. Run PR `42734918470` : **completed/success**, 0 échec (6/6 e2e verts **avec** le fix #988 dans l'arbre). PR OPEN, MERGEABLE, non mergée.
- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint
  - [ ] Retest llm-mesh suite (cf Lot1, copy checklist)
  - [ ] Bumped packages/llm-mesh/package.json version (semver) — enforced by CI enforce-package-bump.
  - [ ] Final gate step 1: create PR using BRANCH.md text as PR body (source of truth).
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: push only (no merge, conductor merges).
